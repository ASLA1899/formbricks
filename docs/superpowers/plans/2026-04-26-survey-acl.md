# Per-Survey Access Control (ASLA Non-EE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-survey access control to ASLA's non-EE Formbricks deployment so members no longer automatically see every survey, without disrupting live surveys, response submission, integrations, or the EE upgrade path.

**Architecture:** Three additive Prisma schema changes — `Membership.surveyAdmin`, `Survey.visibility` enum, new `SurveyAccess` join table. A single `canAccessSurvey` helper enforces access at three narrow surfaces: the survey list query, server actions in `survey/list/actions.ts`, and admin page server-component guards. Anonymous respondent paths (`/s/...`, `/api/v1/client/...`), the system pipeline (`/api/(internal)/pipeline/...`), webhooks, integrations, and API-key-authenticated `/api/v1/management` and `/api/v2/management` routes are intentionally NOT subject to the ACL — they continue to work exactly as today. Existing surveys are grandfathered to `visibility = public`; new surveys default to `private`. Only `gcohen@asla.org` is granted `surveyAdmin = true` at migration time.

**Tech Stack:** Next.js 14 (App Router), Prisma + PostgreSQL, NextAuth, TypeScript, Vitest, server actions / server components.

---

## Context (read first if you don't have history)

This is the third commit in a chain of changes to ASLA's fork of Formbricks (`github.com/ASLA1899/formbricks`):

1. `299f6f52a` — added non-EE Microsoft 365 SSO login.
2. `14ac8ce0e` — hardened that SSO + added `AZURE_SSO_SETUP.md`.
3. **This plan** — adds per-survey ACL.

The deployment is single-tenant ASLA-only at `https://surveys.asla.org`. There is no Enterprise license. Without EE:
- Formbricks defaults invited users to `OrganizationRole.owner` (`apps/web/modules/organization/settings/teams/components/invite-member/individual-invite-tab.tsx:59`), so practically every ASLA user has `owner` today.
- The existing survey access check in `apps/web/modules/survey/list/actions.ts` is `roles in (owner, manager) || projectTeam(read+)`, but `projectTeam` is the EE feature flag so the only practical access path is "you're an owner" — meaning everyone has full survey visibility today.

