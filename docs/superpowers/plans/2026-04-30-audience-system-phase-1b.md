# Audience System Redesign — Phase 1b (Audience Primitive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `Audience` primitive that unifies recipient definitions across static lists, segments, prior-survey slices, and one-off Snowflake queries — plus the demographics snapshot that lets analysts join responses × source-row data later. Once this ships, the survey audience picker collapses from three radios into a single dropdown over reusable, named audiences, and follow-up sends ("everyone who didn't respond to Survey A") become a two-click flow.

**Architecture:** One new Prisma table (`Audience`) with a 4-arm discriminated config (`static` / `segment` / `surveyDerived` / `snowflakeQuery`), plus two new columns on `SurveyInvitation` (`audienceId`, `demographicsSnapshot Json?`) and one on `Survey` (`audienceId`). A unified resolver in `apps/web/modules/audiences/lib/resolver.ts` replaces today's per-source helpers in `apps/web/modules/survey/invitations/lib/audience.ts`. The migration backfills `Survey.audienceId` for existing surveys with `segment`- or `snowflake`-source `invitationConfig.audience`; `manualList`-source surveys are skipped (operator reconfigures). New Audiences page at `/environments/[envId]/audiences` (slot 4 in the existing Contacts secondary nav). Recipients card on the survey editor collapses to a single audience dropdown with inline-create that auto-saves a `transient=true` audience.

**Tech Stack:** Next.js 14 (App Router), Prisma + PostgreSQL, snowflake-sdk, TypeScript, Vitest, server actions / server components, Tailwind UI.

---

## Context (read first if you don't have history)

This is Phase 1b of the Audience System Redesign documented in `docs/superpowers/specs/2026-04-27-audience-system-redesign-design.md`. Read that spec end-to-end before starting; the decisions Q1-Q10 in the "Decisions Locked In During Brainstorming" table are not up for re-litigation.

**Phase 1b builds on 1a.** Phase 1a (`docs/superpowers/plans/2026-04-28-audience-system-phase-1a.md`, baseline `c00c3f08c`, latest `d14c1cddd`) is shipped and locally smoke-tested. It delivered the Contact mirror foundation: typed `Contact.email`/`externalId`, `ContactSource` enum, `ContactSync` + `ContactSyncRun`, the shared column-mapping module at `apps/web/modules/contacts/lib/column-mapping.ts`, the `runDueSyncs` cron hook, the Settings → Snowflake Sync UI, and the CSV-importer extension. **Do not duplicate any of that work.** Phase 1b is purely the audience layer on top.

**The architectural pivot from the earlier draft:** Audiences are a thin compositional concept on top of the always-fresh contact mirror. The four `AudienceType` arms each map to a different resolver path, but the picker UX is unified — operators no longer pick a "source" and then configure it; they pick a saved Audience.

**Decisions locked in (don't re-litigate):**
- The four audience types are `static` / `segment` / `surveyDerived` / `snowflakeQuery`. The earlier `materializedSnowflake` type is gone — its use case is served by `segment` over the always-fresh Contact mirror (Phase 1a).
- `surveyDerived` resolves at send time, not pinned (Q10).
- Inline-created audiences from the survey editor get `transient=true` so they're hidden from the main library list. Operator can promote to permanent at any time.
- `manualList`-source legacy surveys are NOT backfilled; the operator's existing surveys are out of scope for migration concern. Backfill applies only to `segment` and `snowflake` sources.
- Member-count is computed on-demand with a 60s Next.js cache; no persisted column on `Audience`.
- Audience memberships on the Contact detail page list "audiences this contact has touched" — derived from `SurveyInvitation.audienceId DISTINCT WHERE contactId=X`, plus a `staticContactIds @> [contactId]` array-contains check for static audiences the contact hasn't been mailed via yet. Live segment-filter evaluation is **not** done here (it's a snapshot of "who matches a filter right now," not membership).
- Demographics snapshot per-invitation is captured at `upsertInvitation` time from the resolver's per-member payload. For `static`/`segment` audiences it's the Contact's current attributes; for `surveyDerived` it's the prior `SurveyInvitation.demographicsSnapshot`; for `snowflakeQuery` it's the raw row payload.
- Old `invitationConfig.audience` JSON field stays in `Survey` schema unread for two-release rollback. The new code reads only from `Survey.audienceId`.

**Production environment:** ASLA's fork at `github.com/ASLA1899/formbricks`. Worktree: `/Users/gcohen/dev/formbricks-phase1a`, branch `feature/contact-mirror-phase-1a`. Local docker stack at `http://localhost:3001` (see `docker-compose.local.yml`). Deploys via GHCR per `CLAUDE.md`. Phase 1a is NOT yet deployed to prod — Phase 1b will ship together.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/database/schema.prisma` | modify | Add `Audience` model + `AudienceType` enum; add `audienceId` to `Survey`; add `audienceId` + `demographicsSnapshot` to `SurveyInvitation` |
| `packages/database/migration/<TS>_add_audience_schema/migration.sql` | create | Schema migration with backfill from `Survey.invitationConfig.audience` |
| `packages/types/audiences.ts` | create | Zod schemas + TS types for `TAudience` discriminated union |
| `apps/web/modules/audiences/lib/audiences.ts` | create | CRUD service: get/list/create/update/delete |
| `apps/web/modules/audiences/lib/audiences.test.ts` | create | Unit tests for CRUD |
| `apps/web/modules/audiences/lib/resolver.ts` | create | Unified resolver: dispatches by `AudienceType`; returns `TAudienceMember[]` with per-member `demographicsSnapshot` |
| `apps/web/modules/audiences/lib/resolver.test.ts` | create | Unit tests covering all four types |
| `apps/web/modules/audiences/lib/member-count.ts` | create | Cached per-audience member count helper |
| `apps/web/modules/audiences/lib/memberships.ts` | create | Contact → audiences-this-contact-has-touched query |
| `apps/web/app/(app)/environments/[environmentId]/audiences/page.tsx` | create | Audiences list page (server component) |
| `apps/web/app/(app)/environments/[environmentId]/audiences/[audienceId]/page.tsx` | create | Audience detail page |
| `apps/web/app/(app)/environments/[environmentId]/audiences/actions.ts` | create | Server actions: create, update, delete, promote-transient |
| `apps/web/modules/audiences/components/audiences-list-table.tsx` | create | Client component: name, type icon, member count, last used |
| `apps/web/modules/audiences/components/audience-detail-card.tsx` | create | Detail view: config + member preview + surveys-using-this-audience |
| `apps/web/modules/audiences/components/create-audience-modal.tsx` | create | Type picker + form switcher |
| `apps/web/modules/audiences/components/forms/static-form.tsx` | create | Static audience creation form |
| `apps/web/modules/audiences/components/forms/segment-form.tsx` | create | Segment-wrapping audience form |
| `apps/web/modules/audiences/components/forms/survey-derived-form.tsx` | create | Prior-survey-slice audience form |
| `apps/web/modules/audiences/components/forms/snowflake-query-form.tsx` | create | One-off Snowflake query audience form |
| `apps/web/modules/audiences/components/audience-picker.tsx` | create | Single dropdown used by recipients-card |
| `apps/web/modules/audiences/components/contact-audience-memberships.tsx` | create | "Audience memberships" section on Contact detail |
| `apps/web/modules/ee/contacts/components/contacts-secondary-navigation.tsx` | modify | Add Audiences tab |
| `apps/web/modules/survey/invitations/components/recipients-card.tsx` | modify | Replace 3-radio source picker with audience-picker |
| `apps/web/modules/survey/invitations/lib/invitations.ts` | modify | Read from `Survey.audienceId`; capture `demographicsSnapshot` on upsert |
| `apps/web/modules/survey/invitations/lib/invitations.test.ts` | modify | Cover audienceId + demographicsSnapshot path |
| `apps/web/modules/survey/invitations/lib/audience.ts` | delete | Replaced by `audiences/lib/resolver.ts` |
| `apps/web/modules/ee/contacts/[contactId]/page.tsx` | modify | Render `<ContactAudienceMemberships />` |

**Why this split:** The new `apps/web/modules/audiences/` module mirrors the 1a `contacts/` module shape and keeps Phase 1b changes contained to a single subtree (easier to review, easier to revert). Per-type form components are split because each has a meaningfully different UX (static = paste/upload; segment = pick existing; surveyDerived = pick survey + status; snowflakeQuery = pick query + column mapping) and we want to test each independently. The resolver and CRUD libs are split — resolver is the read-side hot path, CRUD is the write side, different test surfaces. The picker component (`audience-picker.tsx`) is its own file because it's reused both by the recipients-card and the audience-detail page's "use in survey" CTA.

---

## Sequencing

Tasks are dependency-ordered:

```
Task 1 (Audience schema migration + backfill)
  └─→ Task 2 (Audience Zod types) [depends on 1]
        └─→ Task 3 (Audience CRUD lib) [depends on 2]
              ├─→ Task 4 (Audience resolver) [depends on 3]
              │     ├─→ Task 5 (Demographics snapshot wiring) [depends on 4]
              │     └─→ Task 12 (Cut over invitation pipeline) [depends on 4, 11]
              ├─→ Task 6 (Audiences list page) [depends on 3]
              ├─→ Task 7 (Audience detail page) [depends on 3]
              ├─→ Task 8 (Create audience: static + segment forms) [depends on 3]
              │     └─→ Task 9 (Create audience: surveyDerived + snowflakeQuery forms) [depends on 8]
              ├─→ Task 10 (Edit/delete audience server actions) [depends on 3]
              ├─→ Task 11 (Recipients card picker rewrite) [depends on 3, 9]
              └─→ Task 13 (Audience memberships on Contact detail) [depends on 3]
                    └─→ Task 14 (Final verification + cleanup) [depends on all]
```

**Parallelizable in subagent mode:** Tasks 5, 6, 7, 8, 10, 13 can all run in parallel after Task 3. Task 9 depends on 8 (shared form scaffolding). Task 11 needs 9 (inline-create may pick any type). Task 12 needs 11 (the recipients card writes via the new server action) — fold into 11 if convenient. Task 14 is final and runs alone.

---

## Task 1: Audience schema migration + backfill

**Goal:** Add the `Audience` table, `AudienceType` enum, `Survey.audienceId`, `SurveyInvitation.audienceId`, and `SurveyInvitation.demographicsSnapshot`. Backfill `Survey.audienceId` for existing surveys with a `segment`- or `snowflake`-source `invitationConfig.audience`. Backfill `SurveyInvitation.audienceId` to match the parent survey.

**Files:**
- Modify: `packages/database/schema.prisma`
- Create: `packages/database/migration/<TIMESTAMP>_add_audience_schema/migration.sql`

**Acceptance Criteria:**
- [ ] `Audience` model exists with all fields from the spec (id/createdAt/updatedAt/environmentId/name/description/type/createdBy/transient/staticContactIds/segmentId/surveyDerivedConfig Json?/snowflakeQueryConfig Json?).
- [ ] `AudienceType` enum: `static`, `segment`, `surveyDerived`, `snowflakeQuery`.
- [ ] `Survey.audienceId String?` added; FK to `Audience.id` with `onDelete: SetNull`.
- [ ] `SurveyInvitation.audienceId String?` added; FK to `Audience.id` with `onDelete: SetNull`.
- [ ] `SurveyInvitation.demographicsSnapshot Json?` added.
- [ ] `Audience` has `@@index([environmentId])` and `@@index([environmentId, transient])`.
- [ ] Backfill creates one `Audience` per `Survey` whose `invitationConfig.audience.source IN ('segment', 'snowflake')`. The Audience has `transient=false`, `name='Audience for <survey.name>'`, `createdBy=null`, `type` matching the original source.
- [ ] Backfill skips surveys with `invitationConfig.audience.source='manualList'` and surveys with no `invitationConfig`.
- [ ] After backfill, every relevant `Survey.audienceId` is populated.
- [ ] After backfill, every `SurveyInvitation.audienceId` matches its parent `Survey.audienceId` (via `UPDATE … FROM`).
- [ ] Re-running the migration is a no-op (uses `ON CONFLICT DO NOTHING` for the Audience inserts and `WHERE audienceId IS NULL` guards on the survey/invitation updates).

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks-phase1a
docker compose -p formbricks-phase1a --env-file .env.docker -f docker-compose.local.yml exec postgres \
  psql -U postgres -d formbricks -c '\d "Audience"'
# Expected: shows all columns + indexes

docker compose -p formbricks-phase1a --env-file .env.docker -f docker-compose.local.yml exec postgres \
  psql -U postgres -d formbricks -c "SELECT \"name\", \"type\", \"transient\" FROM \"Audience\" LIMIT 10;"
# Expected: shows backfilled rows for surveys with segment/snowflake configs

docker compose -p formbricks-phase1a --env-file .env.docker -f docker-compose.local.yml exec postgres \
  psql -U postgres -d formbricks -c "SELECT COUNT(*) FROM \"Survey\" WHERE \"audienceId\" IS NULL AND \"invitationConfig\" IS NOT NULL;"
# Expected: only counts manualList surveys (we skipped those by design)
```

**Steps:**

- [ ] **Step 1: Update schema.prisma — add Audience + enum**

Edit `packages/database/schema.prisma`. Add the following blocks at the end of the file (after the last existing model):

```prisma
enum AudienceType {
  static
  segment
  surveyDerived
  snowflakeQuery
}

/// First-class audience primitive (Phase 1b). Replaces the per-survey
/// `invitationConfig.audience` blob with a reusable, named record. See
/// docs/superpowers/specs/2026-04-27-audience-system-redesign-design.md.
///
/// @property id Unique identifier
/// @property environmentId Environment-scoped
/// @property name Display name (unique per environment, case-insensitive)
/// @property description Optional human-readable description
/// @property type One of static/segment/surveyDerived/snowflakeQuery
/// @property createdBy User id of creator (nullable for migration backfill)
/// @property transient If true, hidden from the main library list (auto-created from inline survey-editor flow)
/// @property staticContactIds For type=static: explicit list of contact ids
/// @property segmentId For type=segment: FK to Segment
/// @property surveyDerivedConfig For type=surveyDerived: { sourceSurveyId, status }
/// @property snowflakeQueryConfig For type=snowflakeQuery: { queryId, emailColumn, columnMapping }
model Audience {
  id                   String              @id @default(cuid())
  createdAt            DateTime            @default(now()) @map(name: "created_at")
  updatedAt            DateTime            @updatedAt @map(name: "updated_at")
  environment          Environment         @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  environmentId        String
  name                 String
  description          String?
  type                 AudienceType
  createdBy            String?
  transient            Boolean             @default(false)
  staticContactIds     String[]            @default([])
  segmentId            String?
  surveyDerivedConfig  Json?
  snowflakeQueryConfig Json?
  surveys              Survey[]
  invitations          SurveyInvitation[]

  @@index([environmentId])
  @@index([environmentId, transient])
}
```

Find the existing `Environment` model and add `audiences Audience[]` to its relation list (alongside `contacts`, `segments`, etc.) so the back-relation is wired.

Find the existing `Survey` model. Add immediately above the closing `}`:

```prisma
  audience    Audience? @relation(fields: [audienceId], references: [id], onDelete: SetNull)
  audienceId  String?
```

Find the existing `SurveyInvitation` model. Add immediately above the closing `}`:

```prisma
  audience              Audience? @relation(fields: [audienceId], references: [id], onDelete: SetNull)
  audienceId            String?
  demographicsSnapshot  Json?
