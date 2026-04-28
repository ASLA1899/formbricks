# Audience System Redesign — Phase 1a (Contact Mirror) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Contact mirror foundation — continuous Snowflake → Postgres sync of `Contact` rows, typed `email` + `externalId` columns, source-tagged contacts (snowflake / manual / csv), and the supporting Settings UI + extended CSV importer. Once this ships, operators can build segments over fresh contact data in the existing Segments UI without writing SQL — delivering the core "no-SQL slicing" goal of the redesign even before Phase 1b ships the Audience primitive on top.

**Architecture:** Two new Prisma tables (`ContactSync`, `ContactSyncRun`) plus four new columns on `Contact` (`email`, `externalId`, `source`, `inactive`/`inactiveAt`). A shared column-mapping module (lifted out of `recipients-card.tsx`) is consumed by both the sync runner and an extended CSV importer. The sync runner is invoked from the existing `/api/cron/reminders` cron endpoint, gated by per-environment `lastRunAt + intervalMinutes` so we don't add a new system cron entry on the VM. Manual contacts (`source != snowflake`) are protected: sync never touches them. UI changes mark synced fields read-only with a "from Snowflake" badge.

**Tech Stack:** Next.js 14 (App Router), Prisma + PostgreSQL, snowflake-sdk, TypeScript, Vitest, server actions / server components, Tailwind UI.

---

## Context (read first if you don't have history)

This is Phase 1a of the Audience System Redesign documented in `docs/superpowers/specs/2026-04-27-audience-system-redesign-design.md`. Read that spec before starting.

**The pivot moment** in brainstorming was Q7: instead of layering "fresh-data audiences" on top of a stale Contact pool, we make the Contact pool itself continuously fresh by mirroring Snowflake into Postgres. Audiences (Phase 1b) become a thin presentation layer on top of an always-fresh contact mirror.

**Phase 1a is standalone-shippable.** It delivers no-SQL slicing immediately via the existing Segments UI — operators don't need any new audience UI to benefit from continuously-synced contacts. Phase 1b is a separate plan (later).