**Decisions already made (don't re-litigate):**
- New ACL is on the `Membership` row, not the org role. Org role (`owner`/`manager`/`member`/`billing`) keeps controlling org settings, billing, member management. The new `Membership.surveyAdmin Boolean` is a separate axis that controls survey visibility only.
- New surveys default to `visibility: private` (creator + surveyAdmins + explicit access list).
- Existing surveys are migrated to `visibility: public` (org-wide visible) so nothing disappears day one.
- Only `gcohen@asla.org` gets `surveyAdmin: true` in the data migration. All others stay `false`.
- One bit of share-state per (survey, user) — if you can see a survey, you can edit it and view responses. No view/edit tier split.
- API tokens (v1/v2 management) keep their environment-level access. The new ACL does not apply to them. They are service credentials, not user identities.

**License boundary (don't touch this):** All new code goes in the AGPL portion (`apps/web/lib/...`, `apps/web/modules/auth/...`, `apps/web/modules/survey/...`, `packages/database/...`). Do NOT import from `@/modules/ee/...`. Re-implementing functionality similar to the EE `getProjectPermissionByUserId` / `accessControl` feature is fine — patterns aren't copyrightable, only EE expression is.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/database/schema.prisma` | modify | Add enum, fields, model |
| `scripts/2026-04-26-survey-acl-migration.sql` | create | One-shot data migration with pre-flight checks |
| `apps/web/lib/survey/access.ts` | create | `canAccessSurvey`, `getSurveyAccessWhere` helpers |
| `apps/web/lib/survey/access.test.ts` | create | Unit tests for the helpers |
| `apps/web/modules/survey/list/lib/survey.ts` | modify | Apply ACL filter to `getSurveys`, `getSurveysSortedByRelevance`, `getSurveyCount` |
| `apps/web/modules/survey/list/lib/survey.test.ts` | modify | Cover ACL filter behavior |
| `apps/web/modules/survey/list/actions.ts` | modify | Gate `getSurveyAction`, `getFullSurveyAction`, `copySurveyToOtherEnvironmentAction`, `deleteSurveyAction`, etc., with `canAccessSurvey` |
| `apps/web/app/(app)/environments/[environmentId]/surveys/[surveyId]/layout.tsx` | modify | 403 redirect when ACL denies |
| `apps/web/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/layout.tsx` | modify | Same |
| `apps/web/modules/survey/sharing/components/sharing-panel.tsx` | create | Visibility toggle + user multi-select UI |
| `apps/web/modules/survey/sharing/actions.ts` | create | Server actions: setVisibility, addAccess, removeAccess |
| `apps/web/modules/survey/sharing/lib/survey-access.ts` | create | DB helpers for SurveyAccess CRUD |
| `apps/web/modules/survey/editor/...` | modify | Mount `<SharingPanel>` in survey settings |
| `apps/web/modules/organization/settings/teams/components/edit-memberships/edit-memberships.tsx` | modify | Add `surveyAdmin` toggle column |
| `apps/web/modules/organization/settings/teams/actions.ts` | modify | Server action: `setSurveyAdminAction` |
| `AZURE_SSO_SETUP.md` or new `SURVEY_ACL_RUNBOOK.md` | create/modify | Production rollout runbook |

**Why this split:** Each file has a single responsibility. The `lib/survey/access.ts` helper is the canonical authority — every gate calls into it. The sharing panel + actions live together under `modules/survey/sharing/` so the feature is self-contained. The migration script is a one-shot artifact, kept under `scripts/` (already a project convention per the working tree).

---

## Task 0: Schema Additions

**Goal:** Add the three Prisma schema changes — `SurveyVisibility` enum, `Survey.visibility` field, `SurveyAccess` model, `Membership.surveyAdmin` field — and regenerate the Prisma client.

**Files:**
- Modify: `packages/database/schema.prisma`
- Run: `pnpm --filter @formbricks/database db:generate` (or equivalent)

**Acceptance Criteria:**
- [ ] `SurveyVisibility` enum exists with values `private`, `public`
- [ ] `Survey.visibility` is `SurveyVisibility @default(private)`
- [ ] `Survey.surveyAccess SurveyAccess[]` relation exists
- [ ] `SurveyAccess` model exists with composite PK `(surveyId, userId)`, `@@index([userId])`, cascade deletes from Survey and User
- [ ] `Membership.surveyAdmin Boolean @default(false)` exists
- [ ] `pnpm --filter @formbricks/database db:generate` succeeds
- [ ] TypeScript compiles in `apps/web`: `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json` returns 0 errors
- [ ] On a local dev DB, `pnpm --filter @formbricks/database db:push` applies the schema cleanly

**Verify:**
```bash
cd /Users/gcohen/dev/formbricks
grep -A 1 "^enum SurveyVisibility" packages/database/schema.prisma  # shows enum
grep "surveyAdmin" packages/database/schema.prisma                   # shows field
grep "^model SurveyAccess" packages/database/schema.prisma           # shows model
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | tail -5
```
Expected: enum / field / model all present, tsc returns no errors related to the new types.

**Steps:**

- [ ] **Step 1: Locate insertion points in `packages/database/schema.prisma`**

Find:
- `model Survey {` (around line 280; exact line may drift)
- `model Membership {` (search for it)
- The cluster of enum definitions

- [ ] **Step 2: Add the enum**

Insert near the other enums (e.g., alongside `SurveyType`, `SurveyStatus`):

```prisma
enum SurveyVisibility {
  private
  public
}
```

- [ ] **Step 3: Add fields to `Survey`**

Inside `model Survey { ... }`, add:

```prisma
  visibility   SurveyVisibility @default(private)
  surveyAccess SurveyAccess[]
```

Place after `status` for readability.

- [ ] **Step 4: Add the `SurveyAccess` model**

Insert after `model Survey`:

```prisma
/// Per-user access to a private survey. Bypassed for users with
/// Membership.surveyAdmin=true and for the survey creator. Ignored when
/// Survey.visibility = public.
model SurveyAccess {
  surveyId  String
  userId    String
  createdAt DateTime @default(now()) @map(name: "created_at")
  survey    Survey   @relation(fields: [surveyId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([surveyId, userId])
  @@index([userId])
}
```

- [ ] **Step 5: Add the back-relation on `User`**

Inside `model User { ... }`, find the section that lists relations (look for `accounts`, `memberships`, `responses`...). Add:

```prisma
  surveyAccess  SurveyAccess[]
```

- [ ] **Step 6: Add `surveyAdmin` to `Membership`**

Inside `model Membership { ... }`, after `role`:

```prisma
  surveyAdmin    Boolean          @default(false)
```

- [ ] **Step 7: Generate Prisma client**

```bash
cd /Users/gcohen/dev/formbricks
pnpm --filter @formbricks/database db:generate
```

Expected: success message, no errors. If the script name differs in this repo, check `packages/database/package.json` `"scripts"` and use the actual name.

- [ ] **Step 8: Push schema to local dev DB (DO NOT run in production)**

```bash
pnpm --filter @formbricks/database db:push
```

This is for local validation only. Production gets the changes via the migration script in Task 1 + a separate deploy step in Task 8.

- [ ] **Step 9: Verify TypeScript still compiles**

```bash
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | tail -10
```

Expected: zero errors mentioning `SurveyVisibility`, `SurveyAccess`, `surveyAdmin`. If existing files have unrelated errors that's fine — only the new types matter here.

- [ ] **Step 10: Commit**

```bash
git add packages/database/schema.prisma
git commit -m "feat(survey-acl): add schema for per-survey access control

- New enum SurveyVisibility (private | public)
- Survey.visibility (default: private)
- SurveyAccess join table for explicit per-user access on private surveys
- Membership.surveyAdmin flag — bypasses ACL for survey visibility only
  (independent of OrganizationRole)

Schema is additive — defaults preserve current behavior until the data
migration in scripts/2026-04-26-survey-acl-migration.sql runs."
```

---

## Task 1: Data Migration Script

**Goal:** Write a one-shot, idempotent SQL migration that grants `surveyAdmin: true` to `gcohen@asla.org` and grandfathers all existing surveys to `visibility: public`. Aborts with a clear error if the target user doesn't exist. Logs counts before and after.

**Files:**
- Create: `scripts/2026-04-26-survey-acl-migration.sql`
- (Optionally) Create: `scripts/README.md` if no scripts/README exists

**Acceptance Criteria:**
- [ ] Script aborts with a clear error message if `gcohen@asla.org` is not present in `users`
- [ ] Script reports the user ID it found and the number of memberships it'll update
- [ ] Sets `surveyAdmin = true` on every membership row whose `userId = gcohen.id`
- [ ] Sets `visibility = 'public'` on every existing survey (`createdAt < NOW()`)
- [ ] Logs final counts: surveys grandfathered, memberships granted
- [ ] Re-running the script is a no-op (idempotent)
- [ ] Wrapped in a single `BEGIN; ... COMMIT;` transaction

**Verify:** Local dev DB after Task 0's `db:push`, plus a manually-inserted test user `gcohen@asla.org`. Run the script and inspect:
```bash
psql $DATABASE_URL -f scripts/2026-04-26-survey-acl-migration.sql
psql $DATABASE_URL -c "SELECT email, m.\"surveyAdmin\" FROM users u JOIN memberships m ON m.\"userId\"=u.id WHERE u.email = 'gcohen@asla.org';"
```
Expected: surveyAdmin = true on all memberships for gcohen.

**Steps:**

- [ ] **Step 1: Write the migration**

```sql
-- 2026-04-26-survey-acl-migration.sql
-- One-shot migration to bootstrap the per-survey ACL feature for ASLA.
-- Idempotent. Wrap entire run in a transaction.
--
-- Pre-conditions:
--   * Schema migration applied (Task 0): Membership.surveyAdmin and
--     Survey.visibility columns exist.
--   * gcohen@asla.org has a users row.

BEGIN;

DO $$
DECLARE
  v_user_id     TEXT;
  v_member_cnt  INT;
  v_survey_cnt  INT;
BEGIN
  -- Pre-flight: locate the survey-admin user
  SELECT id INTO v_user_id FROM users WHERE email = 'gcohen@asla.org';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'survey-acl migration aborted: gcohen@asla.org not found in users';
  END IF;

  RAISE NOTICE 'Found survey-admin user: % (id=%)', 'gcohen@asla.org', v_user_id;

  -- Grant survey-admin on all of this user's memberships
  UPDATE memberships
  SET "surveyAdmin" = true
  WHERE "userId" = v_user_id
    AND "surveyAdmin" = false;
  GET DIAGNOSTICS v_member_cnt = ROW_COUNT;
  RAISE NOTICE '% memberships updated to surveyAdmin=true', v_member_cnt;

  -- Grandfather: every existing survey becomes public so nothing disappears
  UPDATE surveys
  SET visibility = 'public'
  WHERE visibility = 'private'
    AND "createdAt" < NOW();
  GET DIAGNOSTICS v_survey_cnt = ROW_COUNT;
  RAISE NOTICE '% existing surveys set to visibility=public (grandfather)', v_survey_cnt;

END $$;

COMMIT;

-- After this point:
--   - gcohen sees every survey via the surveyAdmin bypass.
--   - All other users continue to see every existing survey via visibility=public.
--   - New surveys created post-deploy default to visibility=private and are
--     visible only to creator + surveyAdmin users + SurveyAccess rows.
```

- [ ] **Step 2: Smoke test against a local dev DB**

```bash
# Set up a test user if needed
psql "$DATABASE_URL" -c "SELECT id, email FROM users WHERE email='gcohen@asla.org';"

# If the user doesn't exist locally, create one for testing only
# (skip this in production):
# psql "$DATABASE_URL" -c "INSERT INTO users (id, email, name, ...) VALUES (...);"

# Run the migration
psql "$DATABASE_URL" -f scripts/2026-04-26-survey-acl-migration.sql

# Inspect results
psql "$DATABASE_URL" -c "SELECT u.email, m.\"surveyAdmin\" FROM memberships m JOIN users u ON u.id=m.\"userId\" WHERE m.\"surveyAdmin\";"
psql "$DATABASE_URL" -c "SELECT visibility, count(*) FROM surveys GROUP BY visibility;"
```

Expected: gcohen rows show surveyAdmin=true; existing surveys all show visibility=public.

- [ ] **Step 3: Verify idempotency**

```bash
psql "$DATABASE_URL" -f scripts/2026-04-26-survey-acl-migration.sql
```

Expected: NOTICE messages report `0 memberships updated` and `0 surveys` — re-running is a no-op.

- [ ] **Step 4: Verify pre-flight check fires**

Temporarily rename a copy of the user's email and run:

```bash
psql "$DATABASE_URL" -c "UPDATE users SET email='gcohen-temp@asla.org' WHERE email='gcohen@asla.org';"
psql "$DATABASE_URL" -f scripts/2026-04-26-survey-acl-migration.sql || echo "Aborted as expected"
psql "$DATABASE_URL" -c "UPDATE users SET email='gcohen@asla.org' WHERE email='gcohen-temp@asla.org';"
```

Expected: `ERROR: survey-acl migration aborted: gcohen@asla.org not found in users`.

- [ ] **Step 5: Commit**

```bash
git add scripts/2026-04-26-survey-acl-migration.sql
git commit -m "feat(survey-acl): add one-shot data migration script

Grants Membership.surveyAdmin=true to gcohen@asla.org and grandfathers
all existing surveys to visibility=public so nothing disappears on
deploy. Idempotent; aborts cleanly if the target user is missing."
```

---

## Task 2: Access Check Helper + Tests (TDD)

**Goal:** Implement `canAccessSurvey` and `getSurveyAccessWhere` in `apps/web/lib/survey/access.ts` with comprehensive unit tests.

**Files:**
- Create: `apps/web/lib/survey/access.ts`
- Create: `apps/web/lib/survey/access.test.ts`

**Acceptance Criteria:**
- [ ] `canAccessSurvey({ userId, survey, membership })` returns boolean according to the rules below
- [ ] `getSurveyAccessWhere({ userId, membership })` returns a Prisma `Survey` `where` fragment that filters list queries to accessible surveys
- [ ] All test cases pass: surveyAdmin bypass, creator bypass, public bypass, private+access, private+no-access, no-membership
- [ ] Tests are pure-function (no DB) — both helpers receive their inputs and return synchronously (apart from where Prisma takes over for the where-clause case)

**Verify:** `cd apps/web && pnpm exec vitest run lib/survey/access.test.ts`. Expected: all tests pass.

**Decision rules (canonical):**

```
canAccessSurvey({ userId, survey, membership }):
  if !membership                         → false  // not in the org
  if membership.surveyAdmin              → true   // bypass
  if survey.visibility === "public"      → true
  if survey.createdBy === userId         → true   // creator
  return SurveyAccess.exists(survey.id, userId)
```

`getSurveyAccessWhere` returns the OR-of-conditions Prisma where fragment — used inside `prisma.survey.findMany({ where: { environmentId, AND: [..., getSurveyAccessWhere({...})] } })`.

**Steps:**

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/survey/access.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { canAccessSurvey } from "./access";

const baseSurvey = {
  id: "s1",
  visibility: "private" as const,
  createdBy: "creator-id",
  surveyAccess: [] as Array<{ userId: string }>,
};

const baseMembership = {
  userId: "u1",
  organizationId: "org-1",
  role: "member" as const,
  surveyAdmin: false,
  accepted: true,
};

describe("canAccessSurvey", () => {
  test("returns false when user has no membership", () => {
    expect(canAccessSurvey({ userId: "u1", survey: baseSurvey, membership: null })).toBe(false);
  });

  test("returns true when membership.surveyAdmin is true (bypass)", () => {
    expect(
      canAccessSurvey({
        userId: "u1",
        survey: baseSurvey,
        membership: { ...baseMembership, surveyAdmin: true },
      })
    ).toBe(true);
  });

  test("returns true when survey is public", () => {
    expect(
      canAccessSurvey({
        userId: "u1",
        survey: { ...baseSurvey, visibility: "public" },
        membership: baseMembership,
      })
    ).toBe(true);
  });

  test("returns true when user is the creator", () => {
    expect(
      canAccessSurvey({
        userId: "creator-id",
        survey: baseSurvey,
        membership: { ...baseMembership, userId: "creator-id" },
      })
    ).toBe(true);
  });

  test("returns true when SurveyAccess row exists for the user", () => {
    expect(
      canAccessSurvey({
        userId: "u1",
        survey: { ...baseSurvey, surveyAccess: [{ userId: "u1" }] },
        membership: baseMembership,
      })
    ).toBe(true);
  });

  test("returns false for a private survey when user is not creator/admin/listed", () => {
    expect(
      canAccessSurvey({
        userId: "u1",
        survey: baseSurvey,
        membership: baseMembership,
      })
    ).toBe(false);
  });

  test("ignores other users' SurveyAccess rows", () => {
    expect(
      canAccessSurvey({
        userId: "u1",
        survey: { ...baseSurvey, surveyAccess: [{ userId: "u2" }] },
        membership: baseMembership,
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — they should fail (file not found)**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm exec vitest run lib/survey/access.test.ts 2>&1 | tail -10
```

Expected: failure indicating `./access` module not found.

- [ ] **Step 3: Implement `canAccessSurvey`**

`apps/web/lib/survey/access.ts`:

```ts
import "server-only";
import type { Membership, Prisma } from "@prisma/client";

export type SurveyAccessSurvey = {
  id: string;
  visibility: "private" | "public";
  createdBy: string | null;
  surveyAccess: { userId: string }[];
};

export type SurveyAccessMembership = Pick<Membership, "userId" | "surveyAdmin"> | null;

/** Pure, synchronous access predicate. Caller is responsible for fetching
 * the survey with `surveyAccess` included and the user's org membership. */
export const canAccessSurvey = ({
  userId,
  survey,
  membership,
}: {
  userId: string;
  survey: SurveyAccessSurvey;
  membership: SurveyAccessMembership;
}): boolean => {
  if (!membership) return false;
  if (membership.surveyAdmin) return true;
  if (survey.visibility === "public") return true;
  if (survey.createdBy === userId) return true;
  return survey.surveyAccess.some((row) => row.userId === userId);
};

/** Prisma `where` fragment that selects only surveys the given user can see.
 * Use as `where: { environmentId, AND: [filters, getSurveyAccessWhere(...)] }`.
 * Returns an empty object (i.e. no filter) when the user has surveyAdmin. */
export const getSurveyAccessWhere = ({
  userId,
  membership,
}: {
  userId: string;
  membership: SurveyAccessMembership;
}): Prisma.SurveyWhereInput => {
  if (!membership) {
    // No membership = no access. An impossible Prisma where clause.
    return { id: "__no_access__" };
  }
  if (membership.surveyAdmin) {
    return {};
  }
  return {
    OR: [
      { visibility: "public" },
      { createdBy: userId },
      { surveyAccess: { some: { userId } } },
    ],
  };
};
```

- [ ] **Step 4: Run tests — should pass**

```bash
pnpm exec vitest run lib/survey/access.test.ts 2>&1 | tail -15
```

Expected: all 7 tests pass.

- [ ] **Step 5: Add a where-clause sanity test**

Add to `access.test.ts`:

```ts
import { getSurveyAccessWhere } from "./access";

describe("getSurveyAccessWhere", () => {
  test("returns impossible filter for no membership", () => {
    const where = getSurveyAccessWhere({ userId: "u1", membership: null });
    expect(where).toEqual({ id: "__no_access__" });
  });

  test("returns empty (no filter) for surveyAdmin", () => {
    const where = getSurveyAccessWhere({
      userId: "u1",
      membership: { userId: "u1", surveyAdmin: true } as any,
    });
    expect(where).toEqual({});
  });

  test("returns OR(public, creator, access list) for normal user", () => {
    const where = getSurveyAccessWhere({
      userId: "u1",
      membership: { userId: "u1", surveyAdmin: false } as any,
    });
    expect(where).toEqual({
      OR: [
        { visibility: "public" },
        { createdBy: "u1" },
        { surveyAccess: { some: { userId: "u1" } } },
      ],
    });
  });
});
```

Run again:

```bash
pnpm exec vitest run lib/survey/access.test.ts 2>&1 | tail -15
```

Expected: 10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/survey/access.ts apps/web/lib/survey/access.test.ts
git commit -m "feat(survey-acl): add canAccessSurvey + getSurveyAccessWhere helpers

Pure access-control predicate and Prisma where-fragment generator. Bypasses
for surveyAdmin, public visibility, and survey creator; otherwise checks
SurveyAccess. No DB calls — caller fetches the data."
```

---

## Task 3: Filter the Survey List Query

**Goal:** Apply the access filter to `getSurveys`, `getSurveysSortedByRelevance`, and `getSurveyCount` in `apps/web/modules/survey/list/lib/survey.ts` so the admin survey list only shows what the user is allowed to see. Update tests.

**Files:**
- Modify: `apps/web/modules/survey/list/lib/survey.ts`
- Modify: `apps/web/modules/survey/list/lib/survey.test.ts`

**Acceptance Criteria:**
- [ ] `getSurveys`, `getSurveysSortedByRelevance`, `getSurveyCount` accept an additional `accessContext: { userId, membership }` parameter
- [ ] Each forwards the access filter into its `prisma.survey.findMany`/`.count` `where` clause via `AND: [..., getSurveyAccessWhere(accessContext)]`
- [ ] All callers of these three functions updated to pass the new parameter
- [ ] Existing tests still pass; new tests cover surveyAdmin (sees all), regular user (sees only public + own + access list)
- [ ] No regression in result shapes (still returns `TSurvey[]` / `number`)

**Verify:** `cd apps/web && pnpm exec vitest run modules/survey/list/lib/survey.test.ts` returns 0 failures.

**Steps:**

- [ ] **Step 1: Locate all callers of the affected functions**

```bash
cd /Users/gcohen/dev/formbricks
grep -rn "getSurveys\b\|getSurveyCount\b\|getSurveysSortedByRelevance\b" apps/web --include="*.ts" --include="*.tsx" | grep -v ".test.ts" | grep -v "node_modules"
```

Note every file path that calls them. They all need updating in step 4.

- [ ] **Step 2: Update the function signatures in `survey.ts`**

In `apps/web/modules/survey/list/lib/survey.ts`, add the import:

```ts
import { getSurveyAccessWhere, type SurveyAccessMembership } from "@/lib/survey/access";
```

Update each function (illustrated for `getSurveys`):

```ts
export const getSurveys = reactCache(
  async (
    environmentId: string,
    accessContext: { userId: string; membership: SurveyAccessMembership },
    limit?: number,
    offset?: number,
    filterCriteria?: TSurveyFilterCriteria
  ): Promise<TSurvey[]> => {
    try {
      if (filterCriteria?.sortBy === "relevance") {
        return await getSurveysSortedByRelevance(
          environmentId,
          accessContext,
          limit,
          offset ?? 0,
          filterCriteria
        );
      }

      const surveys = await prisma.survey.findMany({
        where: {
          AND: [
            { environmentId, ...buildWhereClause(filterCriteria) },
            getSurveyAccessWhere(accessContext),
          ],
        },
        select: surveySelect,
        orderBy: buildOrderByClause(filterCriteria?.sortBy),
        take: limit,
        skip: offset,
      });

      // ... rest unchanged
    }
    // ... unchanged
  }
);
```

Apply the same pattern to `getSurveysSortedByRelevance` and `getSurveyCount`.

- [ ] **Step 3: Update all callers (one-by-one)**

For each caller you found in step 1, fetch the user's membership at the call site (or pass it through if the caller already has it) and forward it. Typical pattern at a server-component or server-action caller:

```ts
import { getMembershipByUserIdOrganizationId } from "@/lib/membership/service";

const membership = await getMembershipByUserIdOrganizationId(session.user.id, organizationId);
const surveys = await getSurveys(environmentId, { userId: session.user.id, membership }, limit, offset, filterCriteria);
```

- [ ] **Step 4: Update tests in `survey.test.ts`**

Add an `accessContext` to each existing test call site. Pattern:

```ts
const adminCtx = { userId: "u1", membership: { userId: "u1", surveyAdmin: true } as any };
const memberCtx = { userId: "u1", membership: { userId: "u1", surveyAdmin: false } as any };

test("surveyAdmin sees all surveys", async () => {
  vi.mocked(prisma.survey.findMany).mockResolvedValueOnce([mockSurvey1, mockSurvey2] as any);
  const result = await getSurveys("env-1", adminCtx);
  expect(prisma.survey.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({ environmentId: "env-1" }),
          {}, // empty where = no filter, surveyAdmin bypass
        ]),
      }),
    })
  );
  expect(result).toHaveLength(2);
});