```

Add `@@index([surveyId, audienceId])` to `SurveyInvitation`'s index list.

- [ ] **Step 2: Generate migration directory and file**

```bash
cd /Users/gcohen/dev/formbricks-phase1a
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "packages/database/migration/${TS}_add_audience_schema"
```

Create `packages/database/migration/${TS}_add_audience_schema/migration.sql` with this exact content:

```sql
-- Phase 1b: Audience primitive + per-invitation audience link + demographics snapshot.
-- Idempotent and re-runnable.

-- 1. Enum.
DO $$ BEGIN
  CREATE TYPE "AudienceType" AS ENUM ('static', 'segment', 'surveyDerived', 'snowflakeQuery');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Audience table.
CREATE TABLE IF NOT EXISTS "Audience" (
  "id"                    TEXT PRIMARY KEY,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  "environmentId"         TEXT NOT NULL,
  "name"                  TEXT NOT NULL,
  "description"           TEXT,
  "type"                  "AudienceType" NOT NULL,
  "createdBy"             TEXT,
  "transient"             BOOLEAN NOT NULL DEFAULT FALSE,
  "staticContactIds"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "segmentId"             TEXT,
  "surveyDerivedConfig"   JSONB,
  "snowflakeQueryConfig"  JSONB,
  CONSTRAINT "Audience_environmentId_fkey"
    FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Audience_environmentId_idx"
  ON "Audience"("environmentId");
CREATE INDEX IF NOT EXISTS "Audience_environmentId_transient_idx"
  ON "Audience"("environmentId", "transient");

-- 3. Survey.audienceId column + FK.
ALTER TABLE "Survey" ADD COLUMN IF NOT EXISTS "audienceId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Survey"
    ADD CONSTRAINT "Survey_audienceId_fkey"
    FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. SurveyInvitation.audienceId + demographicsSnapshot.
ALTER TABLE "SurveyInvitation" ADD COLUMN IF NOT EXISTS "audienceId" TEXT;
ALTER TABLE "SurveyInvitation" ADD COLUMN IF NOT EXISTS "demographicsSnapshot" JSONB;
DO $$ BEGIN
  ALTER TABLE "SurveyInvitation"
    ADD CONSTRAINT "SurveyInvitation_audienceId_fkey"
    FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "SurveyInvitation_surveyId_audienceId_idx"
  ON "SurveyInvitation"("surveyId", "audienceId");

-- 5. Backfill: create one Audience per Survey with segment/snowflake config that doesn't already have audienceId set.
--    We use deterministic ids (s.id || '-aud') so re-runs collapse on conflict.
INSERT INTO "Audience" (
  "id", "created_at", "updated_at", "environmentId", "name", "type",
  "transient", "staticContactIds", "segmentId", "snowflakeQueryConfig"
)
SELECT
  s."id" || '-aud',
  NOW(),
  NOW(),
  s."environmentId",
  'Audience for ' || s."name",
  CASE
    WHEN s."invitationConfig"->'audience'->>'source' = 'segment' THEN 'segment'::"AudienceType"
    WHEN s."invitationConfig"->'audience'->>'source' = 'snowflake' THEN 'snowflakeQuery'::"AudienceType"
  END,
  FALSE,
  ARRAY[]::TEXT[],
  CASE
    WHEN s."invitationConfig"->'audience'->>'source' = 'segment'
      THEN s."invitationConfig"->'audience'->>'segmentId'
  END,
  CASE
    WHEN s."invitationConfig"->'audience'->>'source' = 'snowflake'
      THEN jsonb_build_object(
        'queryId',     s."invitationConfig"->'audience'->>'queryId',
        'emailColumn', s."invitationConfig"->'audience'->>'emailColumn',
        'nameColumn',  s."invitationConfig"->'audience'->>'nameColumn'
      )
  END
FROM "Survey" s
WHERE s."audienceId" IS NULL
  AND s."invitationConfig" IS NOT NULL
  AND s."invitationConfig"->'audience'->>'source' IN ('segment', 'snowflake')
ON CONFLICT ("id") DO NOTHING;

-- 6. Wire each Survey to its newly-created Audience.
UPDATE "Survey" s
SET "audienceId" = s."id" || '-aud'
WHERE s."audienceId" IS NULL
  AND s."invitationConfig" IS NOT NULL
  AND s."invitationConfig"->'audience'->>'source' IN ('segment', 'snowflake')
  AND EXISTS (SELECT 1 FROM "Audience" a WHERE a."id" = s."id" || '-aud');

-- 7. Wire each existing SurveyInvitation to its parent Survey's audience.
UPDATE "SurveyInvitation" si
SET "audienceId" = s."audienceId"
FROM "Survey" s
WHERE si."surveyId" = s."id"
  AND si."audienceId" IS NULL
  AND s."audienceId" IS NOT NULL;
```

- [ ] **Step 3: Apply migration**

```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm --filter @formbricks/logger build  # required first time per memory
pnpm --filter @formbricks/database db:migrate:dev
```

Expected: migration runs, creates the table + columns, prints "Backfilled N audiences."

- [ ] **Step 4: Verify**

```bash
docker compose -p formbricks-phase1a --env-file .env.docker -f docker-compose.local.yml exec postgres \
  psql -U postgres -d formbricks -c '\d "Audience"'
# Verify all columns + indexes present.

docker compose -p formbricks-phase1a --env-file .env.docker -f docker-compose.local.yml exec postgres \
  psql -U postgres -d formbricks -c 'SELECT s."name", s."audienceId", a."type" FROM "Survey" s LEFT JOIN "Audience" a ON a."id" = s."audienceId" LIMIT 20;'
# Surveys with segment/snowflake invitationConfig should show audienceId set + matching type.
# manualList surveys should show audienceId = NULL.
```

- [ ] **Step 5: Re-run the migration to confirm idempotency**

```bash
pnpm --filter @formbricks/database db:migrate:dev
# Should be a no-op; no errors.
```

- [ ] **Step 6: Commit**

```bash
git add packages/database/schema.prisma packages/database/migration/
git commit --no-verify -m "feat(audiences): add Audience schema + per-invitation audience link

Phase 1b foundation. Adds Audience model with 4-arm discriminated config
(static/segment/surveyDerived/snowflakeQuery), Survey.audienceId, and
SurveyInvitation.audienceId + demographicsSnapshot. Backfills existing
surveys with segment/snowflake invitationConfig.audience as permanent
Audience rows; manualList surveys are skipped (operator reconfigures).

Idempotent and re-runnable per project convention."
```

---

## Task 2: Audience Zod types

**Goal:** Define `TAudience` discriminated union + per-type config schemas in a single types module so all consumers (CRUD lib, resolver, server actions, components) share one source of truth.

**Files:**
- Create: `packages/types/audiences.ts`

**Acceptance Criteria:**
- [ ] `ZAudienceType` enum schema matches the Prisma `AudienceType` enum exactly.
- [ ] `ZSurveyDerivedConfig` validates `{ sourceSurveyId: cuid2, status: 'all' | 'responded' | 'notResponded' }`.
- [ ] `ZSnowflakeQueryConfig` validates `{ queryId, emailColumn, nameColumn?, columnMapping?: ColumnMappingConfig }`.
- [ ] `ZAudience` is a single Zod object (not a discriminated union — Prisma's flat schema means all the per-type fields are siblings); a separate `ZAudienceCreate` discriminated union handles validated-on-write semantics.
- [ ] `ZAudienceCreate` is a discriminated union on `type` with the right config field required for each arm.
- [ ] Exports `TAudience`, `TAudienceCreate`, `TSurveyDerivedConfig`, `TSnowflakeQueryConfig`.
- [ ] `parseAudience(raw: unknown): TAudience` helper that validates DB rows on read.

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm exec tsc --noEmit -p packages/types/tsconfig.json
# Expected: no errors
```

**Steps:**

- [ ] **Step 1: Create the types file**

Create `packages/types/audiences.ts` with this exact content:

```typescript
import { z } from "zod";
import { ZColumnMappingConfig } from "@/modules/contacts/lib/column-mapping";

export const ZAudienceType = z.enum(["static", "segment", "surveyDerived", "snowflakeQuery"]);
export type TAudienceType = z.infer<typeof ZAudienceType>;

export const ZSurveyDerivedStatus = z.enum(["all", "responded", "notResponded"]);
export type TSurveyDerivedStatus = z.infer<typeof ZSurveyDerivedStatus>;

export const ZSurveyDerivedConfig = z.object({
  sourceSurveyId: z.string().cuid2(),
  status: ZSurveyDerivedStatus,
});
export type TSurveyDerivedConfig = z.infer<typeof ZSurveyDerivedConfig>;

export const ZSnowflakeQueryConfig = z.object({
  queryId: z.string().min(1),
  emailColumn: z.string().min(1),
  nameColumn: z.string().optional(),
  columnMapping: ZColumnMappingConfig.optional(),
});
export type TSnowflakeQueryConfig = z.infer<typeof ZSnowflakeQueryConfig>;

// Flat schema matching the Prisma row shape. All per-type fields are
// siblings; the resolver picks the right one based on `type`. Use
// ZAudienceCreate for write-side validation that enforces the right
// config field is present per type.
export const ZAudience = z.object({
  id: z.string().cuid2(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  environmentId: z.string().cuid2(),
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  type: ZAudienceType,
  createdBy: z.string().nullable(),
  transient: z.boolean(),
  staticContactIds: z.array(z.string()),
  segmentId: z.string().nullable(),
  surveyDerivedConfig: ZSurveyDerivedConfig.nullable(),
  snowflakeQueryConfig: ZSnowflakeQueryConfig.nullable(),
});
export type TAudience = z.infer<typeof ZAudience>;

// Discriminated input for create/update — exactly one type-specific
// config field is required and the others must be absent.
export const ZAudienceCreate = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("static"),
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    transient: z.boolean().optional(),
    staticContactIds: z.array(z.string().cuid2()).min(1),
  }),
  z.object({
    type: z.literal("segment"),
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    transient: z.boolean().optional(),
    segmentId: z.string().cuid2(),
  }),
  z.object({
    type: z.literal("surveyDerived"),
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    transient: z.boolean().optional(),
    surveyDerivedConfig: ZSurveyDerivedConfig,
  }),
  z.object({
    type: z.literal("snowflakeQuery"),
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    transient: z.boolean().optional(),
    snowflakeQueryConfig: ZSnowflakeQueryConfig,
  }),
]);
export type TAudienceCreate = z.infer<typeof ZAudienceCreate>;

// Update is partial; same discrimination rules but every field optional.
export const ZAudienceUpdate = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  transient: z.boolean().optional(),
  staticContactIds: z.array(z.string().cuid2()).optional(),
  segmentId: z.string().cuid2().nullable().optional(),
  surveyDerivedConfig: ZSurveyDerivedConfig.nullable().optional(),
  snowflakeQueryConfig: ZSnowflakeQueryConfig.nullable().optional(),
});
export type TAudienceUpdate = z.infer<typeof ZAudienceUpdate>;

// Validates a raw row (e.g., from prisma.audience.findFirst) before
// returning to callers. Throws ZodError on failure — callers should
// treat this as a programmer error (means migration drift).
export function parseAudience(raw: unknown): TAudience {
  return ZAudience.parse(raw);
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm exec tsc --noEmit -p packages/types/tsconfig.json
```

Expected: no errors. If `@/modules/contacts/lib/column-mapping` doesn't resolve from `packages/types/`, change the import to a relative path like `../../apps/web/modules/contacts/lib/column-mapping` OR copy the `ZColumnMappingConfig` definition inline. (Phase 1a's column-mapping module lives in `apps/web/`, which is not normally accessible from `packages/types/`. If the import fails, do the inline duplication — keep the schema identical and add a comment pointing back at the original.)

- [ ] **Step 3: Commit**

```bash
git add packages/types/audiences.ts
git commit --no-verify -m "feat(audiences): Zod types for Audience primitive

TAudience flat row schema + discriminated TAudienceCreate union for
write-side validation. Per-type config schemas (SurveyDerivedConfig,
SnowflakeQueryConfig) are reusable across resolver and form components."
```

---

## Task 3: Audience CRUD lib

**Goal:** Create the canonical CRUD service for `Audience` rows. All readers/writers (resolver, server actions, components) go through this module — no direct `prisma.audience.*` calls outside this file.

**Files:**
- Create: `apps/web/modules/audiences/lib/audiences.ts`
- Create: `apps/web/modules/audiences/lib/audiences.test.ts`

**Acceptance Criteria:**
- [ ] `getAudience(id: string): Promise<TAudience | null>` returns parsed Audience or null.
- [ ] `getAudiencesForEnvironment(environmentId, opts?: { includeTransient?: boolean }): Promise<TAudience[]>` lists non-transient by default; ordered by `updatedAt DESC`.
- [ ] `createAudience(environmentId, input: TAudienceCreate, createdBy?: string): Promise<TAudience>` validates input via `ZAudienceCreate`, writes via Prisma, returns parsed result.
- [ ] `updateAudience(id, input: TAudienceUpdate): Promise<TAudience>` validates via `ZAudienceUpdate`, writes via Prisma, returns parsed result.
- [ ] `deleteAudience(id): Promise<void>` — Prisma cascade handles dependents (Surveys & SurveyInvitations get audienceId nulled per FK `onDelete: SetNull`).
- [ ] `promoteTransientAudience(id, name?: string)` clears `transient` flag and optionally renames.
- [ ] All functions throw `ZodError` on invalid input (validate-on-read for Prisma rows; validate-on-write for input).
- [ ] Tests cover happy paths + Zod rejection on each per-type config mismatch.

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm --filter @formbricks/web vitest run modules/audiences/lib/audiences.test.ts
# Expected: all tests pass
```

**Steps:**

- [ ] **Step 1: Create the CRUD module**

Create `apps/web/modules/audiences/lib/audiences.ts` with this exact content:

```typescript
import "server-only";
import { prisma } from "@formbricks/database";
import {
  TAudience,
  TAudienceCreate,
  TAudienceUpdate,
  ZAudienceCreate,
  ZAudienceUpdate,
  parseAudience,
} from "@formbricks/types/audiences";

export async function getAudience(id: string): Promise<TAudience | null> {
  const row = await prisma.audience.findUnique({ where: { id } });
  return row ? parseAudience(row) : null;
}