**Decisions locked in (don't re-litigate):**
- Identity: typed `email` column on Contact (replaces email-as-attribute pattern); typed `externalId` for Snowflake's member number. Both partial-unique per environment. Email is the practical match key; externalId is the canonical identity when present (Q2=B).
- Sync direction: one-way Snowflake → Formbricks. Formbricks remains OLTP system of record. Reverse-ETL of responses to Snowflake is Phase 2 (Q7=Z).
- Conflict policy: Snowflake wins on synced fields for `source=snowflake` contacts. Manual contacts (`source=manual` or `source=csv`) are protected — sync never updates them. UI marks synced fields read-only.
- Inactive contacts: Snowflake-source contacts that drop out of the source query are marked `inactive=true`, never deleted (response history must be preserved).
- One sync config per environment in v1. Multiple syncs (members + donors + staff as separate queries) are Phase 4.
- Sync runs piggyback on the existing `/api/cron/reminders` endpoint (every 5 min). Each sync respects its own `intervalMinutes` setting (default 60). No new VM crontab entry needed.

**Production environment:** ASLA's fork at `github.com/ASLA1899/formbricks`. Deploys via GHCR (build on Mac, pull on VM). Live at `https://surveys.asla.org`. See repo CLAUDE.md for deployment specifics. The `Contact` model already exists today and is environment-scoped.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/database/schema.prisma` | modify | Add Contact columns; add ContactSync, ContactSyncRun, SyncStatus, ContactSource |
| `packages/database/migration/<timestamp>_add_contact_mirror/migration.sql` | create | Schema migration with backfill + partial unique indexes |
| `apps/web/modules/contacts/lib/column-mapping.ts` | create | Shared column normalization + alias seed + matcher |
| `apps/web/modules/contacts/lib/column-mapping.test.ts` | create | Unit tests |
| `apps/web/modules/ee/contacts/lib/contacts.ts` | modify | Update reads/writes to use typed `email` column; preserve attribute fallback |
| `apps/web/modules/ee/contacts/lib/contacts.test.ts` | modify | Update tests for new schema |
| `apps/web/app/api/member-lookup/configurable-query-service.ts` | modify | Add `executeConfiguredQueryAllRows` returning full row array |
| `apps/web/modules/contacts/lib/sync.ts` | create | Sync algorithm: upsert, deactivate, run record |
| `apps/web/modules/contacts/lib/sync.test.ts` | create | Unit tests for the sync algorithm |
| `apps/web/app/api/cron/reminders/route.ts` | modify | Add `runDueSyncs()` call |
| `apps/web/modules/contacts/lib/sync-runner.ts` | create | `runDueSyncs()` — finds enabled syncs whose interval has elapsed, runs them |
| `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/page.tsx` | create | Settings page: config form + status panel |
| `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/actions.ts` | create | Server actions: save config, run sync now |
| `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/components/sync-config-form.tsx` | create | Client component: query select, column mapping, interval |
| `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/components/sync-status-panel.tsx` | create | Server component: last run, history table, manual trigger |
| `apps/web/modules/survey/invitations/components/recipients-card.tsx` | modify | Replace inline CSV parser with shared module; capture arbitrary columns as Contact attributes on save |
| `apps/web/modules/ee/contacts/[contactId]/components/attributes-section.tsx` | modify | Add source badge + sync-managed markers |
| `apps/web/modules/ee/contacts/components/contacts-list-table-row.tsx` | modify | Show source badge |
| `apps/web/app/(app)/environments/[environmentId]/(contacts)/contacts/page.tsx` | modify | Add source + active filters |

**Why this split:** The shared column-mapping module is the linchpin for both ingest paths (sync + CSV) and warrants its own file with focused tests. The sync runner is split from the algorithm so the runner (which iterates configs) can be tested separately from the algorithm (which processes one sync). Settings UI stays under the existing `settings/` Next.js convention. The Contact lib changes touch existing tests and need careful review — keeping them in their existing module keeps blast radius narrow.

---

## Sequencing

Tasks are dependency-ordered:

```
Task 1 (Contact schema + backfill)
  ├─→ Task 2 (Contact lib refactor)
  └─→ Task 3 (ContactSync schema)
        ├─→ Task 4 (Column mapping module)
        ├─→ Task 5 (Multi-row Snowflake query)
        └─→ Task 6 (Sync algorithm) [depends on 3, 4, 5]
              └─→ Task 7 (Cron integration) [depends on 6]
                    └─→ Task 8 (Settings: config form) [depends on 4]
                          └─→ Task 9 (Settings: status panel) [depends on 6]
                                └─→ Task 10 (CSV importer extension) [depends on 4]
                                      └─→ Task 11 (Contact detail badges) [depends on 1, 2]
                                            └─→ Task 12 (Contacts list filters) [depends on 1, 2]
```

Tasks 4 and 5 can run in parallel after Task 3; tasks 11 and 12 can run in parallel after Task 2. Subagent-driven mode will exploit this; sequential mode just goes in order.

---

## Task 1: Contact schema migration + backfill

**Goal:** Add typed `email`, `externalId`, `source`, `inactive`, `inactiveAt` columns to `Contact`. Backfill `email` from existing email-attribute rows. Add partial-unique indexes via raw SQL.

**Files:**
- Modify: `packages/database/schema.prisma`
- Create: `packages/database/migration/<TIMESTAMP>_add_contact_mirror_columns/migration.sql`

**Acceptance Criteria:**
- [ ] `Contact` model has `email`, `externalId` (both nullable for now), `source` (enum default `manual`), `inactive` (default false), `inactiveAt` (nullable).
- [ ] All existing contacts get `source = manual` and `inactive = false`.
- [ ] All existing contacts with an email-attribute row get `email` backfilled from that attribute (lowercased, trimmed).
- [ ] Partial unique index `(environmentId, email) WHERE email IS NOT NULL` exists.
- [ ] Partial unique index `(environmentId, externalId) WHERE externalId IS NOT NULL` exists.
- [ ] `npx prisma migrate dev` against a fresh database applies cleanly.
- [ ] Re-running the migration is a no-op (idempotent).

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks
docker compose -f docker-compose.local.yml up -d postgres
docker compose -f docker-compose.local.yml exec postgres psql -U postgres -d formbricks -c "\d \"Contact\""
# Expected: shows email, externalId, source, inactive, inactiveAt columns
docker compose -f docker-compose.local.yml exec postgres psql -U postgres -d formbricks -c "\d+ \"Contact\""
# Expected: shows the partial unique indexes at the bottom
```

**Steps:**

- [ ] **Step 1: Update schema.prisma**

Edit `packages/database/schema.prisma`. Find the `Contact` model and replace it with:

```prisma
model Contact {
  id            String             @id @default(cuid())
  createdAt     DateTime           @default(now()) @map(name: "created_at")
  updatedAt     DateTime           @updatedAt @map(name: "updated_at")
  environment   Environment        @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  environmentId String
  email         String?
  externalId    String?
  source        ContactSource      @default(manual)
  inactive      Boolean            @default(false)
  inactiveAt    DateTime?
  responses     Response[]
  attributes    ContactAttribute[]
  displays      Display[]
  invitations   SurveyInvitation[]

  @@index([environmentId])
  @@index([environmentId, inactive])
}

enum ContactSource {
  snowflake
  manual
  csv
}
```

The two partial unique indexes are NOT expressed in Prisma (no native syntax for `WHERE` clauses on indexes); they're added via raw SQL in the migration.

- [ ] **Step 2: Create migration directory**

```bash
cd /Users/gcohen/dev/formbricks
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p "packages/database/migration/${TS}_add_contact_mirror_columns"
```

- [ ] **Step 3: Write migration.sql**

Write this to `packages/database/migration/<TIMESTAMP>_add_contact_mirror_columns/migration.sql`:

```sql
-- ===========================================================================
-- Phase 1a: Contact mirror — add typed identity columns + source tagging
-- ---------------------------------------------------------------------------
-- Idempotent: each ALTER / CREATE uses IF NOT EXISTS so re-running is a
-- no-op. Backfills are also idempotent (UPDATE ... WHERE email IS NULL).
-- ===========================================================================

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContactSource') THEN
    CREATE TYPE "public"."ContactSource" AS ENUM ('snowflake', 'manual', 'csv');
  END IF;
END $$;

-- AlterTable: Contact additions
ALTER TABLE "public"."Contact" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "public"."Contact" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "public"."Contact" ADD COLUMN IF NOT EXISTS "source" "public"."ContactSource" NOT NULL DEFAULT 'manual';
ALTER TABLE "public"."Contact" ADD COLUMN IF NOT EXISTS "inactive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."Contact" ADD COLUMN IF NOT EXISTS "inactiveAt" TIMESTAMP(3);

-- Backfill email column from email attribute (where present).
-- Joins ContactAttribute → ContactAttributeKey (key='email'), takes the
-- attribute value, lowercases + trims it. Idempotent (only updates rows
-- where email is currently NULL).
UPDATE "public"."Contact" c
SET "email" = LOWER(TRIM(ca."value"))
FROM "public"."ContactAttribute" ca
JOIN "public"."ContactAttributeKey" cak ON cak."id" = ca."attributeKeyId"
WHERE ca."contactId" = c."id"
  AND cak."key" = 'email'
  AND cak."environmentId" = c."environmentId"
  AND c."email" IS NULL
  AND ca."value" IS NOT NULL
  AND TRIM(ca."value") <> '';

-- Index: lookups by (environmentId, inactive)
CREATE INDEX IF NOT EXISTS "Contact_environmentId_inactive_idx"
  ON "public"."Contact"("environmentId", "inactive");

-- Partial unique indexes: enforce email + externalId uniqueness per environment
-- but only when the column is non-null (legacy rows may lack email).
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_environmentId_email_unique"
  ON "public"."Contact"("environmentId", "email")
  WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Contact_environmentId_externalId_unique"
  ON "public"."Contact"("environmentId", "externalId")
  WHERE "externalId" IS NOT NULL;
```

- [ ] **Step 4: Apply migration in dev**

```bash
cd /Users/gcohen/dev/formbricks
pnpm --filter @formbricks/database db:up
# Expected: "Database is now in sync with your schema." (or similar)
```

If it fails on duplicate-email rows during partial-unique creation, manually log + dedupe before retrying — there should not be many such rows in dev.

- [ ] **Step 5: Verify schema**

```bash
docker compose -f docker-compose.local.yml exec postgres psql -U postgres -d formbricks \
  -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='Contact' ORDER BY ordinal_position;"
```

Expected output includes `email | text | YES`, `externalId | text | YES`, `source | USER-DEFINED | NO`, `inactive | boolean | NO`, `inactiveAt | timestamp without time zone | YES`.

- [ ] **Step 6: Verify indexes**

```bash
docker compose -f docker-compose.local.yml exec postgres psql -U postgres -d formbricks \
  -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='Contact' ORDER BY indexname;"
```

Expected: `Contact_environmentId_email_unique` and `Contact_environmentId_externalId_unique` both with `WHERE` clauses in the indexdef.

- [ ] **Step 7: Verify backfill (if dev DB has existing data)**

```bash
docker compose -f docker-compose.local.yml exec postgres psql -U postgres -d formbricks \
  -c "SELECT COUNT(*) AS contacts, COUNT(email) AS with_email FROM \"Contact\";"
```

If there are existing Contact rows with email-attribute, `with_email` should be > 0.

- [ ] **Step 8: Commit**

```bash
git add packages/database/schema.prisma packages/database/migration/
git commit -m "feat(contacts): add Contact mirror columns + ContactSource enum

Phase 1a step 1 — typed email + externalId columns, source tagging,
inactive flag. Partial unique indexes per environment. Backfills email
from existing email-attribute rows."
```

---

## Task 2: Contact lib refactor — typed email column reads/writes

**Goal:** Update `ensureContact` and related helpers in `apps/web/modules/survey/invitations/lib/invitations.ts` and `apps/web/modules/ee/contacts/lib/contacts.ts` to use the new typed `email` column on Contact. Preserve the email attribute write for backwards compat (segments still filter on `attribute.email`).

**Files:**
- Modify: `apps/web/modules/survey/invitations/lib/invitations.ts:25-73` (replace `ensureContact`)
- Modify: `apps/web/modules/ee/contacts/lib/contacts.ts` (any other email-attribute lookups)

**Acceptance Criteria:**
- [ ] `ensureContact` looks up by typed `Contact.email` column first; falls back to email-attribute lookup for legacy rows.
- [ ] When creating a new Contact, `email` column is populated from the input.
- [ ] When matching an existing Contact by email-attribute (legacy path), the typed `email` column gets backfilled on the matched row.
- [ ] Segment filter logic continues to work (still queries `attribute.email`).
- [ ] All existing `invitations.ts` tests pass.

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run modules/survey/invitations modules/ee/contacts/lib/contacts 2>&1 | tail -20
```
Expected: all green.

**Steps:**

- [ ] **Step 1: Read existing `ensureContact`**

```bash
grep -n "ensureContact\|findFirst\|findUnique" /Users/gcohen/dev/formbricks/apps/web/modules/survey/invitations/lib/invitations.ts | head -20
```

Familiarize yourself with the existing flow. The function currently:
1. `findFirst` by environmentId + email-attribute.
2. If not found, create with attributes.
3. On `P2002` (unique violation), refetch.

The new flow:
1. `findUnique` on `(environmentId, email)` (typed column) — uses partial unique index.
2. If not found, fall back to old email-attribute lookup (catches pre-migration Contacts without typed email yet).
3. If still not found, create with both typed email AND email-attribute.
4. On any successful match where typed `email` is NULL, update it.

- [ ] **Step 2: Write the failing test**

Create or extend `apps/web/modules/survey/invitations/lib/invitations.test.ts`:

```typescript
import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { ensureContact } from "./invitations"; // export it for testing if not already

vi.mock("@formbricks/database", () => ({
  prisma: {
    contact: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contactAttributeKey: {
      findMany: vi.fn(),
    },
  },
}));

describe("ensureContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns existing contact id when matched by typed email column", async () => {
    (prisma.contact.findUnique as any).mockResolvedValue({ id: "c1" });
    const id = await ensureContact("env1", "alice@example.com", "Alice", null);
    expect(id).toBe("c1");
    expect(prisma.contact.findUnique).toHaveBeenCalledWith({
      where: { environmentId_email: { environmentId: "env1", email: "alice@example.com" } },
      select: { id: true, email: true },
    });
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  test("falls back to email-attribute lookup when typed email lookup misses (legacy row)", async () => {
    (prisma.contact.findUnique as any).mockResolvedValue(null);
    (prisma.contact.findFirst as any).mockResolvedValue({ id: "c2", email: null });
    (prisma.contact.update as any).mockResolvedValue({ id: "c2" });

    const id = await ensureContact("env1", "bob@example.com", null, null);

    expect(id).toBe("c2");
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: "c2" },
      data: { email: "bob@example.com" },
    });
  });

  test("creates new contact with typed email + email-attribute when no match", async () => {
    (prisma.contact.findUnique as any).mockResolvedValue(null);
    (prisma.contact.findFirst as any).mockResolvedValue(null);
    (prisma.contactAttributeKey.findMany as any).mockResolvedValue([
      { id: "k1", key: "email" },
    ]);
    (prisma.contact.create as any).mockResolvedValue({ id: "c3" });

    const id = await ensureContact("env1", "new@example.com", "New", "User");

    expect(id).toBe("c3");
    expect(prisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          environmentId: "env1",
          email: "new@example.com",
          source: "manual",
        }),
      })
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run modules/survey/invitations/lib/invitations.test.ts 2>&1 | tail -10
```

Expected: FAIL — `ensureContact` not exported / signature mismatch.

- [ ] **Step 4: Refactor `ensureContact`**

Replace `apps/web/modules/survey/invitations/lib/invitations.ts:25-73` with:

```typescript
const DEFAULT_ATTRIBUTE_KEYS = ["email", "firstName", "lastName"] as const;

// Find-or-create a Contact row keyed on (environmentId, email).
//
// Lookup order:
//   1. Typed Contact.email column (post-Phase-1a, partial-unique indexed).
//   2. Email-attribute fallback (catches legacy rows from before Phase 1a).
//      If matched here, backfill the typed column.
//   3. Create new Contact with both typed email AND email-attribute.
//
// We keep the email-attribute write so segments built on `attribute.email`
// continue to work without a Segment-side migration.
export async function ensureContact(
  environmentId: string,
  email: string,
  firstName: string | null,
  lastName: string | null
): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();

  // Step 1: typed-column match.
  const byEmail = await prisma.contact.findUnique({
    where: { environmentId_email: { environmentId, email: normalizedEmail } },
    select: { id: true, email: true },
  });
  if (byEmail) return byEmail.id;

  // Step 2: legacy email-attribute fallback. Backfills typed column on hit.
  const byAttribute = await prisma.contact.findFirst({
    where: {
      environmentId,
      email: null,
      attributes: { some: { attributeKey: { key: "email" }, value: normalizedEmail } },
    },
    select: { id: true, email: true },
  });
  if (byAttribute) {
    await prisma.contact.update({
      where: { id: byAttribute.id },
      data: { email: normalizedEmail },
    });
    return byAttribute.id;
  }

  // Step 3: create.
  const keys = await prisma.contactAttributeKey.findMany({
    where: { environmentId, key: { in: [...DEFAULT_ATTRIBUTE_KEYS] } },
    select: { id: true, key: true },
  });
  const keyByName = new Map(keys.map((k) => [k.key, k.id]));

  const createAttributes: { attributeKeyId: string; value: string }[] = [];
  const emailKeyId = keyByName.get("email");
  if (emailKeyId) createAttributes.push({ attributeKeyId: emailKeyId, value: normalizedEmail });
  const firstNameKeyId = keyByName.get("firstName");
  if (firstNameKeyId && firstName)
    createAttributes.push({ attributeKeyId: firstNameKeyId, value: firstName });
  const lastNameKeyId = keyByName.get("lastName");
  if (lastNameKeyId && lastName) createAttributes.push({ attributeKeyId: lastNameKeyId, value: lastName });

  try {
    const created = await prisma.contact.create({
      data: {
        environmentId,
        email: normalizedEmail,
        source: "manual",
        attributes: { create: createAttributes },
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // P2002 = unique violation. Race with another writer; refetch.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const retry = await prisma.contact.findUnique({
        where: { environmentId_email: { environmentId, email: normalizedEmail } },
        select: { id: true },
      });
      if (retry) return retry.id;
    }
    throw error;
  }
}
```

- [ ] **Step 5: Update Prisma client types**

```bash
cd /Users/gcohen/dev/formbricks
pnpm --filter @formbricks/database build
```

Required so `prisma.contact.findUnique({ where: { environmentId_email: ... } })` typechecks (Prisma generates the compound-key shorthand from the partial unique index plus the constraint name on the column pair). If Prisma doesn't generate `environmentId_email` for the partial unique (which is technically possible — Prisma's behavior varies for partial uniques), fall back to `findFirst` with the equivalent where clause.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run modules/survey/invitations/lib/invitations.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 7: Run the broader test suite**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run modules/survey/invitations modules/ee/contacts/lib 2>&1 | tail -30
```

Expected: all green. Fix any breakage from the schema change before moving on.

- [ ] **Step 8: Commit**

```bash
git add apps/web/modules/survey/invitations/lib/invitations.ts \
        apps/web/modules/survey/invitations/lib/invitations.test.ts \
        apps/web/modules/ee/contacts/lib/contacts.ts
git commit -m "refactor(contacts): use typed Contact.email column with attribute fallback