test("regular member sees only accessible surveys", async () => {
  vi.mocked(prisma.survey.findMany).mockResolvedValueOnce([mockSurvey1] as any);
  await getSurveys("env-1", memberCtx);
  expect(prisma.survey.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { visibility: "public" },
              { createdBy: "u1" },
            ]),
          }),
        ]),
      }),
    })
  );
});
```

- [ ] **Step 5: Run all tests and typecheck**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm exec vitest run modules/survey/list/lib/survey.test.ts 2>&1 | tail -10
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "modules/survey/list|app/(.*)environments" | head -20
```

Expected: tests pass; typecheck shows no new errors related to `getSurveys` callers.

- [ ] **Step 6: Commit**

```bash
git add apps/web/modules/survey/list/lib/survey.ts apps/web/modules/survey/list/lib/survey.test.ts apps/web/...  # all updated callers
git commit -m "feat(survey-acl): filter survey list queries by user access

getSurveys / getSurveysSortedByRelevance / getSurveyCount now require an
accessContext { userId, membership } and apply getSurveyAccessWhere to the
underlying Prisma where clause. surveyAdmin sees all; regular members see
public + their own + explicitly granted surveys."
```

---

## Task 4: ACL Check on Server Actions

**Goal:** Update server actions in `apps/web/modules/survey/list/actions.ts` so each survey-scoped action calls `canAccessSurvey` before doing its work, replacing the existing owner/manager-only check.