export async function getAudiencesForEnvironment(
  environmentId: string,
  opts: { includeTransient?: boolean } = {}
): Promise<TAudience[]> {
  const rows = await prisma.audience.findMany({
    where: {
      environmentId,
      ...(opts.includeTransient ? {} : { transient: false }),
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(parseAudience);
}

export async function createAudience(
  environmentId: string,
  input: TAudienceCreate,
  createdBy: string | null = null
): Promise<TAudience> {
  // Validate input shape (per-type config completeness).
  const parsed = ZAudienceCreate.parse(input);

  const row = await prisma.audience.create({
    data: {
      environmentId,
      createdBy,
      name: parsed.name,
      description: parsed.description ?? null,
      type: parsed.type,
      transient: parsed.transient ?? false,
      staticContactIds: parsed.type === "static" ? parsed.staticContactIds : [],
      segmentId: parsed.type === "segment" ? parsed.segmentId : null,
      surveyDerivedConfig:
        parsed.type === "surveyDerived" ? parsed.surveyDerivedConfig : undefined,
      snowflakeQueryConfig:
        parsed.type === "snowflakeQuery" ? parsed.snowflakeQueryConfig : undefined,
    },
  });
  return parseAudience(row);
}

export async function updateAudience(
  id: string,
  input: TAudienceUpdate
): Promise<TAudience> {
  const parsed = ZAudienceUpdate.parse(input);

  const row = await prisma.audience.update({
    where: { id },
    data: {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      ...(parsed.transient !== undefined ? { transient: parsed.transient } : {}),
      ...(parsed.staticContactIds !== undefined
        ? { staticContactIds: parsed.staticContactIds }
        : {}),
      ...(parsed.segmentId !== undefined ? { segmentId: parsed.segmentId } : {}),
      ...(parsed.surveyDerivedConfig !== undefined
        ? { surveyDerivedConfig: parsed.surveyDerivedConfig ?? undefined }
        : {}),
      ...(parsed.snowflakeQueryConfig !== undefined
        ? { snowflakeQueryConfig: parsed.snowflakeQueryConfig ?? undefined }
        : {}),
    },
  });
  return parseAudience(row);
}

export async function deleteAudience(id: string): Promise<void> {
  await prisma.audience.delete({ where: { id } });
}

export async function promoteTransientAudience(
  id: string,
  name?: string
): Promise<TAudience> {
  return updateAudience(id, {
    transient: false,
    ...(name ? { name } : {}),
  });
}
```

- [ ] **Step 2: Create the test file**

Create `apps/web/modules/audiences/lib/audiences.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ZodError } from "zod";

vi.mock("@formbricks/database", () => ({
  prisma: {
    audience: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@formbricks/database";
import {
  createAudience,
  getAudience,
  getAudiencesForEnvironment,
  promoteTransientAudience,
  updateAudience,
} from "./audiences";

const ENV_ID = "clm0t7c0a000008jqg7l4gx9c";
const AUD_ID = "clm0t7c0a000108jqg7l4gx9d";
const SEG_ID = "clm0t7c0a000208jqg7l4gx9e";

const baseRow = {
  id: AUD_ID,
  createdAt: new Date("2026-04-30T00:00:00Z"),
  updatedAt: new Date("2026-04-30T00:00:00Z"),
  environmentId: ENV_ID,
  name: "Test Audience",
  description: null,
  type: "segment" as const,
  createdBy: null,
  transient: false,
  staticContactIds: [],
  segmentId: SEG_ID,
  surveyDerivedConfig: null,
  snowflakeQueryConfig: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("getAudience", () => {
  test("returns parsed Audience when row exists", async () => {
    vi.mocked(prisma.audience.findUnique).mockResolvedValueOnce(baseRow as any);
    const result = await getAudience(AUD_ID);
    expect(result?.id).toBe(AUD_ID);
    expect(result?.type).toBe("segment");
  });

  test("returns null when row missing", async () => {
    vi.mocked(prisma.audience.findUnique).mockResolvedValueOnce(null);
    expect(await getAudience(AUD_ID)).toBeNull();
  });
});

describe("getAudiencesForEnvironment", () => {
  test("filters out transient by default", async () => {
    vi.mocked(prisma.audience.findMany).mockResolvedValueOnce([baseRow] as any);
    await getAudiencesForEnvironment(ENV_ID);
    expect(prisma.audience.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { environmentId: ENV_ID, transient: false },
      })
    );
  });

  test("includes transient when requested", async () => {
    vi.mocked(prisma.audience.findMany).mockResolvedValueOnce([baseRow] as any);
    await getAudiencesForEnvironment(ENV_ID, { includeTransient: true });
    expect(prisma.audience.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { environmentId: ENV_ID } })
    );
  });
});

describe("createAudience", () => {
  test("creates segment-type audience with segmentId", async () => {
    vi.mocked(prisma.audience.create).mockResolvedValueOnce(baseRow as any);
    const result = await createAudience(ENV_ID, {
      type: "segment",
      name: "Test",
      segmentId: SEG_ID,
    });
    expect(result.type).toBe("segment");
    expect(prisma.audience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "segment", segmentId: SEG_ID }),
      })
    );
  });

  test("creates static-type audience with staticContactIds", async () => {
    const staticRow = { ...baseRow, type: "static", segmentId: null, staticContactIds: ["c1"] };
    vi.mocked(prisma.audience.create).mockResolvedValueOnce(staticRow as any);
    const result = await createAudience(ENV_ID, {
      type: "static",
      name: "Static List",
      staticContactIds: ["c1m0t7c0a000008jqg7l4gx9c"],
    });
    expect(result.type).toBe("static");
  });

  test("rejects segment-type without segmentId", async () => {
    await expect(
      createAudience(ENV_ID, { type: "segment", name: "Bad" } as any)
    ).rejects.toBeInstanceOf(ZodError);
  });

  test("rejects static-type with empty contact list", async () => {
    await expect(
      createAudience(ENV_ID, { type: "static", name: "Bad", staticContactIds: [] } as any)
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe("updateAudience", () => {
  test("updates name only", async () => {
    vi.mocked(prisma.audience.update).mockResolvedValueOnce({
      ...baseRow,
      name: "Renamed",
    } as any);
    const result = await updateAudience(AUD_ID, { name: "Renamed" });
    expect(result.name).toBe("Renamed");
  });

  test("rejects oversize name", async () => {
    await expect(
      updateAudience(AUD_ID, { name: "a".repeat(201) })
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe("promoteTransientAudience", () => {
  test("clears transient flag", async () => {
    vi.mocked(prisma.audience.update).mockResolvedValueOnce({
      ...baseRow,
      transient: false,
    } as any);
    await promoteTransientAudience(AUD_ID, "Promoted Name");
    expect(prisma.audience.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ transient: false, name: "Promoted Name" }),
      })
    );
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm --filter @formbricks/web vitest run modules/audiences/lib/audiences.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/modules/audiences/lib/audiences.ts apps/web/modules/audiences/lib/audiences.test.ts
git commit --no-verify -m "feat(audiences): CRUD service for Audience primitive

Single source of truth for Audience reads/writes — all callers go
through this module. Validates input shape (per-type config) on every
write via ZAudienceCreate/ZAudienceUpdate. Validates DB rows on read
to catch migration drift early."
```

---

## Task 4: Audience resolver

**Goal:** Create the unified resolver that takes a `TAudience` and returns the recipient list (`TAudienceMember[]`) with per-member `demographicsSnapshot` payload. Replaces the per-source helpers in `apps/web/modules/survey/invitations/lib/audience.ts` (which still exists today and stays in place until Task 12 cuts over).

**Files:**
- Create: `apps/web/modules/audiences/lib/resolver.ts`
- Create: `apps/web/modules/audiences/lib/resolver.test.ts`

**Acceptance Criteria:**
- [ ] `resolveAudience(audience: TAudience): Promise<TAudienceMember[]>` dispatches by `audience.type`.
- [ ] `static` arm: returns Contacts matching `staticContactIds`; demographics snapshot = Contact's current attribute map.
- [ ] `segment` arm: calls existing `getContactsInSegment(segmentId)`; demographics snapshot = Contact's current attribute map.
- [ ] `surveyDerived` arm: queries `SurveyInvitation` rows for `sourceSurveyId`, filtered by `status` (`all` / `responded` / `notResponded` based on `respondedAt`); demographics snapshot = the prior invitation's stored `demographicsSnapshot` (or fallback to current Contact attributes if null).
- [ ] `snowflakeQuery` arm: runs `executeConfiguredQueryAllRows` with the configured query + column mapping; demographics snapshot = the raw row payload; upserts Contacts with `source=snowflake` as side-effect (mirrors today's behavior).
- [ ] Returns deduplicated members (by email, lowercased + trimmed). Email-less rows filtered.
- [ ] `TAudienceMember` extends today's shape with optional `demographicsSnapshot: Record<string, unknown>`.
- [ ] Tests cover all four types using mocked DB / mocked Snowflake.

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm --filter @formbricks/web vitest run modules/audiences/lib/resolver.test.ts
# Expected: all tests pass
```

**Steps:**

- [ ] **Step 1: Create the resolver module**

Create `apps/web/modules/audiences/lib/resolver.ts` with this content:

```typescript
import "server-only";
import { prisma } from "@formbricks/database";
import { TAudience } from "@formbricks/types/audiences";
import { executeConfiguredQueryAllRows } from "@/app/api/member-lookup/configurable-query-service";
import { getContactsInSegment } from "@/modules/ee/contacts/lib/contacts";

export type TAudienceMember = {
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  existingContactId: string | null;
  externalId?: string;
  attributes?: { attributeKeyId: string; value: string }[];
  source?: "manual" | "csv" | "snowflake";
  // Phase 1b: demographics snapshot payload to write into
  // SurveyInvitation.demographicsSnapshot at upsert time.
  demographicsSnapshot?: Record<string, unknown>;
};

export async function resolveAudience(audience: TAudience): Promise<TAudienceMember[]> {
  switch (audience.type) {
    case "static":
      return resolveStaticAudience(audience.staticContactIds);
    case "segment":
      if (!audience.segmentId) return [];
      return resolveSegmentAudience(audience.segmentId);
    case "surveyDerived":
      if (!audience.surveyDerivedConfig) return [];
      return resolveSurveyDerivedAudience(audience.surveyDerivedConfig);
    case "snowflakeQuery":
      if (!audience.snowflakeQueryConfig) return [];
      return resolveSnowflakeQueryAudience(audience.snowflakeQueryConfig);
  }
}

async function resolveStaticAudience(contactIds: string[]): Promise<TAudienceMember[]> {
  if (contactIds.length === 0) return [];

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, inactive: false },
    select: {
      id: true,
      email: true,
      externalId: true,
      attributes: {
        select: {
          value: true,
          attributeKey: { select: { key: true, id: true } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const out: TAudienceMember[] = [];
  for (const c of contacts) {
    const email = (c.email ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);

    const attrMap: Record<string, string> = {};
    for (const a of c.attributes) attrMap[a.attributeKey.key] = a.value;

    const firstName = attrMap.firstName?.trim() || null;
    const lastName = attrMap.lastName?.trim() || null;
    const name = [firstName, lastName].filter(Boolean).join(" ") || null;

    out.push({
      email,
      name,
      firstName,
      lastName,
      existingContactId: c.id,
      externalId: c.externalId ?? undefined,
      demographicsSnapshot: { ...attrMap, email, externalId: c.externalId },
    });
  }
  return out;
}

async function resolveSegmentAudience(segmentId: string): Promise<TAudienceMember[]> {
  const contacts = await getContactsInSegment(segmentId);
  if (!contacts) return [];

  const seen = new Set<string>();
  const out: TAudienceMember[] = [];
  for (const contact of contacts) {
    const email = (contact.attributes?.email ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const firstName = contact.attributes?.firstName?.trim() || null;
    const lastName = contact.attributes?.lastName?.trim() || null;
    const name = [firstName, lastName].filter(Boolean).join(" ") || null;

    out.push({
      email,
      name,
      firstName,
      lastName,
      existingContactId: contact.contactId,
      // contact.attributes already includes email + identity; spread
      // the whole map so analysts get full demographics in the snapshot.
      demographicsSnapshot: { ...contact.attributes },
    });
  }
  return out;
}

async function resolveSurveyDerivedAudience(config: {
  sourceSurveyId: string;
  status: "all" | "responded" | "notResponded";
}): Promise<TAudienceMember[]> {
  const respondedFilter =
    config.status === "all"
      ? {}
      : config.status === "responded"
        ? { respondedAt: { not: null } }
        : { respondedAt: null };

  const invitations = await prisma.surveyInvitation.findMany({
    where: {
      surveyId: config.sourceSurveyId,
      ...respondedFilter,
    },
    select: {
      contactId: true,
      recipientEmail: true,
      recipientName: true,
      recipientFirstName: true,
      recipientLastName: true,
      demographicsSnapshot: true,
    },
  });

  const seen = new Set<string>();
  const out: TAudienceMember[] = [];
  for (const inv of invitations) {
    const email = (inv.recipientEmail ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);

    out.push({
      email,
      name: inv.recipientName,
      firstName: inv.recipientFirstName,
      lastName: inv.recipientLastName,
      existingContactId: inv.contactId,
      demographicsSnapshot:
        (inv.demographicsSnapshot as Record<string, unknown> | null) ?? undefined,
    });
  }
  return out;
}

async function resolveSnowflakeQueryAudience(config: {
  queryId: string;
  emailColumn: string;
  nameColumn?: string;
  columnMapping?: unknown;
}): Promise<TAudienceMember[]> {
  const rows = await executeConfiguredQueryAllRows(config.queryId);
  if (!rows || rows.length === 0) return [];

  const seen = new Set<string>();
  const out: TAudienceMember[] = [];
  for (const row of rows) {
    const raw = row[config.emailColumn];
    if (typeof raw !== "string") continue;
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);

    const nameRaw = config.nameColumn ? row[config.nameColumn] : null;
    const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
    let firstName: string | null = null;
    let lastName: string | null = null;
    if (name) {
      const [first, ...rest] = name.split(/\s+/);
      firstName = first || null;
      lastName = rest.join(" ") || null;
    }

    out.push({
      email,
      name,
      firstName,
      lastName,
      existingContactId: null,
      demographicsSnapshot: row,
    });
  }
  return out;
}
```

- [ ] **Step 2: Create the test file**

Create `apps/web/modules/audiences/lib/resolver.test.ts`:

```typescript
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@formbricks/database", () => ({
  prisma: {
    contact: { findMany: vi.fn() },
    surveyInvitation: { findMany: vi.fn() },
  },
}));
vi.mock("@/app/api/member-lookup/configurable-query-service", () => ({
  executeConfiguredQueryAllRows: vi.fn(),
}));
vi.mock("@/modules/ee/contacts/lib/contacts", () => ({
  getContactsInSegment: vi.fn(),
}));

import { prisma } from "@formbricks/database";
import { executeConfiguredQueryAllRows } from "@/app/api/member-lookup/configurable-query-service";
import { getContactsInSegment } from "@/modules/ee/contacts/lib/contacts";
import { resolveAudience } from "./resolver";
import type { TAudience } from "@formbricks/types/audiences";

const baseAud: TAudience = {
  id: "aud1",
  createdAt: new Date(),
  updatedAt: new Date(),
  environmentId: "env1",
  name: "Test",
  description: null,
  type: "static",
  createdBy: null,
  transient: false,
  staticContactIds: [],
  segmentId: null,
  surveyDerivedConfig: null,
  snowflakeQueryConfig: null,
};

afterEach(() => vi.clearAllMocks());

describe("resolveAudience: static", () => {
  test("returns deduplicated members with demographics snapshot", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([
      {
        id: "c1",
        email: "alice@example.com",
        externalId: "M001",
        attributes: [
          { value: "Alice", attributeKey: { key: "firstName", id: "k1" } },
          { value: "NE", attributeKey: { key: "region", id: "k2" } },
        ],
      },
      {
        id: "c2",
        email: "ALICE@example.com",
        externalId: null,
        attributes: [],
      },
    ] as any);

    const result = await resolveAudience({
      ...baseAud,
      type: "static",
      staticContactIds: ["c1", "c2"],
    });

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("alice@example.com");
    expect(result[0].demographicsSnapshot).toMatchObject({ region: "NE", firstName: "Alice" });
  });

  test("returns empty for empty list", async () => {
    const result = await resolveAudience({
      ...baseAud,
      type: "static",
      staticContactIds: [],
    });
    expect(result).toEqual([]);
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
  });
});

describe("resolveAudience: segment", () => {
  test("delegates to getContactsInSegment", async () => {
    vi.mocked(getContactsInSegment).mockResolvedValueOnce([
      {
        contactId: "c1",
        attributes: { email: "bob@example.com", firstName: "Bob", region: "SW" },
      },
    ] as any);

    const result = await resolveAudience({
      ...baseAud,
      type: "segment",
      segmentId: "seg1",
    });

    expect(result[0].email).toBe("bob@example.com");
    expect(result[0].demographicsSnapshot?.region).toBe("SW");
  });
});

describe("resolveAudience: surveyDerived", () => {
  test("filters by respondedAt=null for notResponded", async () => {
    vi.mocked(prisma.surveyInvitation.findMany).mockResolvedValueOnce([
      {
        contactId: "c1",
        recipientEmail: "carol@example.com",
        recipientName: "Carol",
        recipientFirstName: "Carol",
        recipientLastName: null,
        demographicsSnapshot: { region: "NE" },
      },
    ] as any);

    const result = await resolveAudience({
      ...baseAud,
      type: "surveyDerived",
      surveyDerivedConfig: { sourceSurveyId: "s1", status: "notResponded" },
    });

    expect(prisma.surveyInvitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { surveyId: "s1", respondedAt: null },
      })
    );
    expect(result[0].demographicsSnapshot?.region).toBe("NE");
  });

  test("no respondedAt filter for status=all", async () => {
    vi.mocked(prisma.surveyInvitation.findMany).mockResolvedValueOnce([] as any);
    await resolveAudience({
      ...baseAud,
      type: "surveyDerived",
      surveyDerivedConfig: { sourceSurveyId: "s1", status: "all" },
    });
    expect(prisma.surveyInvitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { surveyId: "s1" },
      })
    );
  });
});

describe("resolveAudience: snowflakeQuery", () => {
  test("runs query and snapshots full row payload", async () => {
    vi.mocked(executeConfiguredQueryAllRows).mockResolvedValueOnce([
      { EMAIL: "dave@example.com", FULL_NAME: "Dave Davis", REGION: "NW", AMOUNT: 1500 },
    ] as any);

    const result = await resolveAudience({
      ...baseAud,
      type: "snowflakeQuery",
      snowflakeQueryConfig: { queryId: "q1", emailColumn: "EMAIL", nameColumn: "FULL_NAME" },
    });

    expect(result[0].email).toBe("dave@example.com");
    expect(result[0].firstName).toBe("Dave");
    expect(result[0].lastName).toBe("Davis");
    expect(result[0].demographicsSnapshot).toEqual({
      EMAIL: "dave@example.com",
      FULL_NAME: "Dave Davis",
      REGION: "NW",
      AMOUNT: 1500,
    });
  });

  test("filters rows with non-string email", async () => {
    vi.mocked(executeConfiguredQueryAllRows).mockResolvedValueOnce([
      { EMAIL: null, FULL_NAME: "Nobody" },
      { EMAIL: "ok@example.com", FULL_NAME: "OK" },
    ] as any);

    const result = await resolveAudience({
      ...baseAud,
      type: "snowflakeQuery",
      snowflakeQueryConfig: { queryId: "q1", emailColumn: "EMAIL" },
    });
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm --filter @formbricks/web vitest run modules/audiences/lib/resolver.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/modules/audiences/lib/resolver.ts apps/web/modules/audiences/lib/resolver.test.ts
git commit --no-verify -m "feat(audiences): unified resolver across all four audience types

Dispatches by AudienceType. Each arm returns TAudienceMember[] with
per-member demographicsSnapshot payload that the invitation pipeline
will write to SurveyInvitation.demographicsSnapshot at send time.
Replaces the per-source helpers in survey/invitations/lib/audience.ts
(deleted in Task 12 once cutover is complete)."
```

---

## Task 5: Demographics snapshot wiring

**Goal:** Modify `upsertInvitation` (in `apps/web/modules/survey/invitations/lib/invitations.ts`) so it accepts a `demographicsSnapshot` from the resolved member and writes it to `SurveyInvitation.demographicsSnapshot`. New columns from Task 1 are written here for the first time.

**Files:**
- Modify: `apps/web/modules/survey/invitations/lib/invitations.ts`
- Modify: `apps/web/modules/survey/invitations/lib/invitations.test.ts`

**Acceptance Criteria:**
- [ ] `upsertInvitation` writes `demographicsSnapshot` from `member.demographicsSnapshot` when present.
- [ ] On idempotent re-run (existing invitation with `sentAt` set), the snapshot is NOT overwritten — first send wins.
- [ ] On un-sent existing invitation, snapshot IS updated (catches resolved-but-not-sent state).
- [ ] On fresh create, snapshot is set.
- [ ] `audienceId` column is also written when the caller passes it.
- [ ] Tests cover the three branches (fresh / un-sent existing / sent existing).

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm --filter @formbricks/web vitest run modules/survey/invitations/lib/invitations.test.ts
```

**Steps:**

- [ ] **Step 1: Update `upsertInvitation` signature**

In `apps/web/modules/survey/invitations/lib/invitations.ts`, find the `upsertInvitation` function (line ~139). Update the signature to accept `audienceId`:

```typescript
export async function upsertInvitation(args: {
  surveyId: string;
  member: TAudienceMember;
  environmentId: string;
  audienceId: string | null;
  refreshToken?: boolean;
}): Promise<{ id: string; contactId: string | null; linkToken: string; created: boolean }> {
  const { surveyId, member, environmentId, audienceId, refreshToken = false } = args;
  // ... existing body
```

- [ ] **Step 2: Wire snapshot + audienceId into the three write paths**

Find the three write paths inside `upsertInvitation`:

1. Already-sent path (returns early): no change.
2. Update-existing path (un-sent existing invitation):

```typescript
  if (existing) {
    await prisma.surveyInvitation.update({
      where: { id: existing.id },
      data: {
        linkToken,
        contactId,
        recipientName: member.name,
        recipientFirstName: member.firstName,
        recipientLastName: member.lastName,
        audienceId,
        ...(member.demographicsSnapshot
          ? { demographicsSnapshot: member.demographicsSnapshot }
          : {}),
      },
    });
    return { id: existing.id, contactId, linkToken, created: false };
  }
```

3. Create path:

```typescript
  const created = await prisma.surveyInvitation.create({
    data: {
      surveyId,
      contactId,
      recipientEmail: member.email,
      recipientName: member.name,
      recipientFirstName: member.firstName,
      recipientLastName: member.lastName,
      linkToken,
      audienceId,
      ...(member.demographicsSnapshot
        ? { demographicsSnapshot: member.demographicsSnapshot }
        : {}),
    },
    select: { id: true },
  });
```

- [ ] **Step 3: Update callers to pass audienceId**

Find every call site of `upsertInvitation` in `invitations.ts`. The main one is in `enqueueInvitationsForSurvey` (~line 218). Add `audienceId` to the call:

```typescript
  for (const member of members) {
    const result = await upsertInvitation({
      surveyId,
      member,
      environmentId,
      audienceId: config.audienceId ?? null,  // NEW
      refreshToken: false,
    });
    // ...
  }
```

If `config` doesn't have `audienceId` yet (it won't until Task 12), add a placeholder:

```typescript
  const audienceId = config.audienceId ?? null;
```

(Task 12 changes the call site to read `Survey.audienceId` directly. For now, expose `audienceId` on the config arg.)

- [ ] **Step 4: Update the test file**

Edit `apps/web/modules/survey/invitations/lib/invitations.test.ts`. Add a new `describe("upsertInvitation demographics snapshot", ...)` block:

```typescript
describe("upsertInvitation demographics snapshot", () => {
  test("writes snapshot on fresh create", async () => {
    vi.mocked(prisma.surveyInvitation.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.surveyInvitation.create).mockResolvedValueOnce({ id: "inv1" } as any);
    // ... existing mocks for ensureContact / getContactSurveyLink

    await upsertInvitation({
      surveyId: "s1",
      environmentId: "env1",
      audienceId: "aud1",
      member: {
        email: "alice@example.com",
        name: null,
        firstName: null,
        lastName: null,
        existingContactId: "c1",
        demographicsSnapshot: { region: "NE", customerId: "M001" },
      },
    });

    expect(prisma.surveyInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          audienceId: "aud1",
          demographicsSnapshot: { region: "NE", customerId: "M001" },
        }),
      })
    );
  });

  test("does NOT overwrite snapshot on already-sent re-run", async () => {
    vi.mocked(prisma.surveyInvitation.findUnique).mockResolvedValueOnce({
      id: "inv1",
      contactId: "c1",
      linkToken: "tok",
      sentAt: new Date(),
    } as any);

    await upsertInvitation({
      surveyId: "s1",
      environmentId: "env1",
      audienceId: "aud1",
      member: {
        email: "alice@example.com",
        name: null,
        firstName: null,
        lastName: null,
        existingContactId: "c1",
        demographicsSnapshot: { region: "DIFFERENT" },
      },
    });

    expect(prisma.surveyInvitation.update).not.toHaveBeenCalled();
    expect(prisma.surveyInvitation.create).not.toHaveBeenCalled();
  });

  test("updates snapshot on un-sent existing", async () => {
    vi.mocked(prisma.surveyInvitation.findUnique).mockResolvedValueOnce({
      id: "inv1",
      contactId: "c1",
      linkToken: "tok",
      sentAt: null,
    } as any);
    vi.mocked(prisma.surveyInvitation.update).mockResolvedValueOnce({} as any);

    await upsertInvitation({
      surveyId: "s1",
      environmentId: "env1",
      audienceId: "aud1",
      member: {
        email: "alice@example.com",
        name: null,
        firstName: null,
        lastName: null,
        existingContactId: "c1",
        demographicsSnapshot: { region: "NE" },
      },
    });

    expect(prisma.surveyInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          demographicsSnapshot: { region: "NE" },
        }),
      })
    );
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm --filter @formbricks/web vitest run modules/survey/invitations/lib/invitations.test.ts
```

Expected: all tests pass (existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add apps/web/modules/survey/invitations/lib/invitations.ts \
        apps/web/modules/survey/invitations/lib/invitations.test.ts
git commit --no-verify -m "feat(invitations): persist audienceId + demographics snapshot

upsertInvitation now writes Audience FK and the resolver-supplied
demographics payload to each SurveyInvitation row at send-time.
First-write-wins for the snapshot — already-sent invitations don't get
their snapshot overwritten on idempotent re-runs."
```

---

## Task 6: Audiences list page + nav

**Goal:** Add the Audiences tab to the Contacts secondary navigation and create the list page at `/environments/[environmentId]/audiences`. Lists non-transient audiences with name, type icon, member count, last-used timestamp.

**Files:**
- Modify: `apps/web/modules/ee/contacts/components/contacts-secondary-navigation.tsx`
- Create: `apps/web/app/(app)/environments/[environmentId]/audiences/page.tsx`
- Create: `apps/web/modules/audiences/components/audiences-list-table.tsx`
- Create: `apps/web/modules/audiences/lib/member-count.ts`

**Acceptance Criteria:**
- [ ] Visiting `/environments/<env>/contacts`, `/segments`, `/attributes` shows a 4-tab nav with "Audiences" as the new entry.
- [ ] Visiting `/environments/<env>/audiences` shows a table of non-transient audiences ordered by `updatedAt DESC`.
- [ ] Each row shows: name, type icon, member count (cached 60s), last-used (max `Survey.updatedAt` referencing this audience), createdBy.
- [ ] "Show transient" toggle (URL param `?includeTransient=true`) reveals the auto-created inline audiences.
- [ ] "New audience" button opens the create modal (built in Task 8).
- [ ] Empty state: "No audiences yet — click 'New audience' to create one."

**Verify:** Visit `http://localhost:3001/environments/<env>/audiences`. See empty table + "New audience" CTA. Manually create a row in the DB with `type=static, name='Test'` and verify it renders.

**Steps:**

- [ ] **Step 1: Update secondary navigation**

Edit `apps/web/modules/ee/contacts/components/contacts-secondary-navigation.tsx`. Add a 4th nav entry between Segments and Attributes:

```typescript
  const navigation = [
    {
      id: "contacts",
      label: t("common.contacts"),
      href: `/environments/${environmentId}/contacts`,
    },
    {
      id: "segments",
      label: t("common.segments"),
      href: `/environments/${environmentId}/segments`,
    },
    {
      id: "audiences",
      label: "Audiences",
      href: `/environments/${environmentId}/audiences`,
    },
    {
      id: "attributes",
      label: t("common.attributes"),
      href: `/environments/${environmentId}/attributes`,
    },
  ];
```

(The label is hardcoded — i18n keys for `common.audiences` don't exist yet. Adding to the i18n catalog is out of scope; commit with `--no-verify` to bypass the i18n check, per CLAUDE.md.)

- [ ] **Step 2: Create the member-count helper**

Create `apps/web/modules/audiences/lib/member-count.ts`:

```typescript
import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@formbricks/database";
import { TAudience } from "@formbricks/types/audiences";
import { resolveAudience } from "./resolver";
import { getAudience } from "./audiences";

export async function getAudienceMemberCount(audienceId: string): Promise<number> {
  return unstable_cache(
    async () => {
      const audience = await getAudience(audienceId);
      if (!audience) return 0;
      return computeMemberCount(audience);
    },
    [`audience-member-count-${audienceId}`],
    { revalidate: 60, tags: [`audience-${audienceId}`] }
  )();
}

async function computeMemberCount(audience: TAudience): Promise<number> {
  // Static and segment have cheap counts; surveyDerived/snowflakeQuery
  // require a full resolution. We prefer cheap-when-possible.
  if (audience.type === "static") {
    return audience.staticContactIds.length;
  }
  if (audience.type === "segment" && audience.segmentId) {
    // Reuse the resolver — getContactsInSegment is itself cached.
    const members = await resolveAudience(audience);
    return members.length;
  }
  if (audience.type === "surveyDerived" && audience.surveyDerivedConfig) {
    const cfg = audience.surveyDerivedConfig;
    return prisma.surveyInvitation.count({
      where: {
        surveyId: cfg.sourceSurveyId,
        ...(cfg.status === "responded" ? { respondedAt: { not: null } } : {}),
        ...(cfg.status === "notResponded" ? { respondedAt: null } : {}),
      },
    });
  }
  // snowflakeQuery — must resolve the full query to count.
  const members = await resolveAudience(audience);
  return members.length;
}
```

- [ ] **Step 3: Create the list page**

Create `apps/web/app/(app)/environments/[environmentId]/audiences/page.tsx`:

```typescript
import { authOptions } from "@/modules/auth/lib/authOptions";
import { hasUserEnvironmentAccess } from "@/lib/environment/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ContactsSecondaryNavigation } from "@/modules/ee/contacts/components/contacts-secondary-navigation";
import { PageHeader } from "@/modules/ui/components/page-header";
import { PageContentWrapper } from "@/modules/ui/components/page-content-wrapper";
import { getAudiencesForEnvironment } from "@/modules/audiences/lib/audiences";
import { AudiencesListTable } from "@/modules/audiences/components/audiences-list-table";

export default async function AudiencesPage(props: {
  params: Promise<{ environmentId: string }>;
  searchParams: Promise<{ includeTransient?: string }>;
}) {
  const { environmentId } = await props.params;
  const { includeTransient } = await props.searchParams;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/login");

  const allowed = await hasUserEnvironmentAccess(session.user.id, environmentId);
  if (!allowed) redirect("/environments");

  const audiences = await getAudiencesForEnvironment(environmentId, {
    includeTransient: includeTransient === "true",
  });

  return (
    <PageContentWrapper>
      <PageHeader pageTitle="Contacts">
        <ContactsSecondaryNavigation activeId="audiences" environmentId={environmentId} />
      </PageHeader>
      <AudiencesListTable
        audiences={audiences}
        environmentId={environmentId}
        showingTransient={includeTransient === "true"}
      />
    </PageContentWrapper>
  );
}
```

- [ ] **Step 4: Create the list table component**

Create `apps/web/modules/audiences/components/audiences-list-table.tsx`:

```typescript
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/modules/ui/components/button";
import { Switch } from "@/modules/ui/components/switch";
import { TAudience, TAudienceType } from "@formbricks/types/audiences";
import { CreateAudienceModal } from "./create-audience-modal";
import { ListIcon, FilterIcon, GitBranchIcon, DatabaseIcon } from "lucide-react";

type AudienceWithMeta = TAudience & {
  memberCount?: number;
  lastUsedAt?: Date | null;
};

const TYPE_ICON: Record<TAudienceType, typeof ListIcon> = {
  static: ListIcon,
  segment: FilterIcon,
  surveyDerived: GitBranchIcon,
  snowflakeQuery: DatabaseIcon,
};

const TYPE_LABEL: Record<TAudienceType, string> = {
  static: "Static list",
  segment: "Segment",
  surveyDerived: "From prior survey",
  snowflakeQuery: "Snowflake query",
};

export function AudiencesListTable({
  audiences,
  environmentId,
  showingTransient,
}: {
  audiences: AudienceWithMeta[];
  environmentId: string;
  showingTransient: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const toggleTransient = (next: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("includeTransient", "true");
    else params.delete("includeTransient");
    router.push(`/environments/${environmentId}/audiences?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch checked={showingTransient} onCheckedChange={toggleTransient} id="transient" />
          <label htmlFor="transient" className="text-sm text-slate-600">
            Show transient (auto-created from surveys)
          </label>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New audience</Button>
      </div>

      {audiences.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-8 text-center">
          <p className="text-sm text-slate-500">
            No audiences yet — click &ldquo;New audience&rdquo; to create one.
          </p>
        </div>
      ) : (
        <table className="w-full">
          <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Name</th>
              <th className="py-2">Type</th>
              <th className="py-2 text-right">Members</th>
              <th className="py-2">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {audiences.map((a) => {
              const Icon = TYPE_ICON[a.type];
              return (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3">
                    <Link
                      href={`/environments/${environmentId}/audiences/${a.id}`}
                      className="font-medium text-slate-800 hover:underline">
                      {a.name}
                    </Link>
                    {a.transient && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                        transient
                      </span>
                    )}
                    {a.description && (
                      <p className="text-xs text-slate-500">{a.description}</p>
                    )}
                  </td>
                  <td className="py-3">
                    <div className="inline-flex items-center gap-1 text-sm text-slate-600">
                      <Icon className="h-3.5 w-3.5" />
                      {TYPE_LABEL[a.type]}
                    </div>
                  </td>
                  <td className="py-3 text-right text-sm tabular-nums">
                    {a.memberCount ?? "…"}
                  </td>
                  <td className="py-3 text-sm text-slate-500">
                    {a.updatedAt.toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <CreateAudienceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        environmentId={environmentId}
      />
    </div>
  );
}
```

(The `CreateAudienceModal` is built in Task 8. Until then, replace its usage with a stub `function CreateAudienceModal() { return null; }` so the page compiles.)

- [ ] **Step 5: Wire member counts into the page**

Edit the page (Step 3) to fetch member counts in parallel:

```typescript
import { getAudienceMemberCount } from "@/modules/audiences/lib/member-count";

// after fetching audiences:
const audiencesWithMeta = await Promise.all(
  audiences.map(async (a) => ({
    ...a,
    memberCount: await getAudienceMemberCount(a.id),
  }))
);
```

Pass `audiencesWithMeta` to `<AudiencesListTable>` instead of raw `audiences`.

- [ ] **Step 6: Smoke test**

Start the local stack:

```bash
cd /Users/gcohen/dev/formbricks-phase1a
docker compose -p formbricks-phase1a --env-file .env.docker -f docker-compose.local.yml up -d
```

Visit `http://localhost:3001/environments/<env>/audiences`. Verify:
- 4 tabs in nav (Contacts / Segments / Audiences / Attributes).
- Empty state visible.
- Transient toggle visible (no effect yet since no audiences exist).
- Create button visible (modal stub does nothing).

Insert one row manually and refresh:

```bash
docker compose -p formbricks-phase1a --env-file .env.docker -f docker-compose.local.yml exec postgres \
  psql -U postgres -d formbricks -c "INSERT INTO \"Audience\" (id, updated_at, \"environmentId\", name, type) VALUES ('aud_test', NOW(), '<env-id>', 'Smoke Test', 'static');"
```

Verify the row appears with member count = 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(app\)/environments/\[environmentId\]/audiences/page.tsx \
        apps/web/modules/audiences/components/audiences-list-table.tsx \
        apps/web/modules/audiences/lib/member-count.ts \
        apps/web/modules/ee/contacts/components/contacts-secondary-navigation.tsx
git commit --no-verify -m "feat(audiences): list page + secondary nav entry

Lists non-transient audiences at /environments/<env>/audiences with
type icons, member counts (60s Next cache), and a transient toggle.
Empty state and 'New audience' CTA in place; create modal stub fills in
during Task 8."
```

---

## Task 7: Audience detail page

**Goal:** Build the per-audience detail view at `/environments/[environmentId]/audiences/[audienceId]`. Shows config, member preview (paginated), and the list of surveys using this audience.

**Files:**
- Create: `apps/web/app/(app)/environments/[environmentId]/audiences/[audienceId]/page.tsx`
- Create: `apps/web/modules/audiences/components/audience-detail-card.tsx`

**Acceptance Criteria:**
- [ ] Page renders audience name (editable inline), description, type, config summary.
- [ ] Member preview section shows first 50 resolved members (email + name).
- [ ] "Surveys using this audience" section lists surveys with FK = this audience id.
- [ ] "Promote to permanent" button visible only when `transient=true`.
- [ ] "Delete audience" button + confirmation modal.

**Verify:** Click into the test audience from Task 6 list. Page renders with empty member list and empty survey list.

**Steps:**

- [ ] **Step 1: Create the detail page**

Create `apps/web/app/(app)/environments/[environmentId]/audiences/[audienceId]/page.tsx`:

```typescript
import { authOptions } from "@/modules/auth/lib/authOptions";
import { hasUserEnvironmentAccess } from "@/lib/environment/auth";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@formbricks/database";
import { ContactsSecondaryNavigation } from "@/modules/ee/contacts/components/contacts-secondary-navigation";
import { PageHeader } from "@/modules/ui/components/page-header";
import { PageContentWrapper } from "@/modules/ui/components/page-content-wrapper";
import { getAudience } from "@/modules/audiences/lib/audiences";
import { resolveAudience } from "@/modules/audiences/lib/resolver";
import { AudienceDetailCard } from "@/modules/audiences/components/audience-detail-card";

export default async function AudienceDetailPage(props: {
  params: Promise<{ environmentId: string; audienceId: string }>;
}) {
  const { environmentId, audienceId } = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/login");

  const allowed = await hasUserEnvironmentAccess(session.user.id, environmentId);
  if (!allowed) redirect("/environments");

  const audience = await getAudience(audienceId);
  if (!audience || audience.environmentId !== environmentId) notFound();

  const allMembers = await resolveAudience(audience);
  const memberPreview = allMembers.slice(0, 50);
  const totalMembers = allMembers.length;

  const surveysUsing = await prisma.survey.findMany({
    where: { audienceId },
    select: { id: true, name: true, status: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <PageContentWrapper>
      <PageHeader pageTitle="Contacts">
        <ContactsSecondaryNavigation activeId="audiences" environmentId={environmentId} />
      </PageHeader>
      <AudienceDetailCard
        audience={audience}
        environmentId={environmentId}
        memberPreview={memberPreview}
        totalMembers={totalMembers}
        surveysUsing={surveysUsing}
      />
    </PageContentWrapper>
  );
}
```

- [ ] **Step 2: Create the detail card component**

Create `apps/web/modules/audiences/components/audience-detail-card.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/modules/ui/components/button";
import { Input } from "@/modules/ui/components/input";
import { TAudience, TAudienceType } from "@formbricks/types/audiences";
import { TAudienceMember } from "@/modules/audiences/lib/resolver";
import { deleteAudienceAction, promoteTransientAction, renameAudienceAction } from
  "@/app/(app)/environments/[environmentId]/audiences/actions";
import { Trash2Icon } from "lucide-react";

const TYPE_LABEL: Record<TAudienceType, string> = {
  static: "Static list",
  segment: "Wraps a segment",
  surveyDerived: "From prior survey",
  snowflakeQuery: "Snowflake query (one-off)",
};

export function AudienceDetailCard({
  audience,
  environmentId,
  memberPreview,
  totalMembers,
  surveysUsing,
}: {
  audience: TAudience;
  environmentId: string;
  memberPreview: TAudienceMember[];
  totalMembers: number;
  surveysUsing: Array<{ id: string; name: string; status: string; updatedAt: Date }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(audience.name);
  const [editingName, setEditingName] = useState(false);

  const onRename = () => {
    startTransition(async () => {
      await renameAudienceAction({ audienceId: audience.id, name });
      setEditingName(false);
      router.refresh();
    });
  };

  const onPromote = () => {
    startTransition(async () => {
      await promoteTransientAction({ audienceId: audience.id });
      router.refresh();
    });
  };

  const onDelete = () => {
    if (!confirm(`Delete "${audience.name}"? Surveys using it will be unlinked.`)) return;
    startTransition(async () => {
      await deleteAudienceAction({ audienceId: audience.id });
      router.push(`/environments/${environmentId}/audiences`);
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            {editingName ? (
              <div className="flex items-center gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
                <Button onClick={onRename} disabled={pending}>Save</Button>
                <Button variant="secondary" onClick={() => { setName(audience.name); setEditingName(false); }}>
                  Cancel
                </Button>
              </div>
            ) : (
              <h2 className="text-xl font-semibold text-slate-800">
                {audience.name}{" "}
                <button
                  className="text-xs text-slate-500 hover:underline"
                  onClick={() => setEditingName(true)}>
                  edit
                </button>
              </h2>
            )}
            <p className="mt-1 text-sm text-slate-500">{TYPE_LABEL[audience.type]}</p>
            {audience.description && (
              <p className="mt-2 text-sm text-slate-600">{audience.description}</p>
            )}
          </div>
          <div className="flex gap-2">
            {audience.transient && (
              <Button onClick={onPromote} disabled={pending} variant="secondary">
                Promote to permanent
              </Button>
            )}
            <Button onClick={onDelete} disabled={pending} variant="destructive">
              <Trash2Icon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-slate-700">
          Members ({totalMembers})
        </h3>
        {memberPreview.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No members resolved.</p>
        ) : (
          <ul className="mt-2 max-h-96 space-y-1 overflow-y-auto">
            {memberPreview.map((m) => (
              <li key={m.email} className="text-sm">
                <span className="text-slate-700">{m.email}</span>
                {m.name && <span className="ml-2 text-slate-500">— {m.name}</span>}
              </li>
            ))}
          </ul>
        )}
        {totalMembers > memberPreview.length && (
          <p className="mt-2 text-xs text-slate-500">
            Showing first {memberPreview.length} of {totalMembers}.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-slate-700">
          Surveys using this audience ({surveysUsing.length})
        </h3>
        {surveysUsing.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No surveys use this audience yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {surveysUsing.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/environments/${environmentId}/surveys/${s.id}/edit`}
                  className="text-sm text-sky-600 hover:underline">
                  {s.name}
                </Link>
                <span className="ml-2 text-xs text-slate-500">
                  {s.status} · {s.updatedAt.toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

(The action imports come from Task 10 — until then the imports won't resolve. Stub them with `const renameAudienceAction = async () => {}` etc. inline if you need to compile early.)

- [ ] **Step 3: Smoke test**

Click into the test audience created in Task 6. Verify all three sections render with correct empty states.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(app\)/environments/\[environmentId\]/audiences/\[audienceId\]/ \
        apps/web/modules/audiences/components/audience-detail-card.tsx
git commit --no-verify -m "feat(audiences): per-audience detail page

Renders audience config, member preview (first 50), and list of surveys
using this audience. Inline rename, promote-transient, and delete
controls. Server actions wired in Task 10."
```

---

## Task 8: Create audience — type picker + static + segment forms

**Goal:** Build the create-audience modal with a type picker step and the two simpler forms (`static` and `segment`). Save via a server action that calls `createAudience`.

**Files:**
- Create: `apps/web/modules/audiences/components/create-audience-modal.tsx`
- Create: `apps/web/modules/audiences/components/forms/static-form.tsx`
- Create: `apps/web/modules/audiences/components/forms/segment-form.tsx`
- Create: `apps/web/app/(app)/environments/[environmentId]/audiences/actions.ts` (initially with `createAudienceAction` only — Task 10 adds rename/promote/delete)

**Acceptance Criteria:**
- [ ] Modal opens from the "New audience" button on the list page.
- [ ] Step 1: Type picker — 4 cards (static / segment / surveyDerived / snowflakeQuery). surveyDerived and snowflakeQuery cards render as "Coming next step" until Task 9 lands.
- [ ] Step 2 (static): name + description + Contact picker (multi-select via list query). Submit creates audience and navigates to detail page.
- [ ] Step 2 (segment): name + description + segment dropdown. Submit creates audience and navigates to detail page.
- [ ] All forms validate via `ZAudienceCreate` server-side; client shows inline errors on failure.

**Verify:** From the list page, click "New audience" → pick "Static list" → fill name + select 2 contacts → Submit. Audience appears in the list. Same for "Segment" type.

**Steps:**

- [ ] **Step 1: Create the server action file**

Create `apps/web/app/(app)/environments/[environmentId]/audiences/actions.ts`:

```typescript
"use server";

import { authOptions } from "@/modules/auth/lib/authOptions";
import { hasUserEnvironmentAccess } from "@/lib/environment/auth";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { createAudience } from "@/modules/audiences/lib/audiences";
import { TAudienceCreate } from "@formbricks/types/audiences";

export async function createAudienceAction(args: {
  environmentId: string;
  input: TAudienceCreate;
}): Promise<{ ok: true; audienceId: string } | { ok: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, error: "unauthorized" };
  const allowed = await hasUserEnvironmentAccess(session.user.id, args.environmentId);
  if (!allowed) return { ok: false, error: "forbidden" };

  try {
    const audience = await createAudience(args.environmentId, args.input, session.user.id);
    revalidatePath(`/environments/${args.environmentId}/audiences`);
    return { ok: true, audienceId: audience.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "create failed" };
  }
}
```

- [ ] **Step 2: Create the modal shell with type picker**

Create `apps/web/modules/audiences/components/create-audience-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/modules/ui/components/modal";
import { Button } from "@/modules/ui/components/button";
import { TAudienceType } from "@formbricks/types/audiences";
import { StaticAudienceForm } from "./forms/static-form";
import { SegmentAudienceForm } from "./forms/segment-form";
import { SurveyDerivedAudienceForm } from "./forms/survey-derived-form";
import { SnowflakeQueryAudienceForm } from "./forms/snowflake-query-form";
import { ListIcon, FilterIcon, GitBranchIcon, DatabaseIcon } from "lucide-react";

type Step = "pick" | TAudienceType;

const TYPE_CARDS: Array<{
  type: TAudienceType;
  label: string;
  desc: string;
  icon: typeof ListIcon;
}> = [
  { type: "static", label: "Static list", desc: "Pick specific contacts", icon: ListIcon },
  { type: "segment", label: "Segment", desc: "Wrap a saved filter", icon: FilterIcon },
  {
    type: "surveyDerived",
    label: "From prior survey",
    desc: "Slice a previous survey's invitees",
    icon: GitBranchIcon,
  },
  {
    type: "snowflakeQuery",
    label: "Snowflake query",
    desc: "One-off pull (rare)",
    icon: DatabaseIcon,
  },
];

export function CreateAudienceModal({
  open,
  onClose,
  environmentId,
}: {
  open: boolean;
  onClose: () => void;
  environmentId: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");

  const handleSuccess = (audienceId: string) => {
    onClose();
    setStep("pick");
    router.push(`/environments/${environmentId}/audiences/${audienceId}`);
  };

  const reset = () => {
    setStep("pick");
    onClose();
  };

  return (
    <Modal open={open} setOpen={(v) => !v && reset()} title="New audience">
      {step === "pick" && (
        <div className="grid grid-cols-2 gap-3 p-2">
          {TYPE_CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.type}
                onClick={() => setStep(c.type)}
                className="flex flex-col items-start gap-2 rounded-md border border-slate-200 p-4 text-left hover:border-sky-300 hover:bg-sky-50">
                <Icon className="h-5 w-5 text-slate-600" />
                <p className="font-medium text-slate-800">{c.label}</p>
                <p className="text-xs text-slate-500">{c.desc}</p>
              </button>
            );
          })}
        </div>
      )}

      {step === "static" && (
        <StaticAudienceForm
          environmentId={environmentId}
          onCancel={reset}
          onSuccess={handleSuccess}
        />
      )}
      {step === "segment" && (
        <SegmentAudienceForm
          environmentId={environmentId}
          onCancel={reset}
          onSuccess={handleSuccess}
        />
      )}
      {step === "surveyDerived" && (
        <SurveyDerivedAudienceForm
          environmentId={environmentId}
          onCancel={reset}
          onSuccess={handleSuccess}
        />
      )}
      {step === "snowflakeQuery" && (
        <SnowflakeQueryAudienceForm
          environmentId={environmentId}
          onCancel={reset}
          onSuccess={handleSuccess}
        />
      )}
    </Modal>
  );
}
```

- [ ] **Step 3: Create the static form**

Create `apps/web/modules/audiences/components/forms/static-form.tsx`:

```typescript
"use client";

import { useState, useEffect, useTransition } from "react";
import { Input } from "@/modules/ui/components/input";
import { Label } from "@/modules/ui/components/label";
import { Button } from "@/modules/ui/components/button";
import { createAudienceAction } from
  "@/app/(app)/environments/[environmentId]/audiences/actions";

type ContactRow = { id: string; email: string | null; firstName?: string; lastName?: string };

export function StaticAudienceForm({
  environmentId,
  onCancel,
  onSuccess,
}: {
  environmentId: string;
  onCancel: () => void;
  onSuccess: (audienceId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Fetch contacts (debounced search) via the existing contacts API.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/v1/environments/${environmentId}/contacts?search=${encodeURIComponent(search)}&limit=50`,
        { signal: ctrl.signal }
      ).catch(() => null);
      if (!res?.ok) return;
      const json = (await res.json()) as { data: ContactRow[] };
      setContacts(json.data);
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [environmentId, search]);

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    if (selected.size === 0) return setError("Pick at least one contact.");

    startTransition(async () => {
      const result = await createAudienceAction({
        environmentId,
        input: {
          type: "static",
          name: name.trim(),
          description: description.trim() || undefined,
          staticContactIds: Array.from(selected),
        },
      });
      if (!result.ok) return setError(result.error);
      onSuccess(result.audienceId);
    });
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <Label htmlFor="aud-name">Name</Label>
        <Input id="aud-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="aud-desc">Description (optional)</Label>
        <Input id="aud-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <Label>Contacts</Label>
        <Input
          placeholder="Search by email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="mt-2 max-h-64 overflow-y-auto rounded border border-slate-200">
          {contacts.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 border-b border-slate-100 p-2 last:border-b-0 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={(e) => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    return next;
                  });
                }}
              />
              <span className="text-sm">
                {c.email}
                {c.firstName && (
                  <span className="ml-2 text-xs text-slate-500">
                    {c.firstName} {c.lastName ?? ""}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">{selected.size} selected</p>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={pending}>Create</Button>
      </div>
    </div>
  );
}
```

If `/api/v1/environments/[envId]/contacts?search=…` doesn't exist, locate the existing internal contact list endpoint (grep for `getContactsForEnvironment` or similar) and use that. The exact endpoint contract isn't critical — anything that returns `{ data: [{ id, email, firstName?, lastName? }, ...] }` works.

- [ ] **Step 4: Create the segment form**

Create `apps/web/modules/audiences/components/forms/segment-form.tsx`:

```typescript
"use client";

import { useState, useEffect, useTransition } from "react";
import { Input } from "@/modules/ui/components/input";
import { Label } from "@/modules/ui/components/label";
import { Button } from "@/modules/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
  from "@/modules/ui/components/select";
import { createAudienceAction } from
  "@/app/(app)/environments/[environmentId]/audiences/actions";

type Segment = { id: string; title: string };

export function SegmentAudienceForm({
  environmentId,
  onCancel,
  onSuccess,
}: {
  environmentId: string;
  onCancel: () => void;
  onSuccess: (audienceId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    fetch(`/api/v1/environments/${environmentId}/segments`)
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: Segment[] }) => setSegments(j.data ?? []))
      .catch(() => setSegments([]));
  }, [environmentId]);

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    if (!segmentId) return setError("Pick a segment.");

    startTransition(async () => {
      const result = await createAudienceAction({
        environmentId,
        input: {
          type: "segment",
          name: name.trim(),
          description: description.trim() || undefined,
          segmentId,
        },
      });
      if (!result.ok) return setError(result.error);
      onSuccess(result.audienceId);
    });
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <Label htmlFor="aud-name">Name</Label>
        <Input id="aud-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="aud-desc">Description (optional)</Label>
        <Input id="aud-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <Label>Segment</Label>
        <Select value={segmentId} onValueChange={setSegmentId}>
          <SelectTrigger><SelectValue placeholder="Choose a segment…" /></SelectTrigger>
          <SelectContent>
            {segments.length === 0 ? (
              <div className="p-2 text-sm text-slate-500">
                No segments — create one under Contacts → Segments first.
              </div>
            ) : (
              segments.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={pending}>Create</Button>
      </div>
    </div>
  );
}
```

The recipients-card already does similar segment-fetching — if `/api/v1/environments/[envId]/segments` doesn't exist, look for the existing segment-list mechanism in the codebase (grep `getSegmentsForEnvironment`) and reuse it.

- [ ] **Step 5: Create stub forms for the other two types**

Create `apps/web/modules/audiences/components/forms/survey-derived-form.tsx`:

```typescript
"use client";
export function SurveyDerivedAudienceForm(_: {
  environmentId: string;
  onCancel: () => void;
  onSuccess: (audienceId: string) => void;
}) {
  return (
    <div className="p-4 text-sm text-slate-500">
      Coming in Task 9 — survey-derived form.
    </div>
  );
}
```

Create `apps/web/modules/audiences/components/forms/snowflake-query-form.tsx` with the same shape (different label).

- [ ] **Step 6: Smoke test**

From the list page, click "New audience" → "Static list" → fill name + pick 1 contact → Submit. Audience appears in list at the top, then auto-redirects to detail page. Same for "Segment" type if any segments exist.

- [ ] **Step 7: Commit**

```bash
git add apps/web/modules/audiences/components/create-audience-modal.tsx \
        apps/web/modules/audiences/components/forms/ \
        apps/web/app/\(app\)/environments/\[environmentId\]/audiences/actions.ts
git commit --no-verify -m "feat(audiences): create modal + static + segment forms

Type picker landing step, plus working forms for static (multi-select
contacts) and segment (pick existing segment) audience types. The
remaining two types are stubs filled in by Task 9. Server action
validates via ZAudienceCreate."
```

---

## Task 9: Create audience — surveyDerived + snowflakeQuery forms

**Goal:** Replace the stubs from Task 8 with working forms for `surveyDerived` and `snowflakeQuery` audience types.

**Files:**
- Modify: `apps/web/modules/audiences/components/forms/survey-derived-form.tsx`
- Modify: `apps/web/modules/audiences/components/forms/snowflake-query-form.tsx`

**Acceptance Criteria:**
- [ ] surveyDerived form: name + description + survey dropdown (lists environment surveys with status≠draft) + status filter (`all` / `responded` / `notResponded`).
- [ ] snowflakeQuery form: name + description + query dropdown (lists registered queries from `/api/query/config`) + email-column input + name-column input (optional). Reuses the column-mapping picker from Phase 1a if needed for advanced use; for v1 minimum a flat `emailColumn` field is enough.
- [ ] Both submit via `createAudienceAction`.

**Verify:** Create one of each type via the modal. Detail page resolves members correctly (surveyDerived shows prior survey's invitees; snowflakeQuery runs the query and shows the result).

**Steps:**

- [ ] **Step 1: Build the surveyDerived form**

Replace the stub in `survey-derived-form.tsx` with:

```typescript
"use client";

import { useState, useEffect, useTransition } from "react";
import { Input } from "@/modules/ui/components/input";
import { Label } from "@/modules/ui/components/label";
import { Button } from "@/modules/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
  from "@/modules/ui/components/select";
import { createAudienceAction } from
  "@/app/(app)/environments/[environmentId]/audiences/actions";

type SurveyOpt = { id: string; name: string; status: string };
type Status = "all" | "responded" | "notResponded";

const STATUS_LABEL: Record<Status, string> = {
  all: "All recipients",
  responded: "Responded only",
  notResponded: "Did not respond",
};

export function SurveyDerivedAudienceForm({
  environmentId,
  onCancel,
  onSuccess,
}: {
  environmentId: string;
  onCancel: () => void;
  onSuccess: (audienceId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [surveys, setSurveys] = useState<SurveyOpt[]>([]);
  const [sourceSurveyId, setSourceSurveyId] = useState("");
  const [status, setStatus] = useState<Status>("notResponded");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    fetch(`/api/v1/environments/${environmentId}/surveys`)
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: SurveyOpt[] }) =>
        setSurveys((j.data ?? []).filter((s) => s.status !== "draft"))
      )
      .catch(() => setSurveys([]));
  }, [environmentId]);

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    if (!sourceSurveyId) return setError("Pick a source survey.");

    startTransition(async () => {
      const result = await createAudienceAction({
        environmentId,
        input: {
          type: "surveyDerived",
          name: name.trim(),
          description: description.trim() || undefined,
          surveyDerivedConfig: { sourceSurveyId, status },
        },
      });
      if (!result.ok) return setError(result.error);
      onSuccess(result.audienceId);
    });
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <Label htmlFor="aud-name">Name</Label>
        <Input id="aud-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="aud-desc">Description (optional)</Label>
        <Input id="aud-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <Label>Source survey</Label>
        <Select value={sourceSurveyId} onValueChange={setSourceSurveyId}>
          <SelectTrigger><SelectValue placeholder="Pick a previous survey…" /></SelectTrigger>
          <SelectContent>
            {surveys.length === 0 ? (
              <div className="p-2 text-sm text-slate-500">No surveys yet.</div>
            ) : (
              surveys.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} <span className="text-xs text-slate-400">({s.status})</span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Filter</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.entries(STATUS_LABEL) as [Status, string][]).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={pending}>Create</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build the snowflakeQuery form**

Replace the stub in `snowflake-query-form.tsx` with:

```typescript
"use client";

import { useState, useEffect, useTransition } from "react";
import { Input } from "@/modules/ui/components/input";
import { Label } from "@/modules/ui/components/label";
import { Button } from "@/modules/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
  from "@/modules/ui/components/select";
import { createAudienceAction } from
  "@/app/(app)/environments/[environmentId]/audiences/actions";

type QueryOpt = { id: string; name: string; description?: string };

export function SnowflakeQueryAudienceForm({
  environmentId,
  onCancel,
  onSuccess,
}: {
  environmentId: string;
  onCancel: () => void;
  onSuccess: (audienceId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [queries, setQueries] = useState<QueryOpt[]>([]);
  const [queryId, setQueryId] = useState("");
  const [emailColumn, setEmailColumn] = useState("email");
  const [nameColumn, setNameColumn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    fetch(`/api/query/config`)
      .then((r) => r.ok ? r.json() : { queries: [] })
      .then((j: { queries: QueryOpt[] }) => setQueries(j.queries ?? []))
      .catch(() => setQueries([]));
  }, []);

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    if (!queryId) return setError("Pick a query.");
    if (!emailColumn.trim()) return setError("Email column is required.");

    startTransition(async () => {
      const result = await createAudienceAction({
        environmentId,
        input: {
          type: "snowflakeQuery",
          name: name.trim(),
          description: description.trim() || undefined,
          snowflakeQueryConfig: {
            queryId,
            emailColumn: emailColumn.trim(),
            nameColumn: nameColumn.trim() || undefined,
          },
        },
      });
      if (!result.ok) return setError(result.error);
      onSuccess(result.audienceId);
    });
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <Label htmlFor="aud-name">Name</Label>
        <Input id="aud-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="aud-desc">Description (optional)</Label>
        <Input id="aud-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <Label>Query</Label>
        <Select value={queryId} onValueChange={setQueryId}>
          <SelectTrigger><SelectValue placeholder="Pick a registered query…" /></SelectTrigger>
          <SelectContent>
            {queries.length === 0 ? (
              <div className="p-2 text-sm text-slate-500">No queries registered yet.</div>
            ) : (
              queries.map((q) => (
                <SelectItem key={q.id} value={q.id}>
                  {q.name}{q.description ? <span className="text-xs text-slate-400"> — {q.description}</span> : null}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="email-col">Email column</Label>
        <Input
          id="email-col"
          value={emailColumn}
          onChange={(e) => setEmailColumn(e.target.value)}
          placeholder="EMAIL"
        />
      </div>
      <div>
        <Label htmlFor="name-col">Name column (optional)</Label>
        <Input
          id="name-col"
          value={nameColumn}
          onChange={(e) => setNameColumn(e.target.value)}
          placeholder="FULL_NAME"
        />
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={pending}>Create</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Smoke test**

Create one surveyDerived audience pointing at an existing survey with `notResponded` filter. Detail page should show the right invitee count. Create one snowflakeQuery audience. Detail page should run the query and show resolved emails.

- [ ] **Step 4: Commit**

```bash
git add apps/web/modules/audiences/components/forms/survey-derived-form.tsx \
        apps/web/modules/audiences/components/forms/snowflake-query-form.tsx
git commit --no-verify -m "feat(audiences): forms for surveyDerived and snowflakeQuery types

surveyDerived: pick prior survey + status filter (all/responded/
notResponded). snowflakeQuery: pick registered query + email/name
column. Both create via the same server action with ZAudienceCreate
validation."
```

---

## Task 10: Edit / delete / promote-transient server actions

**Goal:** Add the remaining server actions referenced by `audience-detail-card.tsx`. Wire them so the detail-page CTAs work end-to-end.

**Files:**
- Modify: `apps/web/app/(app)/environments/[environmentId]/audiences/actions.ts`

**Acceptance Criteria:**
- [ ] `renameAudienceAction({ audienceId, name })` updates name; revalidates list + detail paths.
- [ ] `updateDescriptionAction({ audienceId, description })` updates description.
- [ ] `promoteTransientAction({ audienceId })` clears `transient`.
- [ ] `deleteAudienceAction({ audienceId })` deletes and revalidates list.
- [ ] All actions check session + environment access, returning `{ ok: false, error }` on auth failure.

**Verify:** From the detail page: rename works (input + Save), promote-transient works (button disappears after), delete works (modal confirms, redirects to list).

**Steps:**

- [ ] **Step 1: Append actions**

Append to `apps/web/app/(app)/environments/[environmentId]/audiences/actions.ts`:

```typescript
import {
  deleteAudience,
  getAudience,
  promoteTransientAudience,
  updateAudience,
} from "@/modules/audiences/lib/audiences";

async function authorizeForAudience(audienceId: string) {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false as const, error: "unauthorized" };
  const audience = await getAudience(audienceId);
  if (!audience) return { ok: false as const, error: "not-found" };
  const allowed = await hasUserEnvironmentAccess(session.user.id, audience.environmentId);
  if (!allowed) return { ok: false as const, error: "forbidden" };
  return { ok: true as const, audience };
}

export async function renameAudienceAction(args: { audienceId: string; name: string }) {
  const auth = await authorizeForAudience(args.audienceId);
  if (!auth.ok) return auth;

  try {
    await updateAudience(args.audienceId, { name: args.name });
    revalidatePath(`/environments/${auth.audience.environmentId}/audiences`);
    revalidatePath(`/environments/${auth.audience.environmentId}/audiences/${args.audienceId}`);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "rename failed" };
  }
}

export async function updateDescriptionAction(args: {
  audienceId: string;
  description: string | null;
}) {
  const auth = await authorizeForAudience(args.audienceId);
  if (!auth.ok) return auth;
  try {
    await updateAudience(args.audienceId, { description: args.description });
    revalidatePath(`/environments/${auth.audience.environmentId}/audiences/${args.audienceId}`);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "update failed" };
  }
}

export async function promoteTransientAction(args: { audienceId: string }) {
  const auth = await authorizeForAudience(args.audienceId);
  if (!auth.ok) return auth;
  try {
    await promoteTransientAudience(args.audienceId);
    revalidatePath(`/environments/${auth.audience.environmentId}/audiences`);
    revalidatePath(`/environments/${auth.audience.environmentId}/audiences/${args.audienceId}`);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "promote failed" };
  }
}

export async function deleteAudienceAction(args: { audienceId: string }) {
  const auth = await authorizeForAudience(args.audienceId);
  if (!auth.ok) return auth;
  try {
    await deleteAudience(args.audienceId);
    revalidatePath(`/environments/${auth.audience.environmentId}/audiences`);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "delete failed" };
  }
}
```

- [ ] **Step 2: Smoke test**

From an audience detail page:
1. Click "edit" next to name → change → Save. Page refreshes, name updated.
2. If transient, click "Promote to permanent" → button disappears.
3. Click delete → confirm → redirected to list, audience gone.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/\(app\)/environments/\[environmentId\]/audiences/actions.ts
git commit --no-verify -m "feat(audiences): rename / promote-transient / delete server actions

Wires the detail-page CTAs (Task 7) end-to-end. Each action checks
session + environment access via the audience's environmentId."
```

---

## Task 11: Recipients card audience picker rewrite + inline-create

**Goal:** Replace the three-radio source picker (`segment` / `snowflake` / `manualList`) on the survey-editor recipients card with a single audience dropdown. Inline "Create new" opens the create-audience modal with `transient: true` pre-set.

**Files:**
- Create: `apps/web/modules/audiences/components/audience-picker.tsx`
- Modify: `apps/web/modules/survey/invitations/components/recipients-card.tsx`
- Modify: `packages/types/surveys/types.ts`

**Acceptance Criteria:**
- [ ] `<AudiencePicker>` shows all non-transient environment audiences in a dropdown plus an "Add transient (this survey only)" toggle that includes transient audiences in the list.
- [ ] "Create new audience" button below the dropdown opens the `CreateAudienceModal` (Task 8/9). The modal sets `transient: true` on submission.
- [ ] On selection, the picker calls a server action that sets `Survey.audienceId`.
- [ ] Recipients-card no longer has the three radio buttons; the audience-source-specific config blocks (segment dropdown, snowflake fields, manualList textarea) are gone.
- [ ] `ZSurveyInvitationConfig` schema is relaxed to make `audience` optional (so legacy reads don't error during the cutover window).

**Verify:** Open a survey editor. Recipients card shows only the new picker. Pick an audience → save → reload → the same audience is selected. Click "Create new" → modal opens; submit → modal closes, audience appears selected.

**Steps:**

- [ ] **Step 1: Loosen the legacy config schema**

Edit `packages/types/surveys/types.ts`. Find `ZSurveyInvitationConfig` (line ~405) and make `audience` optional + add `audienceId`:

```typescript
export const ZSurveyInvitationConfig = z.object({
  audience: ZInvitationAudience.optional(),
  audienceId: z.string().cuid2().optional(),
  reminderSchedule: ZReminderSchedule,
  emailTemplates: ZInvitationEmailTemplates,
});
```

(Phase 1b reads `audienceId` from the Survey row directly, but the in-memory `TSurveyInvitationConfig` shape carries it through some legacy code paths — add it here for compile-time consistency. Actual persistence is on `Survey.audienceId`, not in this JSON.)

- [ ] **Step 2: Create the picker component**

Create `apps/web/modules/audiences/components/audience-picker.tsx`:

```typescript
"use client";

import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
  from "@/modules/ui/components/select";
import { Button } from "@/modules/ui/components/button";
import { Switch } from "@/modules/ui/components/switch";
import { TAudience, TAudienceType } from "@formbricks/types/audiences";
import { CreateAudienceModal } from "./create-audience-modal";
import { ListIcon, FilterIcon, GitBranchIcon, DatabaseIcon } from "lucide-react";

const TYPE_ICON: Record<TAudienceType, typeof ListIcon> = {
  static: ListIcon,
  segment: FilterIcon,
  surveyDerived: GitBranchIcon,
  snowflakeQuery: DatabaseIcon,
};

export function AudiencePicker({
  environmentId,
  audienceId,
  onChange,
}: {
  environmentId: string;
  audienceId: string | null;
  onChange: (audienceId: string) => void;
}) {
  const [audiences, setAudiences] = useState<TAudience[]>([]);
  const [includeTransient, setIncludeTransient] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch(
      `/api/v1/environments/${environmentId}/audiences?includeTransient=${includeTransient}`
    )
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((j: { data: TAudience[] }) => setAudiences(j.data ?? []))
      .catch(() => setAudiences([]));
  }, [environmentId, includeTransient, reloadKey]);

  return (
    <div className="space-y-2">
      <Select value={audienceId ?? ""} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Choose an audience…" /></SelectTrigger>
        <SelectContent>
          {audiences.length === 0 ? (
            <div className="p-2 text-sm text-slate-500">
              No audiences yet — click &ldquo;Create new audience&rdquo; below.
            </div>
          ) : (
            audiences.map((a) => {
              const Icon = TYPE_ICON[a.type];
              return (
                <SelectItem key={a.id} value={a.id}>
                  <div className="inline-flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {a.name}
                    {a.transient && (
                      <span className="rounded bg-amber-100 px-1 text-xs text-amber-700">
                        transient
                      </span>
                    )}
                  </div>
                </SelectItem>
              );
            })
          )}
        </SelectContent>
      </Select>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch checked={includeTransient} onCheckedChange={setIncludeTransient} id="incl-tr" />
          <label htmlFor="incl-tr" className="text-xs text-slate-500">
            Include transient audiences
          </label>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
          Create new audience
        </Button>
      </div>
      <CreateAudienceModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setReloadKey((k) => k + 1);
        }}
        environmentId={environmentId}
        defaultTransient={true}
        onCreated={(id) => {
          setReloadKey((k) => k + 1);
          onChange(id);
        }}
      />
    </div>
  );
}
```

The `CreateAudienceModal` API needs two new props: `defaultTransient` and `onCreated`. Update the modal:

In `create-audience-modal.tsx`, add to `Props`:

```typescript
defaultTransient?: boolean;
onCreated?: (audienceId: string) => void;
```

And in `handleSuccess`:

```typescript
const handleSuccess = (audienceId: string) => {
  onCreated?.(audienceId);
  onClose();
  setStep("pick");
  if (!onCreated) {
    router.push(`/environments/${environmentId}/audiences/${audienceId}`);
  }
};
```

Pass `defaultTransient` down to each form, which adds `transient: true` to the create-action input. Each form reads `transient` from a prop default:

```typescript
// in static-form.tsx etc.:
input: {
  type: "static",
  name: name.trim(),
  description: description.trim() || undefined,
  staticContactIds: Array.from(selected),
  transient: defaultTransient ?? false,
},
```

- [ ] **Step 3: Add the audiences list endpoint**

The picker fetches from `/api/v1/environments/[envId]/audiences`. Create this minimal endpoint at `apps/web/app/api/v1/environments/[environmentId]/audiences/route.ts`:

```typescript
import { authOptions } from "@/modules/auth/lib/authOptions";
import { hasUserEnvironmentAccess } from "@/lib/environment/auth";
import { getAudiencesForEnvironment } from "@/modules/audiences/lib/audiences";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ environmentId: string }> }
) {
  const { environmentId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: [] }, { status: 401 });
  const allowed = await hasUserEnvironmentAccess(session.user.id, environmentId);
  if (!allowed) return NextResponse.json({ data: [] }, { status: 403 });

  const url = new URL(req.url);
  const includeTransient = url.searchParams.get("includeTransient") === "true";
  const data = await getAudiencesForEnvironment(environmentId, { includeTransient });
  return NextResponse.json({ data });
}
```

- [ ] **Step 4: Add the set-survey-audience server action**

Create `apps/web/app/(app)/environments/[environmentId]/surveys/[surveyId]/edit/audience-actions.ts`:

```typescript
"use server";

import { authOptions } from "@/modules/auth/lib/authOptions";
import { hasUserEnvironmentAccess } from "@/lib/environment/auth";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@formbricks/database";

export async function setSurveyAudienceAction(args: {
  environmentId: string;
  surveyId: string;
  audienceId: string | null;
}) {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false as const, error: "unauthorized" };
  const allowed = await hasUserEnvironmentAccess(session.user.id, args.environmentId);
  if (!allowed) return { ok: false as const, error: "forbidden" };

  await prisma.survey.update({
    where: { id: args.surveyId },
    data: { audienceId: args.audienceId },
  });
  revalidatePath(`/environments/${args.environmentId}/surveys/${args.surveyId}/edit`);
  return { ok: true as const };
}
```

- [ ] **Step 5: Rewrite the recipients-card audience section**

In `apps/web/modules/survey/invitations/components/recipients-card.tsx`:

- Remove the entire `<Select value={audience.source} onValueChange={…}>` block + the three conditional sub-blocks (`audience.source === "segment"`, `=== "manualList"`, `=== "snowflake"`).
- Remove `manualListRaw`, `csvInputRef`, CSV-handling code, and segment-fetching code (move segment fetch into the picker if needed).
- Add `audienceId` to the component's props and call the picker:

```tsx
<section className="space-y-2">
  <Label>Audience</Label>
  <AudiencePicker
    environmentId={environmentId}
    audienceId={audienceId}
    onChange={async (newId) => {
      await setSurveyAudienceAction({
        environmentId,
        surveyId,
        audienceId: newId,
      });
      // Optionally trigger router.refresh() here.
    }}
  />
</section>
```

The parent of `recipients-card.tsx` (the survey edit page) passes `audienceId` from `Survey.audienceId`. Trace the prop chain — `Survey` is fetched in the edit page; pass `survey.audienceId` down through `RecipientsCard`'s prop list.

- [ ] **Step 6: Smoke test**

Open an existing survey's edit page (`/environments/<env>/surveys/<id>/edit`):
- The recipients card now shows ONLY the new picker (no radio group).
- If the survey was backfilled from a segment/snowflake config, the right audience is preselected.
- Pick a different audience → reload → the new selection persists.
- Click "Create new audience" → modal opens with type picker → create static → modal closes → new audience selected automatically.

- [ ] **Step 7: Commit**

```bash
git add apps/web/modules/audiences/components/audience-picker.tsx \
        apps/web/modules/audiences/components/create-audience-modal.tsx \
        apps/web/modules/audiences/components/forms/ \
        apps/web/app/api/v1/environments/\[environmentId\]/audiences/ \
        apps/web/app/\(app\)/environments/\[environmentId\]/surveys/\[surveyId\]/edit/audience-actions.ts \
        apps/web/modules/survey/invitations/components/recipients-card.tsx \
        packages/types/surveys/types.ts
git commit --no-verify -m "feat(audiences): single-dropdown picker on recipients card

Replaces the three-radio source picker (segment/snowflake/manualList)
with a single AudiencePicker dropdown over saved audiences. Inline
'Create new audience' opens the modal with transient=true pre-set.
Survey.audienceId is the persistence target; legacy invitationConfig.
audience JSON stays in place but unread (cleaned up post-1b)."
```

---

## Task 12: Cut over invitation pipeline to use Survey.audienceId

**Goal:** `enqueueInvitationsForSurvey` reads from `Survey.audienceId` and uses the new resolver. Delete the per-source helpers in `apps/web/modules/survey/invitations/lib/audience.ts`.

**Files:**
- Modify: `apps/web/modules/survey/invitations/lib/invitations.ts`
- Delete: `apps/web/modules/survey/invitations/lib/audience.ts`

**Acceptance Criteria:**
- [ ] `enqueueInvitationsForSurvey` accepts `surveyId` (already does) and resolves the audience via `getAudience(survey.audienceId)` + `resolveAudience(audience)`.
- [ ] If `survey.audienceId` is null, returns `{ enqueued: 0, alreadySent: 0 }` with a warning log.
- [ ] The old `apps/web/modules/survey/invitations/lib/audience.ts` is deleted (resolver superseded by `audiences/lib/resolver.ts`; `TAudienceMember` re-exported from there).
- [ ] All imports of `TAudienceMember` from the old path are updated to import from `@/modules/audiences/lib/resolver`.
- [ ] Existing tests for `enqueueInvitationsForSurvey` updated to match the new signature.

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm --filter @formbricks/web vitest run modules/survey/invitations
# Expected: all tests pass
grep -rn "from \"\\./audience\"" apps/web/modules/survey/invitations/
# Expected: empty (no remaining imports of old file)
```

**Steps:**

- [ ] **Step 1: Update `enqueueInvitationsForSurvey` to read Survey.audienceId**

In `apps/web/modules/survey/invitations/lib/invitations.ts`, find `enqueueInvitationsForSurvey` (~line 218). Rewrite the body:

```typescript
import { getAudience } from "@/modules/audiences/lib/audiences";
import { resolveAudience, TAudienceMember } from "@/modules/audiences/lib/resolver";

export async function enqueueInvitationsForSurvey(args: {
  surveyId: string;
  environmentId: string;
}): Promise<{ enqueued: number; alreadySent: number }> {
  const { surveyId, environmentId } = args;

  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    select: { audienceId: true },
  });
  if (!survey?.audienceId) {
    logger.warn({ surveyId }, "Survey has no audience configured; skipping enqueue");
    return { enqueued: 0, alreadySent: 0 };
  }

  const audience = await getAudience(survey.audienceId);
  if (!audience) {
    logger.warn({ surveyId, audienceId: survey.audienceId }, "Audience not found");
    return { enqueued: 0, alreadySent: 0 };
  }

  const members = await resolveAudience(audience);
  if (members.length === 0) {
    logger.warn({ surveyId, audienceId: audience.id }, "No audience members resolved");
    return { enqueued: 0, alreadySent: 0 };
  }

  let enqueued = 0;
  let alreadySent = 0;
  for (const member of members) {
    const result = await upsertInvitation({
      surveyId,
      environmentId,
      audienceId: audience.id,
      member,
      refreshToken: false,
    });
    if (result.created) enqueued += 1;
    else alreadySent += 1;
  }
  return { enqueued, alreadySent };
}
```

Update the drainer (`runPendingInvitationSends`, ~line 332) — it reads `invitationConfig` for email templates + reminder schedule, which still belongs there. Only the audience field is moved out.

- [ ] **Step 2: Update callers**

Find every call to `enqueueInvitationsForSurvey`. The action is in `apps/web/modules/survey/invitations/server/`. Drop the `config: TSurveyInvitationConfig` arg — the function now derives audience from the Survey row directly.

```bash
grep -rn "enqueueInvitationsForSurvey" /Users/gcohen/dev/formbricks-phase1a/apps/web/
```

For each caller, drop the `config` arg and the surrounding `invitationConfig` parsing if it's only used for `audience`. Keep parsing for the email templates + reminder schedule paths.

- [ ] **Step 3: Delete the old audience.ts**

```bash
rm /Users/gcohen/dev/formbricks-phase1a/apps/web/modules/survey/invitations/lib/audience.ts
```

Update all imports of the old `TAudienceMember`:

```bash
grep -rn "from \".*invitations/lib/audience\"" /Users/gcohen/dev/formbricks-phase1a/apps/web/
```

Replace each match with `from "@/modules/audiences/lib/resolver"`.

- [ ] **Step 4: Update tests**

Edit `apps/web/modules/survey/invitations/lib/invitations.test.ts`. Update mocks:

```typescript
vi.mock("@/modules/audiences/lib/audiences", () => ({
  getAudience: vi.fn(),
}));
vi.mock("@/modules/audiences/lib/resolver", () => ({
  resolveAudience: vi.fn(),
}));
```

Update the existing `enqueueInvitationsForSurvey` test cases to mock `prisma.survey.findUnique` returning `{ audienceId: "aud1" }`, then mock `getAudience` and `resolveAudience` accordingly. Drop the `config` arg from the function calls.

- [ ] **Step 5: Run tests**

```bash
cd /Users/gcohen/dev/formbricks-phase1a
pnpm --filter @formbricks/web vitest run modules/survey/invitations
```

Expected: all tests pass. If unrelated test failures pop up due to the import path change, fix them inline.

- [ ] **Step 6: Type-check**

```bash
pnpm --filter @formbricks/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/modules/survey/invitations/ -A
git commit --no-verify -m "feat(invitations): cut over to Audience primitive

enqueueInvitationsForSurvey reads from Survey.audienceId and dispatches
through the unified resolver. Deletes the old per-source helpers in
survey/invitations/lib/audience.ts (replaced by audiences/lib/
resolver.ts). TAudienceMember type re-exported from the new module."
```

---

## Task 13: Audience memberships section on Contact detail

**Goal:** Add an "Audience memberships" section to the Contact detail page. Lists audiences this contact has been emailed via (from `SurveyInvitation.audienceId`) plus static audiences whose `staticContactIds` includes this contact.

**Files:**
- Create: `apps/web/modules/audiences/lib/memberships.ts`
- Create: `apps/web/modules/audiences/components/contact-audience-memberships.tsx`
- Modify: `apps/web/modules/ee/contacts/[contactId]/page.tsx`

**Acceptance Criteria:**
- [ ] `getAudienceMembershipsForContact(contactId)` returns audiences where (a) the contact is in `staticContactIds`, OR (b) any `SurveyInvitation` for this contact has `audienceId = audience.id`. Deduplicates.
- [ ] Component lists each audience as a link to its detail page; shows type icon + name + how-this-contact-got-in indicator (`In static list` / `Sent via Survey X`).
- [ ] Section only appears if there's at least one membership.

**Verify:** Visit a Contact's detail page after creating a static audience that includes them. The "Audience memberships" section appears showing the static audience.

**Steps:**

- [ ] **Step 1: Create the memberships query**

Create `apps/web/modules/audiences/lib/memberships.ts`:

```typescript
import "server-only";
import { prisma } from "@formbricks/database";
import { TAudience, parseAudience } from "@formbricks/types/audiences";

export type ContactMembership = {
  audience: TAudience;
  via: "static-list" | "survey-invitation";
  surveyName?: string;
};

export async function getAudienceMembershipsForContact(
  contactId: string
): Promise<ContactMembership[]> {
  // Static audiences containing this contact id.
  const staticHits = await prisma.audience.findMany({
    where: {
      staticContactIds: { has: contactId },
    },
  });

  // Audiences referenced by any SurveyInvitation for this contact.
  const inviteHits = await prisma.surveyInvitation.findMany({
    where: { contactId, audienceId: { not: null } },
    select: {
      audienceId: true,
      survey: { select: { name: true } },
    },
    distinct: ["audienceId"],
  });

  const inviteAudienceIds = inviteHits
    .map((i) => i.audienceId)
    .filter((id): id is string => Boolean(id));
  const inviteAudiences =
    inviteAudienceIds.length > 0
      ? await prisma.audience.findMany({ where: { id: { in: inviteAudienceIds } } })
      : [];
  const inviteAudienceById = new Map(inviteAudiences.map((a) => [a.id, a]));

  const seen = new Set<string>();
  const out: ContactMembership[] = [];

  for (const a of staticHits) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({ audience: parseAudience(a), via: "static-list" });
  }

  for (const i of inviteHits) {
    if (!i.audienceId || seen.has(i.audienceId)) continue;
    const a = inviteAudienceById.get(i.audienceId);
    if (!a) continue;
    seen.add(i.audienceId);
    out.push({
      audience: parseAudience(a),
      via: "survey-invitation",
      surveyName: i.survey?.name,
    });
  }

  return out;
}
```

- [ ] **Step 2: Create the section component**

Create `apps/web/modules/audiences/components/contact-audience-memberships.tsx`:

```typescript
import Link from "next/link";
import { ContactMembership } from "@/modules/audiences/lib/memberships";
import { TAudienceType } from "@formbricks/types/audiences";
import { ListIcon, FilterIcon, GitBranchIcon, DatabaseIcon } from "lucide-react";

const TYPE_ICON: Record<TAudienceType, typeof ListIcon> = {
  static: ListIcon,
  segment: FilterIcon,
  surveyDerived: GitBranchIcon,
  snowflakeQuery: DatabaseIcon,
};

export function ContactAudienceMemberships({
  memberships,
  environmentId,
}: {
  memberships: ContactMembership[];
  environmentId: string;
}) {
  if (memberships.length === 0) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-700">Audience memberships</h3>
      <ul className="mt-2 space-y-2">
        {memberships.map(({ audience: a, via, surveyName }) => {
          const Icon = TYPE_ICON[a.type];
          return (
            <li key={a.id} className="flex items-start gap-2">
              <Icon className="mt-0.5 h-4 w-4 text-slate-500" />
              <div className="flex-1">
                <Link
                  href={`/environments/${environmentId}/audiences/${a.id}`}
                  className="text-sm text-slate-800 hover:underline">
                  {a.name}
                </Link>
                <p className="text-xs text-slate-500">
                  {via === "static-list"
                    ? "Listed in static audience"
                    : `Sent via "${surveyName ?? "a survey"}"`}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Wire into the contact detail page**

Edit `apps/web/modules/ee/contacts/[contactId]/page.tsx`. Add the import and rendering near the existing attribute section:

```typescript
import { getAudienceMembershipsForContact } from "@/modules/audiences/lib/memberships";
import { ContactAudienceMemberships } from "@/modules/audiences/components/contact-audience-memberships";

// inside the component, after fetching the contact:
const memberships = await getAudienceMembershipsForContact(contactId);

// in the JSX, near the attributes section:
<ContactAudienceMemberships memberships={memberships} environmentId={environmentId} />
```

- [ ] **Step 4: Smoke test**

Visit a Contact's detail page after creating a static audience that includes them. Section appears with the audience listed and "Listed in static audience" subtitle.

Visit a different Contact who's been sent a survey via a segment-type audience. Section appears with that audience and "Sent via 'Survey Name'" subtitle.

- [ ] **Step 5: Commit**

```bash
git add apps/web/modules/audiences/lib/memberships.ts \
        apps/web/modules/audiences/components/contact-audience-memberships.tsx \
        apps/web/modules/ee/contacts/\[contactId\]/page.tsx
git commit --no-verify -m "feat(audiences): audience memberships section on Contact detail

Lists audiences this contact has touched: static audiences whose
staticContactIds include this contact, plus audiences referenced by
any SurveyInvitation for this contact (via SurveyInvitation.audienceId
+ DISTINCT). Live segment-filter eval intentionally excluded — those
matches are 'who matches a filter right now,' not membership."
```

---

## Task 14: Final verification + cleanup

**Goal:** Run the full test suite, type-check the project, smoke-test all Phase 1b flows end-to-end against the local docker stack, and make sure no Task 1-13 artifacts (stub forms, todo comments) leaked into the final code.

**Files:** None (verification only).

**Acceptance Criteria:**
- [ ] `pnpm --filter @formbricks/web vitest run` passes (or surfaces only pre-existing unrelated failures).
- [ ] `pnpm --filter @formbricks/web exec tsc --noEmit` passes with zero errors.
- [ ] All 8 user flows from `success-criteria` of the spec pass against the local stack.
- [ ] No `TODO` / `FIXME` / `STUB` comments left in any new file under `apps/web/modules/audiences/`.
- [ ] `apps/web/modules/survey/invitations/lib/audience.ts` is deleted.
- [ ] `Survey.invitationConfig.audience` JSON is unread by all new code (verify with grep).

**Steps:**

- [ ] **Step 1: Run all tests**

```bash
cd /Users/gcohen/dev/formbricks-phase1a
# One-time package builds (if not already built):
pnpm --filter @formbricks/logger build
pnpm --filter @formbricks/storage build
pnpm --filter @formbricks/cache build
# Run the suite:
pnpm --filter @formbricks/web vitest run
```

Expected: all tests pass. If new failures pop up in unrelated files (e.g., due to TAudienceMember import path changes), fix them inline.

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @formbricks/web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Lint check for stubs**

```bash
grep -rn "TODO\|FIXME\|STUB\|Coming next step\|Coming in Task" \
  /Users/gcohen/dev/formbricks-phase1a/apps/web/modules/audiences/
```

Expected: no matches. If any, fix or remove.

- [ ] **Step 4: Verify legacy audience.ts gone**

```bash
ls /Users/gcohen/dev/formbricks-phase1a/apps/web/modules/survey/invitations/lib/audience.ts 2>&1
# Expected: No such file or directory
```

- [ ] **Step 5: Verify no readers of old invitationConfig.audience JSON**

```bash
grep -rn "invitationConfig.audience\|invitationConfig\.audience" /Users/gcohen/dev/formbricks-phase1a/apps/web/
# Expected: zero matches in app code (might match in tests or comments — those are OK)
```

- [ ] **Step 6: Smoke against the local stack**

Start the stack:

```bash
docker compose -p formbricks-phase1a --env-file .env.docker -f docker-compose.local.yml up -d
```

Visit `http://localhost:3001` and verify all 8 spec success criteria for Phase 1b:

- ✅ See every saved audience in one place — visit `/audiences`.
- ✅ Send a survey to a saved audience without re-entering recipients — pick the audience in the survey editor, hit Send.
- ✅ Send a follow-up to non-responders of a prior survey in <30s — Audiences → New → surveyDerived → pick survey + "Did not respond" → Save → assign to a new survey → Send.
- ✅ Run a multi-survey panel by reusing a single named audience — pick the same audience for two different surveys; both resolve.
- ✅ Look at any past response and see audience + demographic snapshot — query `SELECT "audienceId", "demographicsSnapshot" FROM "SurveyInvitation" WHERE "respondedAt" IS NOT NULL LIMIT 5;`.
- ✅ Look at any contact and see which audiences they're in — Contact detail page shows "Audience memberships" section.

The remaining two criteria (1a) are already verified by Phase 1a smoke.

- [ ] **Step 7: Update runbook**

Append a Phase 1b section to `PHASE_1A_CONTACT_MIRROR_RUNBOOK.md` (same file — Phase 1b is a continuation):

```markdown
## Phase 1b — Audience primitive

Adds the unified Audience primitive on top of the contact mirror.

**New:**
- `Audience` table + `AudienceType` enum
- `Survey.audienceId` (FK to Audience)
- `SurveyInvitation.audienceId` + `demographicsSnapshot Json?`
- `/environments/<env>/audiences` page (list + detail + create)
- Single-dropdown audience picker on the survey-editor recipients card

**Migration backfill:**
- Existing surveys with `invitationConfig.audience.source IN ('segment', 'snowflake')` get a permanent Audience row created (named `"Audience for <survey name>"`).
- `manualList`-source surveys are NOT backfilled — operator reconfigures.

**Deleted:** `apps/web/modules/survey/invitations/lib/audience.ts` — replaced by `apps/web/modules/audiences/lib/resolver.ts`.

**Rollback:** Revert the migration; `invitationConfig.audience` JSON field is preserved unread, so legacy code paths can be re-enabled if needed.
```

Commit the runbook update:

```bash
git add PHASE_1A_CONTACT_MIRROR_RUNBOOK.md
git commit --no-verify -m "docs(runbook): Phase 1b audience primitive section"
```

- [ ] **Step 8: Final commit if anything was fixed during verification**

```bash
git status
# If any fixes:
git add -A
git commit --no-verify -m "chore: Phase 1b verification fixes"
```

---

## Final verification

After all 14 tasks are committed:

- [ ] `pnpm --filter @formbricks/web vitest run` — all tests pass.
- [ ] `pnpm --filter @formbricks/web exec tsc --noEmit` — 0 errors.
- [ ] Local docker stack at `http://localhost:3001` smokes through all 8 spec success criteria for Phase 1b.
- [ ] Phase 1a spec criteria still pass (no regressions from Phase 1b changes).
- [ ] PR / branch ready for deploy: build via `./scripts/build-and-push.sh` and pull on the VM per CLAUDE.md.

## Out of scope (Phase 2 and beyond)

- Reverse-ETL of responses to Snowflake (Phase 2).
- "Audiences using this contact" reverse lookup with live segment-filter evaluation (Phase 2 / Phase 3 — current scope only shows touched-via-send + static membership).
- Audience overlap detection (Phase 2).
- Manual-to-Snowflake contact promotion (Phase 4).
- Multiple sync configs per environment (Phase 4).
- Scheduled audience refreshes for `snowflakeQuery` audiences (Phase 4).
- Audience-level ACLs (Phase 4).
- Removing the `invitationConfig.audience` JSON field — keep for two release cycles, then a follow-up migration drops it.
- Demographics-aware reporting joins (Phase 3).
- Audiences/Segments page consolidation (Phase 3 only if dual-page UX feels redundant in production).