ensureContact now looks up by Contact.email first (post-Phase-1a typed
column), falls back to the email-attribute pattern for legacy rows, and
backfills the typed column when matched via the legacy path. Email-
attribute writes are preserved so existing segments keep working."
```

---

## Task 3: ContactSync schema migration

**Goal:** Create `ContactSync`, `ContactSyncRun` tables and `SyncStatus` enum.

**Files:**
- Modify: `packages/database/schema.prisma`
- Create: `packages/database/migration/<TIMESTAMP>_add_contact_sync/migration.sql`

**Acceptance Criteria:**
- [ ] `ContactSync` model with one-per-environment uniqueness (`@@unique([environmentId])`).
- [ ] `ContactSyncRun` model with FK to ContactSync, indexed on `(syncId, startedAt)`.
- [ ] `SyncStatus` enum with `pending | running | succeeded | failed`.
- [ ] Migration applies cleanly.

**Verify:**
```bash
docker compose -f docker-compose.local.yml exec postgres psql -U postgres -d formbricks \
  -c "\dt \"public\".\"ContactSync*\""
```
Expected: shows `ContactSync` and `ContactSyncRun` tables.

**Steps:**

- [ ] **Step 1: Add models to schema.prisma**

After the `Contact` model in `packages/database/schema.prisma`, add:

```prisma
/// Configures the Snowflake → Formbricks Contact mirror for an environment.
/// One per environment in v1; multiple syncs are Phase 4.
model ContactSync {
  id               String           @id @default(cuid())
  createdAt        DateTime         @default(now()) @map(name: "created_at")
  updatedAt        DateTime         @updatedAt @map(name: "updated_at")
  environment      Environment      @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  environmentId    String           @unique
  snowflakeQueryId String           // refs query-config.json (existing registry)
  /// [ContactSyncColumnMapping]
  columnMapping    Json
  intervalMinutes  Int              @default(60)
  enabled          Boolean          @default(true)
  lastRunAt        DateTime?
  lastRunStatus    SyncStatus?
  runs             ContactSyncRun[]
}

/// Audit record per ContactSync execution.
model ContactSyncRun {
  id              String       @id @default(cuid())
  sync            ContactSync  @relation(fields: [syncId], references: [id], onDelete: Cascade)
  syncId          String
  startedAt       DateTime     @default(now())
  finishedAt      DateTime?
  status          SyncStatus
  rowsProcessed   Int          @default(0)
  rowsCreated     Int          @default(0)
  rowsUpdated     Int          @default(0)
  rowsDeactivated Int          @default(0)
  errorMessage    String?

  @@index([syncId, startedAt])
}