**Files:**
- Modify: `apps/web/modules/survey/list/actions.ts`
- Modify: corresponding test files (adjacent `.test.ts` if they exist)

**Acceptance Criteria:**
- [ ] `getSurveyAction`, `getFullSurveyAction`, `copySurveyToOtherEnvironmentAction`, `deleteSurveyAction`, `generateSingleUseIdsAction` (and any other survey-id-scoped actions in this file) call `canAccessSurvey` and return `403`/throw on denied
- [ ] surveyAdmin users continue to access all surveys
- [ ] Survey creators continue to access their own surveys
- [ ] Members with explicit `SurveyAccess` rows can access those surveys
- [ ] Members without access get a clear error
- [ ] Existing `checkAuthorizationUpdated` calls remain (keep org-level role checks for things like delete)

**Verify:** `cd apps/web && pnpm exec vitest run modules/survey/list/actions.test.ts` (if exists) or smoke-test by calling the action with a denied user in a Next.js dev server.

**Steps:**

- [ ] **Step 1: Read the existing `actions.ts` to enumerate all survey-id-scoped actions**

```bash
grep -n "Action.*=.*authenticatedActionClient" apps/web/modules/survey/list/actions.ts
```

For each action that takes a `surveyId`, you'll add the ACL check.

- [ ] **Step 2: Add a helper for "load survey with access context"**

Inside `actions.ts` (or a new `actions/lib.ts`), add:

```ts
import { prisma } from "@formbricks/database";
import { getMembershipByUserIdOrganizationId } from "@/lib/membership/service";
import { canAccessSurvey } from "@/lib/survey/access";
import { AuthorizationError } from "@formbricks/types/errors";

const loadSurveyForAccess = async (surveyId: string, userId: string) => {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    select: {
      id: true,
      visibility: true,
      createdBy: true,
      environmentId: true,
      surveyAccess: { select: { userId: true } },
      environment: { select: { project: { select: { organizationId: true } } } },
    },
  });
  if (!survey) throw new ResourceNotFoundError("Survey", surveyId);

  const organizationId = survey.environment.project.organizationId;
  const membership = await getMembershipByUserIdOrganizationId(userId, organizationId);

  if (!canAccessSurvey({ userId, survey, membership })) {
    throw new AuthorizationError("You do not have access to this survey.");
  }
  return { survey, membership, organizationId };
};
```

- [ ] **Step 3: Wrap each survey-scoped action**

Example for `getSurveyAction`:

```ts
export const getSurveyAction = authenticatedActionClient
  .schema(ZGetSurveyAction)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyForAccess(parsedInput.surveyId, ctx.user.id);
    return await getSurvey(parsedInput.surveyId);
  });
```

Replace the existing `checkAuthorizationUpdated({ ..., access: [{ type: "organization", roles: ["owner", "manager"] }, { type: "projectTeam", ... }] })` call. The ACL check supersedes the org-role check for survey access.

For mutating actions (delete, copy), you can keep an additional org-role check if you want only owners/managers to delete (separate concern from "can see"). Recommended:

```ts
export const deleteSurveyAction = authenticatedActionClient
  .schema(ZDeleteSurveyAction)
  .action(async ({ ctx, parsedInput }) => {
    const { membership } = await loadSurveyForAccess(parsedInput.surveyId, ctx.user.id);
    // ACL check passed. Additionally restrict delete to surveyAdmin or
    // org owner/manager so a user with read-only SurveyAccess can't delete.
    const isPrivileged =
      membership?.surveyAdmin === true ||
      membership?.role === "owner" ||
      membership?.role === "manager";
    if (!isPrivileged) {
      throw new OperationNotAllowedError("Only survey admins and org admins can delete surveys.");
    }
    return await deleteSurvey(parsedInput.surveyId);
  });
```

- [ ] **Step 4: Update / add tests**

If `actions.test.ts` exists, add cases:
- creator can call `getSurveyAction`
- random member without access throws AuthorizationError
- surveyAdmin can call any action
- non-admin member with SurveyAccess can call read-only actions but not delete

- [ ] **Step 5: Run tests and typecheck**

```bash
cd /Users/gcohen/dev/formbricks/apps/web
pnpm exec vitest run modules/survey/list/actions 2>&1 | tail -15
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "actions.ts" | head -10
```

Expected: tests pass, no new type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/modules/survey/list/actions.ts apps/web/modules/survey/list/actions.test.ts
git commit -m "feat(survey-acl): enforce per-survey ACL on server actions

Replace the owner/manager-or-projectTeam check with canAccessSurvey on
every survey-id-scoped action. Mutating actions additionally require
surveyAdmin or org owner/manager."
```

---

## Task 5: Page-Level Guards

**Goal:** Add a `canAccessSurvey` check at the top of the survey-detail server-component layouts so direct-URL access by an unauthorized user shows a 403 / not-found page instead of leaking the survey shape.

**Files:**
- Modify: `apps/web/app/(app)/environments/[environmentId]/surveys/[surveyId]/layout.tsx`
- Modify: `apps/web/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/layout.tsx`

**Acceptance Criteria:**
- [ ] Both layouts call `canAccessSurvey` before rendering
- [ ] Denied users see a not-found page (`notFound()`) — not the survey ("not found" leaks less than "forbidden" for ACL'd resources)
- [ ] Allowed users see the page exactly as today
- [ ] Existing tests (if any for these layouts) still pass

**Verify:** Manual smoke test — log in as a member without access, navigate to `/environments/<envId>/surveys/<id>`, confirm not-found page renders. Log in as gcohen and confirm the survey loads.

**Steps:**

- [ ] **Step 1: Update `surveys/[surveyId]/layout.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "@formbricks/database";
import { authOptions } from "@/modules/auth/lib/authOptions";
import { getMembershipByUserIdOrganizationId } from "@/lib/membership/service";
import { canAccessSurvey } from "@/lib/survey/access";
import { getSurvey } from "@/lib/survey/service";
import { SurveyContextWrapper } from "./context/survey-context";