enum SyncStatus {
  pending
  running
  succeeded
  failed
}
```

- [ ] **Step 2: Create the migration directory + SQL**

```bash
cd /Users/gcohen/dev/formbricks
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p "packages/database/migration/${TS}_add_contact_sync"
```

Write to `packages/database/migration/<TIMESTAMP>_add_contact_sync/migration.sql`:

```sql
-- ===========================================================================
-- Phase 1a: ContactSync — Snowflake → Formbricks Contact mirror config + runs
-- Idempotent.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SyncStatus') THEN
    CREATE TYPE "public"."SyncStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "public"."ContactSync" (
  "id"               TEXT          NOT NULL,
  "created_at"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)  NOT NULL,
  "environmentId"    TEXT          NOT NULL,
  "snowflakeQueryId" TEXT          NOT NULL,
  "columnMapping"    JSONB         NOT NULL,
  "intervalMinutes"  INTEGER       NOT NULL DEFAULT 60,
  "enabled"          BOOLEAN       NOT NULL DEFAULT true,
  "lastRunAt"        TIMESTAMP(3),
  "lastRunStatus"    "public"."SyncStatus",

  CONSTRAINT "ContactSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContactSync_environmentId_key"
  ON "public"."ContactSync"("environmentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactSync_environmentId_fkey') THEN
    ALTER TABLE "public"."ContactSync"
      ADD CONSTRAINT "ContactSync_environmentId_fkey"
      FOREIGN KEY ("environmentId") REFERENCES "public"."Environment"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "public"."ContactSyncRun" (
  "id"              TEXT          NOT NULL,
  "syncId"          TEXT          NOT NULL,
  "startedAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"      TIMESTAMP(3),
  "status"          "public"."SyncStatus" NOT NULL,
  "rowsProcessed"   INTEGER       NOT NULL DEFAULT 0,
  "rowsCreated"     INTEGER       NOT NULL DEFAULT 0,
  "rowsUpdated"     INTEGER       NOT NULL DEFAULT 0,
  "rowsDeactivated" INTEGER       NOT NULL DEFAULT 0,
  "errorMessage"    TEXT,

  CONSTRAINT "ContactSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContactSyncRun_syncId_startedAt_idx"
  ON "public"."ContactSyncRun"("syncId", "startedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactSyncRun_syncId_fkey') THEN
    ALTER TABLE "public"."ContactSyncRun"
      ADD CONSTRAINT "ContactSyncRun_syncId_fkey"
      FOREIGN KEY ("syncId") REFERENCES "public"."ContactSync"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
```

- [ ] **Step 3: Apply migration**

```bash
cd /Users/gcohen/dev/formbricks
pnpm --filter @formbricks/database db:up
```

- [ ] **Step 4: Verify**

```bash
docker compose -f docker-compose.local.yml exec postgres psql -U postgres -d formbricks \
  -c "\d \"public\".\"ContactSync\""
docker compose -f docker-compose.local.yml exec postgres psql -U postgres -d formbricks \
  -c "\d \"public\".\"ContactSyncRun\""
```

Expected: both tables print with the columns + constraints listed.

- [ ] **Step 5: Commit**

```bash
git add packages/database/schema.prisma packages/database/migration/
git commit -m "feat(contacts): add ContactSync + ContactSyncRun tables

Phase 1a step 3 — schema for the Snowflake → Formbricks Contact mirror.
One sync per environment in v1; multiple syncs are Phase 4."
```

---

## Task 4: Shared column-mapping module

**Goal:** Extract CSV column-detection logic from `recipients-card.tsx` into a reusable module that both the sync runner and the CSV importer will use.

**Files:**
- Create: `apps/web/modules/contacts/lib/column-mapping.ts`
- Create: `apps/web/modules/contacts/lib/column-mapping.test.ts`

**Acceptance Criteria:**
- [ ] `normalizeHeader(header: string): string` lowercases and strips non-alphanumerics.
- [ ] `BUILTIN_ALIASES` maps normalized headers to canonical destinations (`email`, `externalId`, `firstName`, `lastName`).
- [ ] `matchColumns(sourceHeaders: string[], existingKeys: { id: string; key: string }[]): ColumnMatch[]` returns one entry per source header with the suggested mapping (auto-mapped, manual, or new).
- [ ] Tests cover: exact alias match, normalized fuzzy match, unmapped column, multiple matches collision.

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run modules/contacts/lib/column-mapping.test.ts
```
Expected: all green.

**Steps:**

- [ ] **Step 1: Write the test file first**

Create `apps/web/modules/contacts/lib/column-mapping.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import {
  normalizeHeader,
  matchColumns,
  BUILTIN_ALIASES,
  type ColumnMatch,
} from "./column-mapping";

describe("normalizeHeader", () => {
  test("lowercases and strips non-alphanumerics", () => {
    expect(normalizeHeader("Member ID")).toBe("memberid");
    expect(normalizeHeader("member_id")).toBe("memberid");
    expect(normalizeHeader("MemberID")).toBe("memberid");
    expect(normalizeHeader("E-Mail")).toBe("email");
    expect(normalizeHeader("First Name (legal)")).toBe("firstnamelegal");
  });

  test("preserves existing alphanumeric content", () => {
    expect(normalizeHeader("custom_field_42")).toBe("customfield42");
  });
});

describe("BUILTIN_ALIASES", () => {
  test("recognizes common email variants", () => {
    expect(BUILTIN_ALIASES.email).toContain("email");
    expect(BUILTIN_ALIASES.email).toContain("emailaddress");
    expect(BUILTIN_ALIASES.email).toContain("email_address".replace(/_/g, ""));
  });

  test("recognizes common externalId variants", () => {
    const ids = BUILTIN_ALIASES.externalId.map(normalizeHeader);
    expect(ids).toContain("memberid");
    expect(ids).toContain("membernumber");
  });
});

describe("matchColumns", () => {
  const existingKeys = [
    { id: "k1", key: "email" },
    { id: "k2", key: "firstName" },
    { id: "k3", key: "memberId" },
    { id: "k4", key: "region" },
  ];

  test("auto-maps exact normalized matches against existing keys", () => {
    const matches = matchColumns(["region", "Region", "REGION"], existingKeys);
    expect(matches).toHaveLength(3);
    for (const m of matches) {
      expect(m.kind).toBe("attribute");
      if (m.kind === "attribute") expect(m.attributeKeyId).toBe("k4");
    }
  });

  test("auto-maps via builtin aliases for typed columns (email)", () => {
    const matches = matchColumns(["E-Mail Address"], existingKeys);
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("typed");
    if (matches[0].kind === "typed") expect(matches[0].column).toBe("email");
  });

  test("auto-maps via builtin aliases for typed columns (externalId)", () => {
    const matches = matchColumns(["Member Number"], existingKeys);
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("typed");
    if (matches[0].kind === "typed") expect(matches[0].column).toBe("externalId");
  });

  test("flags unmapped columns as 'new'", () => {
    const matches = matchColumns(["UnknownField"], existingKeys);
    expect(matches[0].kind).toBe("unmapped");
    expect(matches[0].sourceHeader).toBe("UnknownField");
  });

  test("preserves source header casing in result", () => {
    const matches = matchColumns(["Region"], existingKeys);
    expect(matches[0].sourceHeader).toBe("Region");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (no module yet)**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run modules/contacts/lib/column-mapping.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `apps/web/modules/contacts/lib/column-mapping.ts`:

```typescript
// Shared column mapping for Contact ingest paths (Snowflake sync, CSV import).
//
// Source columns (from a CSV header row or a Snowflake result row) need to map
// onto either a typed Contact column (`email`, `externalId`) or a
// ContactAttributeKey. The matcher normalizes headers, checks built-in aliases,
// then falls back to fuzzy matching against existing attribute keys, and finally
// flags unmapped columns for user review.
//
// This module is consumed by:
//   - The Snowflake sync runner (config saved on ContactSync.columnMapping).
//   - The CSV importer in the Audiences UI / Recipients card.

// Header normalization: lowercase + strip non-alphanumeric characters.
// "Member ID" → "memberid"
// "member_id" → "memberid"
// "Member-ID (legal)" → "memberidlegal"
export const normalizeHeader = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

// Built-in aliases — map normalized header strings to the canonical destination
// (a typed Contact column key). Extending this list adds smarter auto-detection
// without forcing operators to rename their CSV columns.
export const BUILTIN_ALIASES: Record<"email" | "externalId" | "firstName" | "lastName", string[]> = {
  email: [
    "email",
    "emailaddress",
    "emailaddr",
    "mail",
  ],
  externalId: [
    "memberid",
    "membernumber",
    "membernum",
    "memberno",
    "customerid",
    "customernumber",
    "externalid",
    "id", // intentionally last — too generic, but works as a final fallback
  ],
  firstName: [
    "firstname",
    "first",
    "givenname",
    "fname",
  ],
  lastName: [
    "lastname",
    "last",
    "surname",
    "familyname",
    "lname",
  ],
};

export type ColumnMatch =
  | { kind: "typed"; column: "email" | "externalId" | "firstName" | "lastName"; sourceHeader: string }
  | { kind: "attribute"; attributeKeyId: string; key: string; sourceHeader: string }
  | { kind: "unmapped"; sourceHeader: string };

// matchColumns returns one ColumnMatch per source header with the suggested
// destination. Caller is expected to render these in a UI step, allow user
// overrides, then persist the resolved mapping.
//
// `firstName` and `lastName` are treated as attribute mappings (not typed
// columns) because Contact has no typed firstName/lastName today. They get
// auto-mapped if a corresponding ContactAttributeKey already exists; otherwise
// the user can click "create new key" with the alias's canonical key name.
export function matchColumns(
  sourceHeaders: string[],
  existingKeys: { id: string; key: string }[]
): ColumnMatch[] {
  const keysByNormalized = new Map(existingKeys.map((k) => [normalizeHeader(k.key), k]));

  return sourceHeaders.map((sourceHeader): ColumnMatch => {
    const normalized = normalizeHeader(sourceHeader);

    // Built-in alias check first — typed columns (email, externalId) take
    // precedence over attribute columns even if a key exists with the same
    // name.
    if (BUILTIN_ALIASES.email.includes(normalized)) {
      return { kind: "typed", column: "email", sourceHeader };
    }
    if (BUILTIN_ALIASES.externalId.includes(normalized)) {
      return { kind: "typed", column: "externalId", sourceHeader };
    }
    // firstName/lastName: prefer existing attribute key match if present;
    // otherwise unmapped (caller can create the key).
    for (const [aliasGroup, aliases] of [
      ["firstName", BUILTIN_ALIASES.firstName] as const,
      ["lastName", BUILTIN_ALIASES.lastName] as const,
    ]) {
      if (aliases.includes(normalized)) {
        const existing = keysByNormalized.get(aliasGroup);
        if (existing) {
          return { kind: "attribute", attributeKeyId: existing.id, key: existing.key, sourceHeader };
        }
        return { kind: "unmapped", sourceHeader };
      }
    }

    // Direct attribute-key match (header normalizes to an existing key).
    const direct = keysByNormalized.get(normalized);
    if (direct) {
      return { kind: "attribute", attributeKeyId: direct.id, key: direct.key, sourceHeader };
    }

    return { kind: "unmapped", sourceHeader };
  });
}

// Persisted shape of a column mapping (stored as JSON on ContactSync.columnMapping
// or in audience CSV import config). Keys are SOURCE headers (preserving the
// raw header from the CSV / query), values describe the destination.
export type ColumnMappingConfig = Record<
  string,
  | { kind: "typed"; column: "email" | "externalId" | "firstName" | "lastName" }
  | { kind: "attribute"; attributeKeyId: string }
  | { kind: "skip" }
>;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run modules/contacts/lib/column-mapping.test.ts 2>&1 | tail -10
```

Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/modules/contacts/lib/column-mapping.ts apps/web/modules/contacts/lib/column-mapping.test.ts
git commit -m "feat(contacts): shared column-mapping module for ingest paths

Used by Snowflake sync (ContactSync.columnMapping) and CSV importer.
Header normalization + built-in aliases (email, member ID, first/last
name variants) + matcher that returns suggested destination per source
header (typed column / existing attribute / unmapped)."
```

---

## Task 5: Multi-row Snowflake query function

**Goal:** Add `executeConfiguredQueryAllRows(queryId)` to the Snowflake service so the sync runner can fetch all rows (existing `executeConfiguredQuery` returns just `rows[0]`).

**Files:**
- Modify: `apps/web/app/api/member-lookup/configurable-query-service.ts`

**Acceptance Criteria:**
- [ ] New exported function `executeConfiguredQueryAllRows(queryId, parameters?)` returns `Record<string, unknown>[]`.
- [ ] Existing `executeConfiguredQuery` behavior unchanged.
- [ ] No field mapping applied (sync needs raw column names to honor its own column-mapping config).
- [ ] Cache is bypassed (sync always wants live data).

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run app/api/member-lookup 2>&1 | tail -10
```
Expected: existing tests pass; if no tests exist, just verify it compiles via `pnpm exec tsc --noEmit`.

**Steps:**

- [ ] **Step 1: Add the new function**

Append to `apps/web/app/api/member-lookup/configurable-query-service.ts` (after `executeConfiguredQuery`):

```typescript
/**
 * Execute a configured query and return ALL rows with raw column names.
 *
 * Used by the Contact sync runner: unlike executeConfiguredQuery (which
 * returns rows[0] mapped to the queryConfig.fields output schema), this
 * variant returns the full result set with original SQL column names so
 * callers can apply their own ColumnMapping. Cache is bypassed because
 * sync runs always want live data.
 */
export async function executeConfiguredQueryAllRows(
  queryId: string,
  parameters: Record<string, unknown> = {}
): Promise<Record<string, unknown>[]> {
  const queryConfig = getQueryConfig(queryId);
  const validation = validateQueryConfig(queryConfig);
  if (!validation.valid) {
    throw new Error(`Invalid query configuration: ${validation.errors.join(", ")}`);
  }

  // The sync use case typically uses parameter-less master queries; we still
  // pass parameters through for flexibility.
  const missingParams = queryConfig.parameters.filter((param) => !(param in parameters));
  if (missingParams.length > 0) {
    throw new Error(`Missing required parameters: ${missingParams.join(", ")}`);
  }

  const { sql, binds } = convertNamedParameters(queryConfig.sql, parameters);
  const rows = await executeQuery<Record<string, unknown>>(sql, binds);
  return rows;
}
```

- [ ] **Step 2: Verify compile**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep "configurable-query-service" || echo "No errors in target file"
```

Expected: "No errors in target file."

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/member-lookup/configurable-query-service.ts
git commit -m "feat(snowflake): add executeConfiguredQueryAllRows for sync use case

Existing executeConfiguredQuery returns only rows[0] mapped to the
queryConfig.fields shape (single-lookup use case). The Contact sync
runner needs the full result set with raw column names to apply its
own ColumnMapping; cache is bypassed since sync wants live data."
```

---

## Task 6: Sync algorithm

**Goal:** Implement the core sync algorithm in `apps/web/modules/contacts/lib/sync.ts`. Pure function (config + rows in → contact mutations + run summary out) so it's testable without mocking Prisma.

**Files:**
- Create: `apps/web/modules/contacts/lib/sync.ts`
- Create: `apps/web/modules/contacts/lib/sync.test.ts`

**Acceptance Criteria:**
- [ ] `runContactSync(syncId)` opens a `ContactSyncRun`, fetches Snowflake rows, processes them, writes the run summary.
- [ ] Match order: by (env, externalId) → by (env, email).
- [ ] No match → create with `source=snowflake`.
- [ ] Match where `source=snowflake` → update mapped attributes, clear inactive flag.
- [ ] Match where `source=manual|csv` → SKIP (do not update).
- [ ] After processing rows: contacts with `source=snowflake AND externalId NOT IN seen` get `inactive=true, inactiveAt=now()`.
- [ ] Errors during processing → mark run as `failed`, capture errorMessage.
- [ ] Returns run summary `{ rowsProcessed, rowsCreated, rowsUpdated, rowsDeactivated }`.
- [ ] Tests cover: create new, update existing snowflake, skip manual, deactivate dropped, error path.

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run modules/contacts/lib/sync.test.ts 2>&1 | tail -20
```
Expected: all green.

**Steps:**

- [ ] **Step 1: Write tests first**

Create `apps/web/modules/contacts/lib/sync.test.ts`:

```typescript
import { describe, expect, test, beforeEach, vi } from "vitest";
import { runContactSync } from "./sync";
import { prisma } from "@formbricks/database";
import { executeConfiguredQueryAllRows } from "@/app/api/member-lookup/configurable-query-service";

vi.mock("@formbricks/database", () => ({
  prisma: {
    contactSync: { findUnique: vi.fn(), update: vi.fn() },
    contactSyncRun: { create: vi.fn(), update: vi.fn() },
    contact: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    contactAttribute: { upsert: vi.fn() },
    $transaction: vi.fn((cbOrOps) =>
      typeof cbOrOps === "function" ? cbOrOps(prisma) : Promise.all(cbOrOps)
    ),
  },
}));

vi.mock("@/app/api/member-lookup/configurable-query-service", () => ({
  executeConfiguredQueryAllRows: vi.fn(),
}));

const baseSync = {
  id: "sync1",
  environmentId: "env1",
  snowflakeQueryId: "members",
  columnMapping: {
    EMAIL: { kind: "typed", column: "email" },
    MEMBER_ID: { kind: "typed", column: "externalId" },
    REGION: { kind: "attribute", attributeKeyId: "k_region" },
  },
  intervalMinutes: 60,
  enabled: true,
  lastRunAt: null,
  lastRunStatus: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.contactSync.findUnique as any).mockResolvedValue(baseSync);
  (prisma.contactSyncRun.create as any).mockResolvedValue({ id: "run1" });
  (prisma.contactSyncRun.update as any).mockResolvedValue({});
  (prisma.contactSync.update as any).mockResolvedValue({});
  (prisma.contact.updateMany as any).mockResolvedValue({ count: 0 });
});

describe("runContactSync", () => {
  test("creates new contact when no match by externalId or email", async () => {
    (executeConfiguredQueryAllRows as any).mockResolvedValue([
      { EMAIL: "alice@example.com", MEMBER_ID: "M1", REGION: "NE" },
    ]);
    (prisma.contact.findUnique as any).mockResolvedValue(null);
    (prisma.contact.findFirst as any).mockResolvedValue(null);
    (prisma.contact.create as any).mockResolvedValue({ id: "c1" });

    const result = await runContactSync("sync1");

    expect(result.rowsCreated).toBe(1);
    expect(prisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          environmentId: "env1",
          email: "alice@example.com",
          externalId: "M1",
          source: "snowflake",
        }),
      })
    );
  });

  test("updates existing snowflake contact and clears inactive flag", async () => {
    (executeConfiguredQueryAllRows as any).mockResolvedValue([
      { EMAIL: "bob@example.com", MEMBER_ID: "M2", REGION: "MW" },
    ]);
    (prisma.contact.findUnique as any).mockResolvedValueOnce({
      id: "c2",
      source: "snowflake",
      inactive: true,
    });

    const result = await runContactSync("sync1");

    expect(result.rowsUpdated).toBe(1);
    expect(prisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c2" },
        data: expect.objectContaining({ inactive: false, inactiveAt: null }),
      })
    );
  });

  test("skips manual contacts (does not update)", async () => {
    (executeConfiguredQueryAllRows as any).mockResolvedValue([
      { EMAIL: "carol@example.com", MEMBER_ID: "M3", REGION: "S" },
    ]);
    (prisma.contact.findUnique as any).mockResolvedValueOnce(null);
    (prisma.contact.findFirst as any).mockResolvedValueOnce({
      id: "c3",
      source: "manual",
      inactive: false,
    });

    const result = await runContactSync("sync1");

    expect(result.rowsUpdated).toBe(0);
    expect(prisma.contact.update).not.toHaveBeenCalled();
  });

  test("deactivates snowflake contacts not in result set", async () => {
    (executeConfiguredQueryAllRows as any).mockResolvedValue([
      { EMAIL: "alice@example.com", MEMBER_ID: "M1", REGION: "NE" },
    ]);
    (prisma.contact.findUnique as any).mockResolvedValue({
      id: "c1",
      source: "snowflake",
      inactive: false,
    });
    (prisma.contact.updateMany as any).mockResolvedValue({ count: 5 });

    const result = await runContactSync("sync1");

    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: {
        environmentId: "env1",
        source: "snowflake",
        externalId: { notIn: ["M1"] },
        inactive: false,
      },
      data: expect.objectContaining({ inactive: true }),
    });
    expect(result.rowsDeactivated).toBe(5);
  });

  test("marks run as failed on error", async () => {
    (executeConfiguredQueryAllRows as any).mockRejectedValue(new Error("Snowflake timeout"));

    await expect(runContactSync("sync1")).rejects.toThrow("Snowflake timeout");

    expect(prisma.contactSyncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run1" },
        data: expect.objectContaining({ status: "failed", errorMessage: "Snowflake timeout" }),
      })
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run modules/contacts/lib/sync.test.ts 2>&1 | tail -10
```

Expected: FAIL — sync module not found.

- [ ] **Step 3: Implement the sync module**

Create `apps/web/modules/contacts/lib/sync.ts`:

```typescript
import "server-only";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { executeConfiguredQueryAllRows } from "@/app/api/member-lookup/configurable-query-service";
import type { ColumnMappingConfig } from "./column-mapping";

export interface SyncRunResult {
  rowsProcessed: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsDeactivated: number;
}

// Runs one Contact sync: fetches all rows from the configured Snowflake query,
// upserts matching Contacts, and deactivates Snowflake-source contacts that
// dropped out of the result set. Manual-source contacts are never touched.
//
// Idempotent and crash-safe: every run is a full upsert. Concurrent runs of
// the same sync are not expected (single cron caller per sync) but would not
// corrupt state — they'd just compete on the same rows.
export async function runContactSync(syncId: string): Promise<SyncRunResult> {
  const sync = await prisma.contactSync.findUnique({ where: { id: syncId } });
  if (!sync) throw new Error(`ContactSync not found: ${syncId}`);

  const run = await prisma.contactSyncRun.create({
    data: { syncId, status: "running" },
    select: { id: true },
  });

  const summary: SyncRunResult = {
    rowsProcessed: 0,
    rowsCreated: 0,
    rowsUpdated: 0,
    rowsDeactivated: 0,
  };

  try {
    const mapping = sync.columnMapping as ColumnMappingConfig;
    const rows = await executeConfiguredQueryAllRows(sync.snowflakeQueryId);
    const seenExternalIds: string[] = [];

    for (const row of rows) {
      summary.rowsProcessed++;
      const extracted = extractFromRow(row, mapping);
      if (!extracted.email && !extracted.externalId) {
        // No identifying field — skip (would create dangling Contact otherwise).
        continue;
      }
      if (extracted.externalId) seenExternalIds.push(extracted.externalId);
      const result = await upsertContact(sync.environmentId, extracted);
      if (result === "created") summary.rowsCreated++;
      else if (result === "updated") summary.rowsUpdated++;
      // "skipped" means manual contact — no counter increment.
    }

    // Deactivate snowflake-source contacts that aren't in this result set.
    // Only acts on currently-active rows; idempotent on repeated runs.
    const deactivated = await prisma.contact.updateMany({
      where: {
        environmentId: sync.environmentId,
        source: "snowflake",
        externalId: seenExternalIds.length > 0 ? { notIn: seenExternalIds } : undefined,
        inactive: false,
      },
      data: { inactive: true, inactiveAt: new Date() },
    });
    summary.rowsDeactivated = deactivated.count;

    await prisma.contactSyncRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        ...summary,
      },
    });

    await prisma.contactSync.update({
      where: { id: syncId },
      data: { lastRunAt: new Date(), lastRunStatus: "succeeded" },
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ syncId, error }, "Contact sync failed");

    await prisma.contactSyncRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: message,
        ...summary, // preserve partial counts up to the error
      },
    });
    await prisma.contactSync.update({
      where: { id: syncId },
      data: { lastRunAt: new Date(), lastRunStatus: "failed" },
    });

    throw error;
  }
}

// Project a Snowflake row through the column mapping to typed fields + attribute
// assignments. Keys in mapping are the SOURCE headers (Snowflake column names).
type ExtractedRow = {
  email: string | null;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  attributeAssignments: { attributeKeyId: string; value: string }[];
};

function extractFromRow(row: Record<string, unknown>, mapping: ColumnMappingConfig): ExtractedRow {
  const out: ExtractedRow = {
    email: null,
    externalId: null,
    firstName: null,
    lastName: null,
    attributeAssignments: [],
  };

  for (const [sourceHeader, dest] of Object.entries(mapping)) {
    if (dest.kind === "skip") continue;
    const raw = row[sourceHeader];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (!value) continue;

    if (dest.kind === "typed") {
      if (dest.column === "email") out.email = value.toLowerCase();
      else if (dest.column === "externalId") out.externalId = value;
      else if (dest.column === "firstName") out.firstName = value;
      else if (dest.column === "lastName") out.lastName = value;
    } else {
      out.attributeAssignments.push({ attributeKeyId: dest.attributeKeyId, value });
    }
  }

  return out;
}

async function upsertContact(
  environmentId: string,
  extracted: ExtractedRow
): Promise<"created" | "updated" | "skipped"> {
  // Match priority: externalId first, then email.
  let existing = extracted.externalId
    ? await prisma.contact.findUnique({
        where: {
          environmentId_externalId: { environmentId, externalId: extracted.externalId },
        },
        select: { id: true, source: true, inactive: true },
      })
    : null;

  if (!existing && extracted.email) {
    existing = await prisma.contact.findUnique({
      where: { environmentId_email: { environmentId, email: extracted.email } },
      select: { id: true, source: true, inactive: true },
    });
  }

  if (existing) {
    // Manual contacts are protected — sync never updates them.
    if (existing.source !== "snowflake") {
      return "skipped";
    }
    await prisma.contact.update({
      where: { id: existing.id },
      data: {
        email: extracted.email ?? undefined,
        externalId: extracted.externalId ?? undefined,
        inactive: false,
        inactiveAt: null,
      },
    });
    await applyAttributes(existing.id, extracted.attributeAssignments);
    return "updated";
  }

  const created = await prisma.contact.create({
    data: {
      environmentId,
      email: extracted.email,
      externalId: extracted.externalId,
      source: "snowflake",
    },
    select: { id: true },
  });
  await applyAttributes(created.id, extracted.attributeAssignments);
  return "created";
}

async function applyAttributes(
  contactId: string,
  assignments: { attributeKeyId: string; value: string }[]
): Promise<void> {
  for (const { attributeKeyId, value } of assignments) {
    await prisma.contactAttribute.upsert({
      where: { contactId_attributeKeyId: { contactId, attributeKeyId } },
      create: { contactId, attributeKeyId, value },
      update: { value },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm vitest run modules/contacts/lib/sync.test.ts 2>&1 | tail -20
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/modules/contacts/lib/sync.ts apps/web/modules/contacts/lib/sync.test.ts
git commit -m "feat(contacts): Snowflake → Contact sync algorithm

runContactSync(syncId) opens a ContactSyncRun, fetches rows from the
configured query, upserts matching Contacts, and deactivates
snowflake-source contacts that fell out of the result set. Manual
contacts are protected. Errors mark the run as failed but preserve
partial counts."
```

---

## Task 7: Cron integration

**Goal:** Wire `runDueSyncs()` into the existing `/api/cron/reminders` endpoint. Each sync is run only if `intervalMinutes` has elapsed since `lastRunAt` and `enabled=true`.

**Files:**
- Create: `apps/web/modules/contacts/lib/sync-runner.ts`
- Modify: `apps/web/app/api/cron/reminders/route.ts`

**Acceptance Criteria:**
- [ ] `runDueSyncs()` finds all enabled syncs whose interval has elapsed.
- [ ] Each due sync is invoked via `runContactSync(syncId)`. Errors per-sync don't fail the whole run; they're logged.
- [ ] `/api/cron/reminders` calls `runDueSyncs()` after the existing invitation/reminder drains.
- [ ] Response JSON includes a `syncs` summary with per-sync status.

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks/apps/web
curl -X POST -H "x-api-key: $CRON_SECRET" http://localhost:3001/api/cron/reminders
# Expected: response with { ok: true, invitations: ..., reminders: ..., syncs: ... }
```

**Steps:**

- [ ] **Step 1: Implement sync-runner**

Create `apps/web/modules/contacts/lib/sync-runner.ts`:

```typescript
import "server-only";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { runContactSync } from "./sync";

export interface DueSyncSummary {
  syncId: string;
  environmentId: string;
  status: "succeeded" | "failed";
  rowsProcessed?: number;
  rowsCreated?: number;
  rowsUpdated?: number;
  rowsDeactivated?: number;
  errorMessage?: string;
}

// Called from the cron endpoint. Scans for enabled syncs whose interval has
// elapsed and runs them. Per-sync errors are caught and logged so one sync
// failing doesn't prevent the others from running.
export async function runDueSyncs(): Promise<DueSyncSummary[]> {
  const now = new Date();
  const candidates = await prisma.contactSync.findMany({
    where: { enabled: true },
    select: {
      id: true,
      environmentId: true,
      intervalMinutes: true,
      lastRunAt: true,
    },
  });

  const due = candidates.filter((c) => {
    if (!c.lastRunAt) return true;
    const elapsedMs = now.getTime() - c.lastRunAt.getTime();
    return elapsedMs >= c.intervalMinutes * 60 * 1000;
  });

  const results: DueSyncSummary[] = [];

  for (const sync of due) {
    try {
      const summary = await runContactSync(sync.id);
      results.push({
        syncId: sync.id,
        environmentId: sync.environmentId,
        status: "succeeded",
        ...summary,
      });
    } catch (error) {
      logger.error({ syncId: sync.id, error }, "ContactSync run failed in cron loop");
      results.push({
        syncId: sync.id,
        environmentId: sync.environmentId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
```

- [ ] **Step 2: Wire into cron endpoint**

Edit `apps/web/app/api/cron/reminders/route.ts`:

```typescript
import { headers } from "next/headers";
import { logger } from "@formbricks/logger";
import { CRON_SECRET } from "@/lib/constants";
import { runDueSyncs } from "@/modules/contacts/lib/sync-runner";
import { runPendingInvitationSends } from "@/modules/survey/invitations/lib/invitations";
import { runScheduledReminders } from "@/modules/survey/invitations/lib/scheduled-reminders";

// POST /api/cron/reminders
// Auth: header `x-api-key: $CRON_SECRET`.
// Drains pending invitations, fires scheduled reminders, runs due Contact syncs.
// Each sub-task is independent; failure in one is logged but doesn't fail the
// rest.
export const POST = async (request: Request) => {
  const requestHeaders = await headers();
  if (!CRON_SECRET || requestHeaders.get("x-api-key") !== CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const result: Record<string, unknown> = {};
  try {
    result.invitations = await runPendingInvitationSends({});
  } catch (error) {
    logger.error({ error }, "invitation drain failed");
    result.invitations = { error: "failed" };
  }
  try {
    result.reminders = await runScheduledReminders();
  } catch (error) {
    logger.error({ error }, "reminder drain failed");
    result.reminders = { error: "failed" };
  }
  try {
    result.syncs = await runDueSyncs();
  } catch (error) {
    logger.error({ error, url: request.url }, "sync runner failed");
    result.syncs = { error: "failed" };
  }

  return Response.json({ ok: true, ...result });
};
```

- [ ] **Step 3: Smoke test**

Spin up local stack:

```bash
cd /Users/gcohen/dev/formbricks
docker compose -f docker-compose.local.yml up -d
sleep 10
curl -s -X POST -H "x-api-key: cron-test-secret" http://localhost:3001/api/cron/reminders | head -c 500
```

(Adjust `CRON_SECRET` value to whatever's in `.env.docker`.)

Expected: HTTP 200 with `{ ok: true, invitations: {...}, reminders: {...}, syncs: [] }`. Empty `syncs` array means no ContactSync configs exist yet — that's expected at this point.

- [ ] **Step 4: Commit**

```bash
git add apps/web/modules/contacts/lib/sync-runner.ts apps/web/app/api/cron/reminders/route.ts
git commit -m "feat(contacts): wire ContactSync into existing cron endpoint

runDueSyncs() finds enabled syncs whose intervalMinutes has elapsed and
runs each via runContactSync. Per-sync errors are isolated. The existing
/api/cron/reminders endpoint already runs every 5 min on the VM, so no
new system cron entry is needed."
```

---

## Task 8: Settings page — Snowflake Sync configuration

**Goal:** Build the Settings → Snowflake Sync page with a config form (pick query, configure column mapping, set interval).

**Files:**
- Create: `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/page.tsx`
- Create: `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/actions.ts`
- Create: `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/components/sync-config-form.tsx`

**Acceptance Criteria:**
- [ ] Page is gated by `getEnvironmentAuth` like the existing Settings pages.
- [ ] Form lets the operator: pick a Snowflake query from `query-config.json`, view sample rows + suggested column mapping, override mappings, set interval, save.
- [ ] Server action `saveSyncConfig` upserts the `ContactSync` row.
- [ ] Server action `runSyncNow` invokes `runContactSync` synchronously and returns the summary (or error message).

**Verify:**
- Local smoke test: visit `http://localhost:3001/environments/<envId>/settings/snowflake-sync`. Form renders. Saving creates a `ContactSync` row visible via `psql`.

**Steps:**

- [ ] **Step 1: Server actions**

Create `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@formbricks/database";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { runContactSync } from "@/modules/contacts/lib/sync";
import { executeConfiguredQueryAllRows } from "@/app/api/member-lookup/configurable-query-service";

const ZSaveSyncConfig = z.object({
  environmentId: z.string().cuid2(),
  snowflakeQueryId: z.string().min(1),
  columnMapping: z.record(z.unknown()),
  intervalMinutes: z.number().int().min(5).max(1440),
  enabled: z.boolean(),
});

export const saveSyncConfigAction = authenticatedActionClient
  .schema(ZSaveSyncConfig)
  .action(async ({ parsedInput }) => {
    // Upsert one sync per environment.
    const existing = await prisma.contactSync.findUnique({
      where: { environmentId: parsedInput.environmentId },
      select: { id: true },
    });
    if (existing) {
      await prisma.contactSync.update({
        where: { id: existing.id },
        data: {
          snowflakeQueryId: parsedInput.snowflakeQueryId,
          columnMapping: parsedInput.columnMapping,
          intervalMinutes: parsedInput.intervalMinutes,
          enabled: parsedInput.enabled,
        },
      });
    } else {
      await prisma.contactSync.create({
        data: {
          environmentId: parsedInput.environmentId,
          snowflakeQueryId: parsedInput.snowflakeQueryId,
          columnMapping: parsedInput.columnMapping,
          intervalMinutes: parsedInput.intervalMinutes,
          enabled: parsedInput.enabled,
        },
      });
    }

    revalidatePath(`/environments/${parsedInput.environmentId}/settings/snowflake-sync`);
    return { ok: true };
  });

const ZRunSyncNow = z.object({ environmentId: z.string().cuid2() });

export const runSyncNowAction = authenticatedActionClient
  .schema(ZRunSyncNow)
  .action(async ({ parsedInput }) => {
    const sync = await prisma.contactSync.findUnique({
      where: { environmentId: parsedInput.environmentId },
      select: { id: true },
    });
    if (!sync) throw new Error("No sync configured for this environment");
    const summary = await runContactSync(sync.id);
    revalidatePath(`/environments/${parsedInput.environmentId}/settings/snowflake-sync`);
    return summary;
  });

const ZPreviewQuery = z.object({ snowflakeQueryId: z.string().min(1) });

export const previewSnowflakeQueryAction = authenticatedActionClient
  .schema(ZPreviewQuery)
  .action(async ({ parsedInput }) => {
    const rows = await executeConfiguredQueryAllRows(parsedInput.snowflakeQueryId);
    // Return first 5 rows + the column headers from the first row.
    const sample = rows.slice(0, 5);
    const headers = sample.length > 0 ? Object.keys(sample[0]) : [];
    return { headers, sample, totalRows: rows.length };
  });
```

- [ ] **Step 2: Page server component**

Create `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/page.tsx`:

```typescript
import { prisma } from "@formbricks/database";
import { getEnvironmentAuth } from "@/modules/environments/lib/utils";
import { getQueryConfigList } from "@/app/api/member-lookup/query-config-loader";
import { PageContentWrapper } from "@/modules/ui/components/page-content-wrapper";
import { PageHeader } from "@/modules/ui/components/page-header";
import { SyncConfigForm } from "./components/sync-config-form";
import { SyncStatusPanel } from "./components/sync-status-panel";

export default async function SnowflakeSyncSettingsPage({
  params,
}: {
  params: Promise<{ environmentId: string }>;
}) {
  const { environmentId } = await params;
  await getEnvironmentAuth(environmentId);

  const [sync, attributeKeys, queryConfigs] = await Promise.all([
    prisma.contactSync.findUnique({
      where: { environmentId },
      include: {
        runs: { orderBy: { startedAt: "desc" }, take: 20 },
      },
    }),
    prisma.contactAttributeKey.findMany({
      where: { environmentId },
      select: { id: true, key: true },
      orderBy: { key: "asc" },
    }),
    getQueryConfigList(),
  ]);

  return (
    <PageContentWrapper>
      <PageHeader pageTitle="Snowflake Sync" />
      <div className="mx-auto max-w-4xl space-y-8">
        <p className="text-sm text-slate-600">
          Configure a Snowflake query to continuously mirror contacts into Formbricks. Synced
          contacts can be sliced in the Segments UI without writing SQL.
        </p>

        <SyncConfigForm
          environmentId={environmentId}
          existingConfig={sync}
          attributeKeys={attributeKeys}
          availableQueries={queryConfigs}
        />

        {sync && <SyncStatusPanel environmentId={environmentId} sync={sync} />}
      </div>
    </PageContentWrapper>
  );
}
```

This assumes a helper `getQueryConfigList()` exists in `query-config-loader.ts`. If not, add a simple wrapper:

```typescript
// In apps/web/app/api/member-lookup/query-config-loader.ts (append):
export function getQueryConfigList(): Array<{ id: string; description: string }> {
  // Returns all configured query IDs + descriptions for the UI picker.
  const all = require("./query-config.json");
  return Object.entries(all.queries ?? {}).map(([id, cfg]: [string, any]) => ({
    id,
    description: cfg.description ?? "",
  }));
}
```

(Inspect the actual `query-config-loader.ts` first; adapt the implementation to match the loader's existing patterns.)

- [ ] **Step 3: Client form component**

Create `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/components/sync-config-form.tsx`:

```typescript
"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/modules/ui/components/button";
import { Input } from "@/modules/ui/components/input";
import { Label } from "@/modules/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/ui/components/select";
import {
  matchColumns,
  type ColumnMappingConfig,
  type ColumnMatch,
} from "@/modules/contacts/lib/column-mapping";
import {
  saveSyncConfigAction,
  previewSnowflakeQueryAction,
} from "../actions";

interface Props {
  environmentId: string;
  existingConfig: {
    id: string;
    snowflakeQueryId: string;
    columnMapping: unknown;
    intervalMinutes: number;
    enabled: boolean;
  } | null;
  attributeKeys: { id: string; key: string }[];
  availableQueries: { id: string; description: string }[];
}

export function SyncConfigForm({
  environmentId,
  existingConfig,
  attributeKeys,
  availableQueries,
}: Props) {
  const [queryId, setQueryId] = useState(existingConfig?.snowflakeQueryId ?? "");
  const [intervalMinutes, setIntervalMinutes] = useState(existingConfig?.intervalMinutes ?? 60);
  const [enabled, setEnabled] = useState(existingConfig?.enabled ?? true);
  const [matches, setMatches] = useState<ColumnMatch[]>([]);
  const [mapping, setMapping] = useState<ColumnMappingConfig>(
    (existingConfig?.columnMapping as ColumnMappingConfig | null) ?? {}
  );
  const [previewSample, setPreviewSample] = useState<Record<string, unknown>[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handlePreview = async () => {
    if (!queryId) return;
    setIsPreviewing(true);
    const res = await previewSnowflakeQueryAction({ snowflakeQueryId: queryId });
    setIsPreviewing(false);
    if (!res?.data) {
      toast.error("Preview failed");
      return;
    }
    const headers = res.data.headers;
    const m = matchColumns(headers, attributeKeys);
    setMatches(m);
    setPreviewSample(res.data.sample);

    // Initialize mapping from suggested matches (if not already set)
    setMapping((prev) => {
      const next: ColumnMappingConfig = { ...prev };
      for (const match of m) {
        if (next[match.sourceHeader]) continue; // preserve user override
        if (match.kind === "typed") {
          next[match.sourceHeader] = { kind: "typed", column: match.column };
        } else if (match.kind === "attribute") {
          next[match.sourceHeader] = {
            kind: "attribute",
            attributeKeyId: match.attributeKeyId,
          };
        } else {
          next[match.sourceHeader] = { kind: "skip" };
        }
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!queryId) {
      toast.error("Pick a query first");
      return;
    }
    if (Object.keys(mapping).length === 0) {
      toast.error("Preview the query and configure column mapping first");
      return;
    }
    setIsSaving(true);
    const res = await saveSyncConfigAction({
      environmentId,
      snowflakeQueryId: queryId,
      columnMapping: mapping,
      intervalMinutes,
      enabled,
    });
    setIsSaving(false);
    if (res?.data?.ok) {
      toast.success("Sync config saved");
    } else {
      toast.error("Save failed");
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-800">Configuration</h2>

      <div>
        <Label htmlFor="queryId">Snowflake query</Label>
        <Select value={queryId} onValueChange={setQueryId}>
          <SelectTrigger>
            <SelectValue placeholder="Pick a query…" />
          </SelectTrigger>
          <SelectContent>
            {availableQueries.map((q) => (
              <SelectItem key={q.id} value={q.id}>
                {q.id} — {q.description || "(no description)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" size="sm" onClick={handlePreview} disabled={!queryId || isPreviewing}>
          {isPreviewing ? "Loading…" : "Preview rows + detect columns"}
        </Button>
      </div>

      {matches.length > 0 && (
        <div className="space-y-2">
          <Label>Column mapping</Label>
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-slate-600">
              <tr>
                <th className="py-1">Source column</th>
                <th className="py-1">→</th>
                <th className="py-1">Destination</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => {
                const current = mapping[m.sourceHeader];
                const value =
                  !current || current.kind === "skip"
                    ? "skip"
                    : current.kind === "typed"
                    ? `typed:${current.column}`
                    : `attr:${current.attributeKeyId}`;
                return (
                  <tr key={m.sourceHeader} className="border-b">
                    <td className="py-2 font-mono text-xs">{m.sourceHeader}</td>
                    <td className="py-2 text-slate-400">→</td>
                    <td className="py-2">
                      <Select
                        value={value}
                        onValueChange={(v) => {
                          let next: ColumnMappingConfig[string];
                          if (v === "skip") next = { kind: "skip" };
                          else if (v.startsWith("typed:")) {
                            next = {
                              kind: "typed",
                              column: v.slice(6) as "email" | "externalId" | "firstName" | "lastName",
                            };
                          } else {
                            next = { kind: "attribute", attributeKeyId: v.slice(5) };
                          }
                          setMapping((prev) => ({ ...prev, [m.sourceHeader]: next }));
                        }}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">— Skip —</SelectItem>
                          <SelectItem value="typed:email">email (Contact column)</SelectItem>
                          <SelectItem value="typed:externalId">externalId / member# (Contact column)</SelectItem>
                          <SelectItem value="typed:firstName">firstName</SelectItem>
                          <SelectItem value="typed:lastName">lastName</SelectItem>
                          {attributeKeys.map((k) => (
                            <SelectItem key={k.id} value={`attr:${k.id}`}>
                              {k.key} (attribute)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="interval">Sync interval (minutes)</Label>
          <Input
            id="interval"
            type="number"
            min={5}
            max={1440}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(parseInt(e.target.value, 10) || 60)}
          />
        </div>
        <div className="flex items-end gap-2">
          <input
            type="checkbox"
            id="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <Label htmlFor="enabled">Enabled</Label>
        </div>
      </div>

      <Button onClick={handleSave} disabled={isSaving}>
        {isSaving ? "Saving…" : "Save configuration"}
      </Button>
    </section>
  );
}
```

- [ ] **Step 4: Smoke test**

Spin up local stack and visit `http://localhost:3001/environments/<envId>/settings/snowflake-sync`. Pick a query (the registry is in `query-config.json`), click Preview. Verify mappings auto-populate. Save and check the DB:

```bash
docker compose -f docker-compose.local.yml exec postgres psql -U postgres -d formbricks \
  -c "SELECT id, \"environmentId\", \"snowflakeQueryId\", \"intervalMinutes\", enabled FROM \"ContactSync\";"
```

Expected: row exists.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(app\)/environments/\[environmentId\]/settings/snowflake-sync \
        apps/web/app/api/member-lookup/query-config-loader.ts
git commit -m "feat(contacts): Settings → Snowflake Sync configuration page

Form to pick a Snowflake query, preview rows, configure column mapping
(via shared module), set interval. Server actions for save + run-now."
```

---

## Task 9: Settings page — sync status + run history

**Goal:** Add the status panel showing last run, recent runs, "Run sync now" button.

**Files:**
- Create: `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/components/sync-status-panel.tsx`

**Acceptance Criteria:**
- [ ] Shows last run timestamp + status badge.
- [ ] Shows last 20 runs in a table (started, finished, status, rows).
- [ ] "Run sync now" button kicks off `runSyncNowAction` and updates the page on success.
- [ ] Errors surface clearly (failed runs show errorMessage).

**Verify:** UI smoke test — click Run sync now, verify a row appears in the runs table.

**Steps:**

- [ ] **Step 1: Implement the panel**

Create `apps/web/app/(app)/environments/[environmentId]/settings/snowflake-sync/components/sync-status-panel.tsx`:

```typescript
"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/modules/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/ui/components/table";
import { runSyncNowAction } from "../actions";

interface Run {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: "pending" | "running" | "succeeded" | "failed";
  rowsProcessed: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsDeactivated: number;
  errorMessage: string | null;
}

interface Props {
  environmentId: string;
  sync: {
    id: string;
    lastRunAt: Date | null;
    lastRunStatus: "pending" | "running" | "succeeded" | "failed" | null;
    runs: Run[];
  };
}

const formatDate = (d: Date | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const StatusBadge = ({ status }: { status: Run["status"] }) => {
  const styles = {
    pending: "bg-slate-100 text-slate-600",
    running: "bg-amber-100 text-amber-700",
    succeeded: "bg-emerald-100 text-emerald-700",
    failed: "bg-rose-100 text-rose-700",
  } as const;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
};

export function SyncStatusPanel({ environmentId, sync }: Props) {
  const [isRunning, setIsRunning] = useState(false);

  const handleRunNow = async () => {
    setIsRunning(true);
    const res = await runSyncNowAction({ environmentId });
    setIsRunning(false);
    if (res?.data) {
      toast.success(
        `Synced ${res.data.rowsProcessed} rows: ${res.data.rowsCreated} created, ${res.data.rowsUpdated} updated, ${res.data.rowsDeactivated} deactivated`
      );
      // Server-component-side data is stale; trigger reload via Next router refresh.
      // (Or rely on revalidatePath in the server action to update on next nav.)
      window.location.reload();
    } else {
      toast.error("Sync failed — check run history below for details");
      window.location.reload();
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Status</h2>
        <Button onClick={handleRunNow} disabled={isRunning}>
          {isRunning ? "Running…" : "Run sync now"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-slate-500">Last run</div>
          <div className="text-slate-800">{formatDate(sync.lastRunAt)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Last status</div>
          <div>{sync.lastRunStatus ? <StatusBadge status={sync.lastRunStatus} /> : "—"}</div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-700">Recent runs</h3>
        <div className="overflow-auto rounded-md border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Started</TableHead>
                <TableHead className="text-xs">Finished</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Processed</TableHead>
                <TableHead className="text-xs">Created</TableHead>
                <TableHead className="text-xs">Updated</TableHead>
                <TableHead className="text-xs">Deactivated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sync.runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-3 text-center text-xs text-slate-500">
                    No runs yet — click "Run sync now" or wait for the next scheduled run.
                  </TableCell>
                </TableRow>
              ) : (
                sync.runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="py-2 text-xs">{formatDate(r.startedAt)}</TableCell>
                    <TableCell className="py-2 text-xs">{formatDate(r.finishedAt)}</TableCell>
                    <TableCell className="py-2">
                      <StatusBadge status={r.status} />
                      {r.errorMessage && (
                        <div className="mt-1 max-w-xs truncate text-xs text-rose-700" title={r.errorMessage}>
                          {r.errorMessage}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-2 text-xs">{r.rowsProcessed}</TableCell>
                    <TableCell className="py-2 text-xs">{r.rowsCreated}</TableCell>
                    <TableCell className="py-2 text-xs">{r.rowsUpdated}</TableCell>
                    <TableCell className="py-2 text-xs">{r.rowsDeactivated}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Smoke test**

Visit the settings page; click "Run sync now". Verify a run row appears, status updates, error shows on failure.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/\(app\)/environments/\[environmentId\]/settings/snowflake-sync/components/sync-status-panel.tsx
git commit -m "feat(contacts): Settings → Snowflake Sync status panel

Last run timestamp + status badge, recent runs table (last 20),
'Run sync now' button. Errors surface inline with the failing run."
```

---

## Task 10: CSV importer extension

**Goal:** Extend the existing CSV import in `recipients-card.tsx` (or extract to a reusable importer component used here AND in Phase 1b's Audiences page) to capture arbitrary columns as Contact attributes via the shared column-mapping module.

**Files:**
- Modify: `apps/web/modules/survey/invitations/components/recipients-card.tsx`
- Modify: `apps/web/modules/survey/invitations/lib/audience.ts` (resolve manualList from saved Contact attributes when needed)

**Acceptance Criteria:**
- [ ] CSV upload reads ALL columns (not just email/firstName/lastName).
- [ ] Column-mapping modal step lets the operator confirm/override the suggested mapping.
- [ ] On send: rows upsert into Contacts as `source=csv` with the mapped attributes populated.
- [ ] Existing email-only / 3-column CSV uploads continue to work without forcing a mapping step (auto-detect, skip modal if all columns auto-map cleanly).

**Verify:** Upload a CSV with email + firstName + region. Send invitations. Open a contact → verify `region` attribute persists.

**Steps:**

- [ ] **Step 1: Read the existing CSV path**

The current logic lives in `recipients-card.tsx:63-150` (`parseCsv`, `csvToRecipients`, `HEADER_ALIASES`). Replace this inline logic with a call to the shared `matchColumns` module + a new modal component.

- [ ] **Step 2: Create the column-mapping modal**

Create `apps/web/modules/contacts/components/csv-column-mapping-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Button } from "@/modules/ui/components/button";
import { Label } from "@/modules/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/ui/components/select";
import { type ColumnMappingConfig } from "@/modules/contacts/lib/column-mapping";

interface Props {
  sourceHeaders: string[];
  initialMapping: ColumnMappingConfig;
  attributeKeys: { id: string; key: string }[];
  onConfirm: (mapping: ColumnMappingConfig) => void;
  onCancel: () => void;
}

export function CsvColumnMappingModal({
  sourceHeaders,
  initialMapping,
  attributeKeys,
  onConfirm,
  onCancel,
}: Props) {
  const [mapping, setMapping] = useState<ColumnMappingConfig>(initialMapping);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Map CSV columns</h2>
        <p className="mb-4 text-sm text-slate-600">
          We auto-mapped {Object.values(initialMapping).filter((m) => m.kind !== "skip").length} of{" "}
          {sourceHeaders.length} columns. Review and adjust below, then click Continue.
        </p>

        <div className="max-h-96 overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs">
              <tr>
                <th className="px-3 py-2">Source column</th>
                <th className="px-3 py-2">→</th>
                <th className="px-3 py-2">Destination</th>
              </tr>
            </thead>
            <tbody>
              {sourceHeaders.map((header) => {
                const current = mapping[header];
                const value =
                  !current || current.kind === "skip"
                    ? "skip"
                    : current.kind === "typed"
                    ? `typed:${current.column}`
                    : `attr:${current.attributeKeyId}`;
                return (
                  <tr key={header} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{header}</td>
                    <td className="px-3 py-2 text-slate-400">→</td>
                    <td className="px-3 py-2">
                      <Select
                        value={value}
                        onValueChange={(v) => {
                          let next: ColumnMappingConfig[string];
                          if (v === "skip") next = { kind: "skip" };
                          else if (v.startsWith("typed:")) {
                            next = {
                              kind: "typed",
                              column: v.slice(6) as "email" | "externalId" | "firstName" | "lastName",
                            };
                          } else {
                            next = { kind: "attribute", attributeKeyId: v.slice(5) };
                          }
                          setMapping((prev) => ({ ...prev, [header]: next }));
                        }}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">— Skip —</SelectItem>
                          <SelectItem value="typed:email">email</SelectItem>
                          <SelectItem value="typed:externalId">externalId / member#</SelectItem>
                          <SelectItem value="typed:firstName">firstName</SelectItem>
                          <SelectItem value="typed:lastName">lastName</SelectItem>
                          {attributeKeys.map((k) => (
                            <SelectItem key={k.id} value={`attr:${k.id}`}>
                              {k.key} (attribute)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(mapping)}>Continue</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into recipients-card**

Update `apps/web/modules/survey/invitations/components/recipients-card.tsx`:

1. Replace the inline `csvToRecipients` logic with a call to `matchColumns`. If all columns auto-map cleanly (no `unmapped`), skip the modal. Otherwise show the modal, get user-confirmed mapping, then process.
2. After parsing, store the row data with all mapped attributes (not just email/firstName/lastName). New shape:
   ```typescript
   type TManualRecipient = {
     email: string;
     firstName?: string;
     lastName?: string;
     externalId?: string;
     attributes?: { attributeKeyId: string; value: string }[];
   };
   ```
3. Update `audience.ts:resolveManualListAudience` to apply attributes to created Contacts (extend the lazy-create path).

(This step is the largest UI change in Task 10. Read the existing recipients-card carefully before editing; preserve all existing UX paths.)

- [ ] **Step 4: Smoke test**

Upload a CSV with `email,firstName,region`. Confirm the column mapping modal appears (because `region` isn't auto-mapped to a typed column unless an attribute key already exists). Confirm "create new key for region" works. Send invitations. Verify the resulting Contact has the `region` attribute set.

- [ ] **Step 5: Commit**

```bash
git add apps/web/modules/contacts/components/csv-column-mapping-modal.tsx \
        apps/web/modules/survey/invitations/components/recipients-card.tsx \
        apps/web/modules/survey/invitations/lib/audience.ts
git commit -m "feat(contacts): CSV importer captures arbitrary columns as attributes

Replaces the 3-column-only CSV parser with the shared column-mapping
module. Modal step appears when columns don't auto-map; user can
override or skip. Manually-uploaded contacts get source=csv."
```

---

## Task 11: Contact detail — source badge + sync-managed markers

**Goal:** Make the source of each Contact visible (and synced fields read-only) on the detail page.

**Files:**
- Modify: `apps/web/modules/ee/contacts/[contactId]/components/attributes-section.tsx`
- Modify: `apps/web/modules/ee/contacts/[contactId]/page.tsx` (pass `source` + `inactive` info down)

**Acceptance Criteria:**
- [ ] Top of attributes section shows source badge: "Synced from Snowflake — last updated <date>" or "Manually added on <date>" or "Imported from CSV on <date>".
- [ ] If `inactive=true`, prominent inactive banner.
- [ ] Each attribute that came from sync (looks up against the latest `ContactSyncRun` configuration) gets a "from Snowflake" badge.
- [ ] Email + externalId fields show their typed values.

**Verify:** Visit a contact detail page after a sync run. Verify badges + read-only markers display correctly for both Snowflake and manual contacts.

**Steps:**

- [ ] **Step 1: Update attributes-section to read typed columns**

Edit `apps/web/modules/ee/contacts/[contactId]/components/attributes-section.tsx`:

Replace the existing `getContact()` call to also fetch `email`, `externalId`, `source`, `inactive`, `inactiveAt`. Display them with badges. Also fetch the environment's `ContactSync.columnMapping` to identify which attribute keys are sync-managed.

```typescript
// Add at top of file, after existing imports:
import { prisma } from "@formbricks/database";

// Inside the component, after fetching contact + attributes:
const contactSource = await prisma.contact.findUnique({
  where: { id: contactId },
  select: { source: true, inactive: true, inactiveAt: true, email: true, externalId: true },
});

const sync = await prisma.contactSync.findFirst({
  where: { environmentId: contact.environmentId },
  select: { columnMapping: true },
});

const syncManagedKeyIds = new Set<string>();
if (sync?.columnMapping && contactSource?.source === "snowflake") {
  for (const dest of Object.values(sync.columnMapping as Record<string, any>)) {
    if (dest?.kind === "attribute" && dest.attributeKeyId) {
      syncManagedKeyIds.add(dest.attributeKeyId);
    }
  }
}
```

Then add the source badge near the top of the section:

```tsx
{contactSource && (
  <div>
    <SourceBadge source={contactSource.source} inactiveAt={contactSource.inactiveAt} />
    {contactSource.inactive && (
      <div className="mt-2 rounded-md bg-rose-50 p-2 text-xs text-rose-700">
        Inactive — removed from source on {contactSource.inactiveAt?.toLocaleDateString()}
      </div>
    )}
  </div>
)}
```

Define `SourceBadge` inline:

```tsx
const SourceBadge = ({ source, inactiveAt }: { source: string; inactiveAt: Date | null }) => {
  if (source === "snowflake") {
    return (
      <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
        Synced from Snowflake
      </span>
    );
  }
  if (source === "csv") {
    return (
      <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        Imported from CSV
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      Manually added
    </span>
  );
};
```

For each attribute row, if `syncManagedKeyIds.has(<that attribute's keyId>)`, render a small "from Snowflake" badge next to the value. Today's render path uses `attributeData` — pass the keyId through. The existing `getContactAttributes` returns `{ [key: string]: value }` — you'll need to thread keyIds through, which may require changes to that helper. (If too invasive: simplify by saying any attribute on a snowflake-source contact is sync-managed.)

- [ ] **Step 2: Smoke test**

Visit a Snowflake-synced contact's detail page. Verify the "Synced from Snowflake" badge. For an inactive contact, verify the banner. For a manual contact, verify "Manually added."

- [ ] **Step 3: Commit**

```bash
git add apps/web/modules/ee/contacts/\[contactId\]/components/attributes-section.tsx \
        apps/web/modules/ee/contacts/\[contactId\]/page.tsx
git commit -m "feat(contacts): contact detail source badge + sync-managed markers

Snowflake/manual/csv source badge at top of the attributes section.
Inactive contacts get a prominent banner. Sync-managed attribute keys
get a 'from Snowflake' badge inline with the value."
```

---

## Task 12: Contacts list — source + active filters

**Goal:** Add source (snowflake/manual/csv) and active/inactive filters to the contacts list page.

**Files:**
- Modify: `apps/web/app/(app)/environments/[environmentId]/(contacts)/contacts/page.tsx`
- Modify: the contacts list query helper (likely `apps/web/modules/ee/contacts/lib/contacts.ts`'s `getContactsForEnvironment` or similar — confirm exact name when starting the task)

**Acceptance Criteria:**
- [ ] URL query param `?source=snowflake|manual|csv` filters the list.
- [ ] URL query param `?active=true|false` filters by inactive flag (default: active only).
- [ ] Filter UI controls update the query params (preserving existing pagination).
- [ ] Default view = active contacts of all sources (matches current behavior except "active only" is new).

**Verify:** Visit `/environments/<env>/contacts?source=snowflake&active=true`. Only active Snowflake contacts appear. Toggle filter → URL updates → list updates.

**Steps:**

- [ ] **Step 1: Locate the existing query helper**

```bash
grep -rn "getContacts\|contactsList" /Users/gcohen/dev/formbricks/apps/web/modules/ee/contacts/lib/contacts.ts | head -10
```

Confirm the function name; for the rest of these steps assume it's `getContactsForEnvironment` (rename in steps if different).

- [ ] **Step 2: Extend the helper signature**

Add optional filters:

```typescript
export const getContactsForEnvironment = async (
  environmentId: string,
  opts: { source?: "snowflake" | "manual" | "csv"; active?: boolean } = {}
) => {
  return prisma.contact.findMany({
    where: {
      environmentId,
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.active !== undefined ? { inactive: !opts.active } : { inactive: false }),
    },
    // ... existing select/orderBy/skip/take
  });
};
```

- [ ] **Step 3: Page reads + applies filters**

In the contacts list page, parse `searchParams.source` and `searchParams.active`, pass to the helper. Add filter chips (similar pattern to the recipient-list-table chips already in the codebase) that update the URL.

- [ ] **Step 4: Smoke test**

Verify the filters work end-to-end via URL params, and via clicking the chips.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(app\)/environments/\[environmentId\]/\(contacts\)/contacts \
        apps/web/modules/ee/contacts/lib/contacts.ts
git commit -m "feat(contacts): source + active filters on contacts list page

URL query params (?source=, ?active=) filter the list. Default is
active contacts of all sources. Filter chips update the URL preserving
pagination."
```

---

## Final verification

After all 12 tasks are committed:

- [ ] Run the full test suite: `pnpm vitest run` (allow tests in unrelated areas to pass; address any new failures introduced by Phase 1a).
- [ ] Type-check: `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` (only check that new/modified files have no errors).
- [ ] Smoke: spin up the local docker stack, configure a sync against a real Snowflake query (or a stub query that returns canned rows), trigger a manual sync, verify Contacts populate and segments work.
- [ ] Run the production deploy procedure documented in CLAUDE.md → DEPLOYMENT_GUIDE.md once verified.

## Out of scope (Phase 1b and beyond)

- `Audience` table + Audiences page UI.
- `surveyDerived` audience type.
- Demographics snapshot on `SurveyInvitation`.
- Survey audience picker rewrite.
- Audience memberships section on Contact detail page.
- Reverse-ETL of responses to Snowflake.
- Manual-to-snowflake contact promotion.
- Audience overlap detection.
- Multiple syncs per environment.
- Scheduled audience refreshes.
- Audience-level ACLs.

These are tracked in the spec and become subsequent plans.