interface SurveyLayoutProps {
  params: Promise<{ surveyId: string; environmentId: string }>;
  children: React.ReactNode;
}

const SurveyLayout = async ({ params, children }: SurveyLayoutProps) => {
  const resolvedParams = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) notFound();

  // Fetch the access metadata in one shot
  const surveyAcl = await prisma.survey.findUnique({
    where: { id: resolvedParams.surveyId },
    select: {
      id: true,
      visibility: true,
      createdBy: true,
      surveyAccess: { select: { userId: true } },
      environment: { select: { project: { select: { organizationId: true } } } },
    },
  });
  if (!surveyAcl) notFound();

  const organizationId = surveyAcl.environment.project.organizationId;
  const membership = await getMembershipByUserIdOrganizationId(session.user.id, organizationId);

  if (!canAccessSurvey({ userId: session.user.id, survey: surveyAcl, membership })) {
    notFound();
  }

  // Existing flow continues from here
  const survey = await getSurvey(resolvedParams.surveyId);
  if (!survey) notFound();

  return <SurveyContextWrapper survey={survey}>{children}</SurveyContextWrapper>;
};

export default SurveyLayout;
```

- [ ] **Step 2: Update `(analysis)/layout.tsx`**

Similar pattern — add the ACL check before rendering. The analysis layout already has session + survey, just add the membership lookup and `canAccessSurvey` check; call `notFound()` on denial.

- [ ] **Step 3: Manual smoke test (after running dev server)**

```bash
cd /Users/gcohen/dev/formbricks
# In one terminal:
pnpm dev
# In another:
# Log in as a non-admin user, try to access /environments/<envId>/surveys/<some-private-id>
# Confirm: not-found page
# Log in as gcohen@asla.org, try the same survey
# Confirm: loads normally
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(app\)/environments/\[environmentId\]/surveys/\[surveyId\]/layout.tsx apps/web/app/\(app\)/environments/\[environmentId\]/surveys/\[surveyId\]/\(analysis\)/layout.tsx
git commit -m "feat(survey-acl): page-level guards on survey detail/analysis layouts

Direct URL access by an unauthorized user now hits notFound() instead of
leaking the survey shape via the layout's getSurvey call."
```

---

## Task 6: Sharing UI in Survey Settings

**Goal:** Add a "Sharing" panel inside the survey editor settings where the survey creator (or surveyAdmin) can flip visibility between private and public, and add/remove individual users from `SurveyAccess`. Wire the save server action.

**Files:**
- Create: `apps/web/modules/survey/sharing/components/sharing-panel.tsx`
- Create: `apps/web/modules/survey/sharing/actions.ts`
- Create: `apps/web/modules/survey/sharing/lib/survey-access.ts`
- Modify: existing survey settings entry point (find via `grep -rn "survey-settings\|SurveySettings" apps/web/modules/survey/editor`)

**Acceptance Criteria:**
- [ ] In the survey settings UI, a "Sharing" section is visible to anyone who can access the survey
- [ ] Visibility radio: `Private (creator + admins + listed users)` | `Public (everyone in this organization)`
- [ ] When private, an autocomplete chip-multi-select shows the current `SurveyAccess` list, lets you add org members, and remove existing entries
- [ ] Save action persists to DB and refreshes the page state
- [ ] Server actions reject when the calling user can't manage the survey (surveyAdmin OR creator OR org owner/manager)
- [ ] Errors surfaced cleanly via toast

**Verify:** Manual smoke test in dev server — log in as creator, create a survey, change visibility, add a user, verify that user can now see the survey.

**Steps:**

- [ ] **Step 1: Implement DB helpers in `survey-access.ts`**

```ts
import "server-only";
import { prisma } from "@formbricks/database";

export const setSurveyVisibility = async (surveyId: string, visibility: "private" | "public") => {
  return prisma.survey.update({
    where: { id: surveyId },
    data: { visibility },
    select: { id: true, visibility: true },
  });
};

export const addSurveyAccess = async (surveyId: string, userIds: string[]) => {
  if (userIds.length === 0) return;
  await prisma.surveyAccess.createMany({
    data: userIds.map((userId) => ({ surveyId, userId })),
    skipDuplicates: true,
  });
};

export const removeSurveyAccess = async (surveyId: string, userId: string) => {
  await prisma.surveyAccess.delete({
    where: { surveyId_userId: { surveyId, userId } },
  });
};

export const listSurveyAccess = async (surveyId: string) => {
  return prisma.surveyAccess.findMany({
    where: { surveyId },
    select: { userId: true, user: { select: { id: true, name: true, email: true } } },
  });
};
```

- [ ] **Step 2: Implement server actions in `sharing/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { ZId } from "@formbricks/types/common";
import { OperationNotAllowedError } from "@formbricks/types/errors";
import { authenticatedActionClient } from "@/lib/utils/action-client";
import { canAccessSurvey } from "@/lib/survey/access";
import { getMembershipByUserIdOrganizationId } from "@/lib/membership/service";
import { prisma } from "@formbricks/database";
import {
  setSurveyVisibility,
  addSurveyAccess,
  removeSurveyAccess,
} from "./lib/survey-access";

const loadSurveyManageContext = async (surveyId: string, userId: string) => {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    select: {
      id: true,
      visibility: true,
      createdBy: true,
      surveyAccess: { select: { userId: true } },
      environment: { select: { project: { select: { organizationId: true } } } },
    },
  });
  if (!survey) throw new Error("Survey not found");
  const organizationId = survey.environment.project.organizationId;
  const membership = await getMembershipByUserIdOrganizationId(userId, organizationId);

  // Read-access prerequisite
  if (!canAccessSurvey({ userId, survey, membership })) {
    throw new OperationNotAllowedError("No access to this survey.");
  }

  // Manage requires creator OR surveyAdmin OR org owner/manager
  const canManage =
    survey.createdBy === userId ||
    membership?.surveyAdmin === true ||
    membership?.role === "owner" ||
    membership?.role === "manager";
  if (!canManage) {
    throw new OperationNotAllowedError("Only the creator or an admin can manage sharing.");
  }
  return { survey, membership };
};

const ZSetVisibility = z.object({
  surveyId: ZId,
  visibility: z.enum(["private", "public"]),
});

export const setSurveyVisibilityAction = authenticatedActionClient
  .schema(ZSetVisibility)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyManageContext(parsedInput.surveyId, ctx.user.id);
    return setSurveyVisibility(parsedInput.surveyId, parsedInput.visibility);
  });

const ZAddAccess = z.object({ surveyId: ZId, userIds: z.array(z.string().min(1)) });

export const addSurveyAccessAction = authenticatedActionClient
  .schema(ZAddAccess)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyManageContext(parsedInput.surveyId, ctx.user.id);
    await addSurveyAccess(parsedInput.surveyId, parsedInput.userIds);
    return { ok: true };
  });

const ZRemoveAccess = z.object({ surveyId: ZId, userId: z.string().min(1) });

export const removeSurveyAccessAction = authenticatedActionClient
  .schema(ZRemoveAccess)
  .action(async ({ ctx, parsedInput }) => {
    await loadSurveyManageContext(parsedInput.surveyId, ctx.user.id);
    await removeSurveyAccess(parsedInput.surveyId, parsedInput.userId);
    return { ok: true };
  });
```

- [ ] **Step 3: Build the panel**

`apps/web/modules/survey/sharing/components/sharing-panel.tsx` — a client component with:
- Two radio buttons for visibility
- A user multi-select autocomplete (use existing `Input`/`Combobox` patterns from `@/modules/ui/components/...` — search the codebase for existing user-picker components first)
- Submit button that calls the server actions

Pattern (skeleton — fill in concrete UI components per the codebase's conventions):

```tsx
"use client";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/modules/ui/components/button";
import { RadioGroup } from "@/modules/ui/components/radio-group";
import {
  setSurveyVisibilityAction,
  addSurveyAccessAction,
  removeSurveyAccessAction,
} from "@/modules/survey/sharing/actions";

interface Props {
  surveyId: string;
  initialVisibility: "private" | "public";
  initialAccess: { id: string; name: string; email: string }[];
  orgMembers: { id: string; name: string; email: string }[];
}

export const SharingPanel = ({ surveyId, initialVisibility, initialAccess, orgMembers }: Props) => {
  const [visibility, setVisibility] = useState(initialVisibility);
  const [access, setAccess] = useState(initialAccess);

  const onVisibilityChange = async (next: "private" | "public") => {
    const prev = visibility;
    setVisibility(next);
    try {
      await setSurveyVisibilityAction({ surveyId, visibility: next });
      toast.success(`Visibility set to ${next}`);
    } catch (err) {
      setVisibility(prev);
      toast.error("Failed to update visibility");
    }
  };

  const onAddUser = async (userId: string) => {
    try {
      await addSurveyAccessAction({ surveyId, userIds: [userId] });
      const u = orgMembers.find((m) => m.id === userId);
      if (u) setAccess([...access, u]);
    } catch {
      toast.error("Failed to add user");
    }
  };

  const onRemoveUser = async (userId: string) => {
    try {
      await removeSurveyAccessAction({ surveyId, userId });
      setAccess(access.filter((u) => u.id !== userId));
    } catch {
      toast.error("Failed to remove user");
    }
  };

  return (
    <section>
      <h3>Sharing</h3>
      <RadioGroup value={visibility} onValueChange={onVisibilityChange}>
        <label><input type="radio" value="private" /> Private — creator + admins + people you add</label>
        <label><input type="radio" value="public" /> Public — everyone in this organization</label>
      </RadioGroup>

      {visibility === "private" && (
        <div>
          <h4>People with access</h4>
          {/* User picker + chip list — use existing UI conventions */}
        </div>
      )}
    </section>
  );
};
```

- [ ] **Step 4: Mount the panel in survey settings**

Find where existing survey settings panels live:

```bash
grep -rn "SurveySettings\|settings.*tab\|access.*tab" apps/web/modules/survey/editor | head -10
```

Add the sharing panel as a new tab/section. Server-side, fetch `initialAccess` (from `listSurveyAccess`) and `orgMembers` (from `getMembershipsByOrganizationId`) and pass as props.

- [ ] **Step 5: Manual smoke test in dev server**

- Create a new (private by default) survey as a non-admin user.
- As the creator, open the sharing panel, add another user.
- Log in as that user, confirm survey is now visible.
- Remove access, confirm survey disappears for them.
- Flip to public, confirm everyone in the org sees it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/modules/survey/sharing/ apps/web/modules/survey/editor/...
git commit -m "feat(survey-acl): sharing panel UI in survey settings

New section in the survey editor lets the creator (or admin) flip a survey
between private/public and manage the per-user access list. Server actions
verify manage permission before mutating."
```

---

## Task 7: Survey-Admin Toggle in Members UI

**Goal:** Add a toggle column to the org members admin table so an org owner can flip `Membership.surveyAdmin` for any member.

**Files:**
- Modify: `apps/web/modules/organization/settings/teams/components/edit-memberships/edit-memberships.tsx`
- Modify: `apps/web/modules/organization/settings/teams/actions.ts`

**Acceptance Criteria:**
- [ ] Members list now shows a "Survey Admin" column with a toggle
- [ ] Toggle is editable only by org owners (defensive: also surveyAdmins themselves can edit, so the original gcohen can promote others)
- [ ] Server action `setMembershipSurveyAdminAction` persists changes
- [ ] Optimistic UI with rollback on error
- [ ] Existing members UI still functions

**Verify:** Manual smoke in dev server. Log in as gcohen, navigate to org settings → members, flip another user's surveyAdmin on, sign in as them, confirm they see all surveys.

**Steps:**

- [ ] **Step 1: Add the server action**

In `apps/web/modules/organization/settings/teams/actions.ts`, near other membership actions:

```ts
const ZSetSurveyAdminAction = z.object({
  organizationId: ZId,
  userId: ZId,
  surveyAdmin: z.boolean(),
});

export const setMembershipSurveyAdminAction = authenticatedActionClient
  .schema(ZSetSurveyAdminAction)
  .action(async ({ ctx, parsedInput }) => {
    // Only org owners or existing surveyAdmins can promote/demote
    const callerMembership = await getMembershipByUserIdOrganizationId(
      ctx.user.id,
      parsedInput.organizationId
    );
    const canManage =
      callerMembership?.role === "owner" || callerMembership?.surveyAdmin === true;
    if (!canManage) {
      throw new OperationNotAllowedError("Only org owners or survey admins can manage this.");
    }
    return prisma.membership.update({
      where: {
        userId_organizationId: {
          userId: parsedInput.userId,
          organizationId: parsedInput.organizationId,
        },
      },
      data: { surveyAdmin: parsedInput.surveyAdmin },
      select: { userId: true, surveyAdmin: true },
    });
  });
```

- [ ] **Step 2: Update the members list UI**

Add a column to `edit-memberships.tsx` rendering a toggle bound to `setMembershipSurveyAdminAction`. Optimistic update + rollback on error.

- [ ] **Step 3: Manual smoke test**

- Log in as gcohen.
- Org settings → members → flip another user's "Survey Admin" toggle on.
- Sign in as that other user.
- Confirm they now see every survey (surveyAdmin bypass works).
- Toggle off, confirm visibility reverts to ACL-filtered.

- [ ] **Step 4: Commit**

```bash
git add apps/web/modules/organization/settings/teams/
git commit -m "feat(survey-acl): surveyAdmin toggle in org members UI

Org owners (and existing surveyAdmins) can promote other members to
surveyAdmin from the members admin table."
```

---

## Task 8: Production Rollout

**Goal:** Execute the production deploy safely, in the gated sequence laid out in the safety plan. This task is **not** code — it's an ops runbook to be followed exactly. The plan author should also check in this runbook as a doc.

**Files:**
- Create: `SURVEY_ACL_RUNBOOK.md` (at repo root, mirroring `AZURE_SSO_SETUP.md` style)
- Optionally amend: `DEPLOYMENT_GUIDE.md` to reference the runbook

**Acceptance Criteria:**
- [ ] DB backup confirmed and timestamped before any change
- [ ] Schema migration applied to prod, verified via `\d surveys` and `\d memberships`
- [ ] Data migration script run, NOTICE output shows `1 membership granted` and `N surveys grandfathered`
- [ ] Live respondent flow smoke-tested *before* deploying app code (`https://surveys.asla.org/s/<live-id>`)
- [ ] Image built locally, pushed to GHCR per `DEPLOYMENT_GUIDE.md`, deployed on VM
- [ ] App startup logs clean (no Prisma client errors)
- [ ] Smoke tests pass (gcohen sees all; member sees grandfathered surveys; new survey is private)
- [ ] 30-min observation period: no respondent-endpoint 403 spike

**Verify:** All checklist items below crossed off. Real survey responses still flowing in.

**Steps:**

- [ ] **Step 1: Write `SURVEY_ACL_RUNBOOK.md`**

Sections (match the `AZURE_SSO_SETUP.md` voice — terse, ASLA-specific):

1. **Pre-flight checklist** — backup, gcohen user exists, dev DB validation done
2. **Schema migration on prod** — apply Task 0's schema changes via `db push` against the prod DB. (No app deploy yet.)
3. **Data migration** — `psql -f scripts/2026-04-26-survey-acl-migration.sql`, verify NOTICE output
4. **Verify respondent flow still works** — open an incognito window, hit a known live survey URL, confirm it loads + accepts a response
5. **Deploy app image** — follow `DEPLOYMENT_GUIDE.md` standard build/transfer/restart sequence
6. **Smoke tests after deploy** (see step 2 below)
7. **Rollback procedures** — see "Rollback plan" section
8. **Observation period** — 30 min log watching, what to look for

- [ ] **Step 2: Smoke-test checklist (in runbook)**

Document these as ordered checks the operator runs after deploy:

```
1. Open https://surveys.asla.org in incognito → branded login page renders
2. Hit a live survey URL https://surveys.asla.org/s/<known-live-id> → loads, can submit
3. Sign in as gcohen@asla.org → survey list shows ALL surveys (same as before deploy)
4. Sign in as a non-admin member → survey list shows only the grandfathered (public) surveys
5. As that member, create a new survey → new survey is visibility=private and only the creator sees it
6. As that member, click Sharing → set to public → another non-admin member can now see it
7. As that member, set back to private and add the other member to access list → they see it
8. Manually trigger a Snowflake export by submitting a response → check pipeline logs, response landed in Snowflake
9. Check webhook destination (if any active webhooks) received the response payload
```

- [ ] **Step 3: Rollback plan (in runbook)**

| Scenario | Action |
|---|---|
| App boot fails after deploy | `docker compose down` + redeploy previous image (`formbricks-local:pre-acl-backup` tag from `DEPLOYMENT_GUIDE.md` convention). Schema stays — old code ignores new columns. |
| ACL is blocking respondents (unexpected) | Set every survey to `public` via SQL, restart app: `UPDATE surveys SET visibility='public';` |
| Migration partial / wrong | Re-run idempotent migration. If `surveyAdmin` flagging is wrong, manually `UPDATE memberships SET "surveyAdmin"=false WHERE "userId"!=<gcohen-id>;` |
| Catastrophic | Restore from the pre-migration DB backup |

- [ ] **Step 4: Run the rollout**

Follow the runbook step-by-step on production. Do NOT skip the live-respondent smoke test before deploying app code (step 4 of the runbook). That's the load-bearing safety check — if respondents broke after the schema migration, you'd want to find out *before* the app code deploys, when rolling forward is still cheap.

- [ ] **Step 5: Final commit + push**

```bash
git add SURVEY_ACL_RUNBOOK.md DEPLOYMENT_GUIDE.md
git commit -m "docs(survey-acl): production rollout runbook

Step-by-step deploy procedure with backup/schema-migration/data-migration/
app-deploy gates, smoke test checklist, and rollback procedures."
git push origin main
```

---

## Self-Review Notes (filled by the plan author at write-time)

**Spec coverage:**
- ✅ Schema additions → Task 0
- ✅ Data migration with grandfather + admin grant → Task 1
- ✅ Access predicate → Task 2
- ✅ List filter → Task 3
- ✅ Server-action gating → Task 4
- ✅ Direct-URL guard → Task 5
- ✅ Sharing UI for users → Task 6
- ✅ Survey-admin toggle UI → Task 7
- ✅ Safe rollout with smoke tests → Task 8
- ✅ License-clean (no `@/modules/ee/` imports anywhere new) — verified
- ✅ Respondent paths intentionally untouched — verified by `apps/web/app/s/...` and `apps/web/app/api/v1/client/...` not appearing in any task
- ✅ System pipeline / Snowflake / webhooks intentionally untouched — verified by `apps/web/app/api/(internal)/pipeline/route.ts` not appearing in any task
- ✅ API-key paths intentionally untouched — verified by `apps/web/app/api/v1/management/...` and `apps/web/modules/api/v2/...` not appearing in any task

**Placeholder scan:** No "TBD", "TODO", or "implement later" placeholders. Every code step shows the actual code; every command step shows the actual command. The sharing UI is the loosest task because its UI styling depends on conventions in the existing editor — the skeleton is concrete and the executor is told to grep for existing user-picker components.

**Type consistency:**
- `canAccessSurvey` signature: `{ userId: string; survey: SurveyAccessSurvey; membership: SurveyAccessMembership }` — used identically in Tasks 4 and 5 page-level guards.
- `getSurveyAccessWhere` signature: `{ userId: string; membership: SurveyAccessMembership }` — used identically in Task 3.
- `accessContext` parameter: `{ userId: string; membership: SurveyAccessMembership }` — used in Task 3 across getSurveys / getSurveysSortedByRelevance / getSurveyCount.
- Action-shape types (`OperationNotAllowedError`, `AuthorizationError`) — both referenced in Task 4 and 6 and 7. Confirm import paths during execution; they exist at `@formbricks/types/errors`.
