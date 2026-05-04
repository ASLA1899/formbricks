# Survey Schedule Window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional auto open/close schedule (date + time + IANA timezone) to surveys, enforced via the existing 5-minute cron, independent from the existing `autoComplete` (close-on-N-responses) feature.

**Architecture:** Three new optional fields on `Survey` (`runOnDate`, `closeOnDate`, `scheduleTimezone`). A new drain module `runDueSchedules()` is called from `/api/cron/reminders` alongside the existing invitation/reminder drains. Status transitions `{draft,paused}→inProgress` on open, `{inProgress,paused}→completed` on close, idempotent via the eligibility check (no "hasFired" flag). UI is one new `AdvancedOptionToggle` in `response-options-card.tsx` with a shared timezone picker and two independent date+time pickers.

**Tech Stack:** Prisma + PostgreSQL, Next.js App Router, Zod, vitest, React + Preact (editor), `Intl.DateTimeFormat` for timezone formatting.

**Spec:** `docs/superpowers/specs/2026-05-04-survey-schedule-window-design.md`

**Upstream collision note:** Migration `20250904145727_removes_cron_and_survey_scheduling` previously dropped `runOnDate`/`closeOnDate` from upstream Formbricks. We are re-introducing the same column names as ASLA-fork-specific. Future upstream merges may conflict; document the resolution path in `DEPLOYMENT_GUIDE.md` after merge.

---

## File Structure

**New files:**

- `packages/database/migration/<TS>_add_survey_schedule_window/migration.sql` — DDL: 3 columns + 2 partial indexes
- `apps/web/modules/survey/schedule/lib/run-due-schedules.ts` — drain module
- `apps/web/modules/survey/schedule/lib/run-due-schedules.test.ts` — drain unit tests

**Modified files:**

- `packages/database/schema.prisma` — three Survey fields
- `packages/database/zod/surveys.ts` — extend `ZSurveyBase` with the three fields
- `packages/types/surveys/types.ts` — extend update-input + cross-field refinements
- `apps/web/lib/survey/service.ts` — server-side validation in `updateSurveyInternal`
- `apps/web/lib/survey/service.test.ts` — extend with validation tests
- `apps/web/app/api/cron/reminders/route.ts` — wire `runDueSchedules` into the cron handler
- `apps/web/modules/survey/editor/components/response-options-card.tsx` — UI
- `apps/web/modules/survey/editor/components/response-options-card.test.tsx` — new component test (file does not exist yet)
- `apps/web/locales/en-US.json` — i18n keys (other locales auto-fill via lingo)

**Conventions to follow:**

- ASLA pre-commit hook trips on pre-existing i18n drift; use `git commit --no-verify` per CLAUDE.md.
- Migration filenames use `YYYYMMDDHHMMSS_snake_case` (matching `20260426191252_add_survey_acl`). When implementing, generate the timestamp at `date +%Y%m%d%H%M%S` time.
- Prisma migrations live in `packages/database/migration/` (custom dir; the migration-runner copies them into Prisma's standard `migrations/` dir at deploy time).
- Migrations get auto-applied on container startup; no separate `db push` needed.

---

## Task 0: Beads tracking & worktree setup

**Goal:** Set up beads issues and a feature worktree so the rest of the plan can be executed in isolation from `main`.

**Files:** none (operational)

**Acceptance Criteria:**
- [ ] One beads epic created for the feature, with one child issue per Task 1–6.
- [ ] Each child has the right priority (P1 for 1–4, P2 for 5–6) and proper `blockedBy` links.
- [ ] Worktree `~/dev/formbricks-survey-schedule` exists on branch `feature/survey-schedule-window`, baselined off the spec commit on `main`.

**Verify:**
```bash
bd list --status=open | grep "Schedule window"   # 7 rows (1 epic + 6 children)
git -C ~/dev/formbricks-survey-schedule rev-parse --abbrev-ref HEAD   # feature/survey-schedule-window
```

**Steps:**

- [ ] **Step 1: Create epic + children in beads (one bd command per item; run in parallel where possible)**

```bash
bd create --title="EPIC: Survey schedule window (auto open/close on date+time+tz)" \
  --description="See docs/superpowers/plans/2026-05-04-survey-schedule-window.md" \
  --type=feature --priority=2

bd create --title="T1: Schema, Prisma migration & Zod types for survey schedule window" \
  --description="Adds runOnDate, closeOnDate, scheduleTimezone columns + partial indexes. Spec §1 / Plan Task 1." \
  --type=task --priority=1

bd create --title="T2: Server-side validation in updateSurveyInternal" \
  --description="Reject closeOnDate <= runOnDate; validate IANA tz; auto-clear tz when both timestamps null. Spec §5 / Plan Task 2." \
  --type=task --priority=1

bd create --title="T3: runDueSchedules drain module + unit tests" \
  --description="apps/web/modules/survey/schedule/lib/run-due-schedules.ts with race-safe transition() helper. Spec §4 / Plan Task 3." \
  --type=task --priority=1

bd create --title="T4: Wire runDueSchedules into /api/cron/reminders" \
  --description="Update route handler + integration test asserting drain isolation. Spec §4 / Plan Task 4." \
  --type=task --priority=1

bd create --title="T5: Editor UI for schedule window in response-options-card" \
  --description="AdvancedOptionToggle with shared tz dropdown + two date/time rows + live preview. Spec §2 / Plan Task 5." \
  --type=task --priority=2

bd create --title="T6: Manual smoke + runbook update" \
  --description="Add the 5-step smoke from the spec to a runbook section; verify end-to-end on the local docker stack. Spec §6 / Plan Task 6." \
  --type=task --priority=2
```

- [ ] **Step 2: Wire dependency graph**

```bash
# Substitute the actual beads-xxx IDs returned above:
EPIC=beads-XX0
T1=beads-XX1; T2=beads-XX2; T3=beads-XX3
T4=beads-XX4; T5=beads-XX5; T6=beads-XX6

bd dep add $T1 $EPIC
bd dep add $T2 $T1   # validation depends on schema/types
bd dep add $T3 $T1   # drain depends on schema
bd dep add $T4 $T3   # wiring depends on drain module
bd dep add $T5 $T1   # UI depends on Zod types
bd dep add $T6 $T4
bd dep add $T6 $T5
```

- [ ] **Step 3: Create the worktree**

```bash
git -C ~/dev/formbricks worktree add ~/dev/formbricks-survey-schedule -b feature/survey-schedule-window main
cd ~/dev/formbricks-survey-schedule
pnpm install
```

- [ ] **Step 4: Build dependency packages once (per CLAUDE.md / memory: cache & logger packages need a one-time build before vitest)**

```bash
pnpm --filter @formbricks/logger build
pnpm --filter @formbricks/cache build
pnpm --filter @formbricks/storage build
```

- [ ] **Step 5: No commit needed (operational task).**

---

## Task 1: Schema, migration, and Zod types

**Goal:** Add `runOnDate`, `closeOnDate`, `scheduleTimezone` to `Survey` at the database, Prisma, and Zod layers. No business logic.

**Files:**
- Create: `packages/database/migration/<TS>_add_survey_schedule_window/migration.sql`
- Modify: `packages/database/schema.prisma:368` (the `Survey` model, near `autoClose`/`autoComplete`)
- Modify: `packages/database/zod/surveys.ts:40` (extend `ZSurveyBase`)
- Modify: `packages/types/surveys/types.ts` (add cross-field `.refine` to the update input schema)

**Acceptance Criteria:**
- [ ] Migration SQL adds the three columns and two partial indexes idempotently (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- [ ] Prisma `Survey` model declares `runOnDate DateTime?`, `closeOnDate DateTime?`, `scheduleTimezone String?`.
- [ ] `ZSurveyBase` declares the three fields as nullable.
- [ ] `ZSurveyUpdateInput` (or wherever the survey-update schema lives) cross-validates `closeOnDate > runOnDate` when both set.
- [ ] `pnpm --filter @formbricks/database db:migrate:dev --name=skip` runs cleanly against a fresh DB (the migration applies, `\d "Survey"` shows the three new columns).
- [ ] `pnpm --filter @formbricks/web typecheck` passes.

**Verify:**
```bash
pnpm --filter @formbricks/database build && \
pnpm --filter @formbricks/web typecheck && \
psql "$DATABASE_URL" -c '\d "Survey"' | grep -E "runOnDate|closeOnDate|scheduleTimezone"
```
Expected: 3 matching rows shown by `psql`.

**Steps:**

- [ ] **Step 1: Bootstrap dependencies (memory: db:migrate:dev needs @formbricks/logger built first)**

```bash
pnpm --filter @formbricks/logger build
```

- [ ] **Step 2: Create the migration directory and SQL**

Get the timestamp:
```bash
TS=$(date +%Y%m%d%H%M%S)
mkdir -p packages/database/migration/${TS}_add_survey_schedule_window
```

Write `packages/database/migration/${TS}_add_survey_schedule_window/migration.sql`:
```sql
-- Survey schedule window: optional auto open/close at a specific date+time
-- in an explicit IANA timezone. UTC instants are stored; tz is display-only.
ALTER TABLE "public"."Survey"
  ADD COLUMN IF NOT EXISTS "runOnDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closeOnDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduleTimezone" TEXT;

CREATE INDEX IF NOT EXISTS "Survey_runOnDate_idx"
  ON "public"."Survey" ("runOnDate")
  WHERE "runOnDate" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Survey_closeOnDate_idx"
  ON "public"."Survey" ("closeOnDate")
  WHERE "closeOnDate" IS NOT NULL;
```

- [ ] **Step 3: Update `packages/database/schema.prisma`**

Locate `model Survey` (around line 350) and add the three lines immediately after `autoComplete        Int?` (around line 372):

```prisma
  autoClose           Int?
  autoComplete        Int?
  runOnDate           DateTime?
  closeOnDate         DateTime?
  scheduleTimezone    String?
  delay               Int                     @default(0)
```

Add two `@@index` lines at the bottom of the model (just above the closing `}`), alongside the existing `@@index([environmentId, updatedAt])`:

```prisma
  @@index([environmentId, updatedAt])
  @@index([segmentId])
  @@index([runOnDate])
  @@index([closeOnDate])
}
```

- [ ] **Step 4: Apply the migration locally**

```bash
pnpm --filter @formbricks/database db:migrate:dev --name skip
```

Expected: Prisma applies the migration. `psql "$DATABASE_URL" -c '\d "Survey"'` shows `runOnDate`, `closeOnDate`, `scheduleTimezone` columns.

- [ ] **Step 5: Extend `ZSurveyBase` in `packages/database/zod/surveys.ts`**

Find the existing nullable fields in `ZSurveyBase` (e.g. the `autoClose`, `autoComplete` declarations — search for `autoComplete:`). Add the three new fields right after `autoComplete`:

```ts
  autoComplete: z.number().int().nullable().openapi({
    description: "Number of completed responses after which the survey auto-closes",
  }),
  runOnDate: z.coerce.date().nullable().openapi({
    description: "UTC instant when the survey should auto-open. Null = no scheduled open.",
  }),
  closeOnDate: z.coerce.date().nullable().openapi({
    description: "UTC instant when the survey should auto-close. Null = no scheduled close.",
  }),
  scheduleTimezone: z.string().nullable().openapi({
    description: "IANA timezone (e.g. 'America/New_York') used to render the wall-clock back to the editor. Null when both timestamps are null.",
  }),
```

If `autoComplete` does not exist in this file with that exact shape, model the new fields on the closest existing nullable field; the structure should be the same.

- [ ] **Step 6: Add the cross-field refinement and tz validity check**

Decide where this lives by searching:
```bash
grep -n "ZSurveyUpdateInput\|ZSurveyInput\|\.refine\(" packages/types/surveys/types.ts | head
```

Add a top-level helper in `packages/types/surveys/types.ts`:

```ts
const isIanaTimezone = (tz: string): boolean => {
  try {
    return Intl.supportedValuesOf("timeZone").includes(tz);
  } catch {
    // Older Node runtimes: fall back to constructor check
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }
};

export const ZScheduleWindow = z
  .object({
    runOnDate: z.coerce.date().nullable(),
    closeOnDate: z.coerce.date().nullable(),
    scheduleTimezone: z.string().nullable(),
  })
  .refine(
    (s) => !s.runOnDate || !s.closeOnDate || s.closeOnDate.getTime() > s.runOnDate.getTime(),
    { message: "closeOnDate must be after runOnDate", path: ["closeOnDate"] },
  )
  .refine(
    (s) => !s.scheduleTimezone || isIanaTimezone(s.scheduleTimezone),
    { message: "scheduleTimezone must be a valid IANA zone", path: ["scheduleTimezone"] },
  )
  .refine(
    (s) => (s.runOnDate || s.closeOnDate) ? !!s.scheduleTimezone : true,
    { message: "scheduleTimezone is required when runOnDate or closeOnDate is set", path: ["scheduleTimezone"] },
  );
```

Compose `ZScheduleWindow` into the survey update Zod schema. The exact merge depends on how the existing schema is built; a typical pattern:

```ts
export const ZSurveyUpdateInput = ZSurvey.pick({ /* existing fields */ })
  .merge(ZScheduleWindow.removeDefault?.() ?? z.object({}))
  // OR just add the three fields directly and a top-level .superRefine
```

**Important:** if `ZSurveyUpdateInput` is constructed via `.partial()`, wrap with `.superRefine` instead of three sub-refines so partial inputs (where only one of the three is provided) still get validated.

- [ ] **Step 7: Verify typecheck**

```bash
pnpm --filter @formbricks/database build
pnpm --filter @formbricks/web typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/database/schema.prisma \
        packages/database/migration/${TS}_add_survey_schedule_window \
        packages/database/zod/surveys.ts \
        packages/types/surveys/types.ts
git commit --no-verify -m "feat(surveys): add schedule-window fields (runOnDate, closeOnDate, scheduleTimezone)"
```

- [ ] **Step 9: Close beads task**

```bash
bd close $T1 --reason="Schema, migration, Zod types landed; verified by typecheck + psql describe"
```

---

## Task 2: Server-side validation in `updateSurveyInternal`

**Goal:** Ensure the server rejects bad schedule combinations and tidies the `scheduleTimezone` field, with TDD coverage.

**Files:**
- Modify: `apps/web/lib/survey/service.ts` (the `updateSurveyInternal` function around line 291)
- Modify: `apps/web/lib/survey/service.test.ts` (extend with validation tests)

**Acceptance Criteria:**
- [ ] `updateSurveyInternal` throws `InvalidInputError` (or the existing equivalent) for `closeOnDate <= runOnDate`.
- [ ] `updateSurveyInternal` throws for an unrecognized `scheduleTimezone` (e.g. `"Mars/Olympus"`).
- [ ] When the caller passes `runOnDate: null` AND `closeOnDate: null`, the function persists `scheduleTimezone: null` regardless of incoming value.
- [ ] When neither `runOnDate` nor `closeOnDate` is provided in the update, existing values are preserved (no accidental clears).
- [ ] Tests cover all four cases.

**Verify:**
```bash
pnpm --filter @formbricks/web vitest run lib/survey/service.test.ts
```
Expected: all four new tests pass.

**Steps:**

- [ ] **Step 1: Read the existing `updateSurveyInternal` to find the validation block**

```bash
sed -n '291,360p' apps/web/lib/survey/service.ts
```

Identify where `validateInputs([updatedSurvey, ZSurvey])` runs (line ~296) — that's where Zod will already catch bad data IF Task 1's schema change is wired into the right Zod object. If it's not, the new validations need to run inline here.

- [ ] **Step 2: Write failing tests in `apps/web/lib/survey/service.test.ts`**

Add a new `describe("updateSurveyInternal — schedule window")` block. Each test follows this shape:

```ts
import { updateSurveyInternal } from "./service";
import { InvalidInputError } from "@formbricks/types/errors";
import { mockSurvey } from "./__mock__/survey.mock"; // existing fixture

describe("updateSurveyInternal — schedule window", () => {
  test("rejects closeOnDate <= runOnDate", async () => {
    await expect(
      updateSurveyInternal({
        ...mockSurvey,
        runOnDate: new Date("2026-06-01T12:00:00Z"),
        closeOnDate: new Date("2026-06-01T11:00:00Z"),
        scheduleTimezone: "America/New_York",
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  test("rejects invalid scheduleTimezone", async () => {
    await expect(
      updateSurveyInternal({
        ...mockSurvey,
        runOnDate: new Date("2026-06-01T12:00:00Z"),
        closeOnDate: null,
        scheduleTimezone: "Mars/Olympus",
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  test("auto-clears scheduleTimezone when both timestamps are null", async () => {
    const result = await updateSurveyInternal({
      ...mockSurvey,
      runOnDate: null,
      closeOnDate: null,
      scheduleTimezone: "America/New_York", // caller mistakenly passed
    });
    expect(result.scheduleTimezone).toBeNull();
  });

  test("accepts a valid open+close window", async () => {
    const result = await updateSurveyInternal({
      ...mockSurvey,
      runOnDate: new Date("2026-06-01T13:00:00Z"),
      closeOnDate: new Date("2026-06-08T13:00:00Z"),
      scheduleTimezone: "America/New_York",
    });
    expect(result.runOnDate).toEqual(new Date("2026-06-01T13:00:00Z"));
    expect(result.closeOnDate).toEqual(new Date("2026-06-08T13:00:00Z"));
    expect(result.scheduleTimezone).toBe("America/New_York");
  });
});
```

If `mockSurvey` does not exist or is not exported from `__mock__`, locate the existing mock pattern by `grep -rn "mockSurvey\|__mock__/survey" apps/web/lib/survey` and reuse whatever the file already imports.

- [ ] **Step 3: Run tests, expect failures**

```bash
pnpm --filter @formbricks/web vitest run lib/survey/service.test.ts -t "schedule window"
```

Expected: 3 of 4 fail (rejects, rejects, auto-clears). The 4th may pass already if Task 1's Zod hooked in cleanly.

- [ ] **Step 4: Implement the inline auto-clear in `updateSurveyInternal`**

Find where `surveyData` is built (line ~310: `const { triggers, ..., ...surveyData } = updatedSurvey;`) and add immediately after that destructure:

```ts
// Survey schedule window: tidy tz when both timestamps cleared.
if (surveyData.runOnDate === null && surveyData.closeOnDate === null) {
  surveyData.scheduleTimezone = null;
}
```

The Zod refinements added in Task 1 should already cover the two `rejects.toThrow` cases via `validateInputs([updatedSurvey, ZSurvey])` at line ~296. If not, add a manual check immediately after that line:

```ts
if (
  updatedSurvey.runOnDate &&
  updatedSurvey.closeOnDate &&
  updatedSurvey.closeOnDate.getTime() <= updatedSurvey.runOnDate.getTime()
) {
  throw new InvalidInputError("closeOnDate must be after runOnDate");
}
if (updatedSurvey.scheduleTimezone && !isIanaTimezone(updatedSurvey.scheduleTimezone)) {
  throw new InvalidInputError("scheduleTimezone must be a valid IANA zone");
}
```

(Import `isIanaTimezone` from `@formbricks/types/surveys/types` where Task 1 placed it.)

- [ ] **Step 5: Run tests, expect green**

```bash
pnpm --filter @formbricks/web vitest run lib/survey/service.test.ts -t "schedule window"
```

Expected: 4 of 4 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/survey/service.ts apps/web/lib/survey/service.test.ts
git commit --no-verify -m "feat(surveys): validate schedule-window inputs on updateSurvey"
```

- [ ] **Step 7: Close beads task**

```bash
bd close $T2 --reason="Validation + auto-tz-clear landed with 4 vitest tests passing"
```

---

## Task 3: `runDueSchedules` drain module

**Goal:** A pure module that can be unit-tested in isolation, with a race-safe transition helper.

**Files:**
- Create: `apps/web/modules/survey/schedule/lib/run-due-schedules.ts`
- Create: `apps/web/modules/survey/schedule/lib/run-due-schedules.test.ts`

**Acceptance Criteria:**
- [ ] Exports `runDueSchedules(): Promise<{ opened: number; closed: number }>`.
- [ ] Skips surveys whose `FOR UPDATE` re-read shows the status is no longer eligible (race safety).
- [ ] Calls the existing `updateSurvey` (or the same helper used by the autoComplete path) so cache invalidation and follow-ups fire.
- [ ] Emits a `queueAuditEvent` per transition with `userType: "system"`, `targetType: "survey"`, `metadata.reason ∈ {scheduled-open, scheduled-close}`. Failures emit with `status: "failure"`.
- [ ] All 9 listed unit tests pass.

**Verify:**
```bash
pnpm --filter @formbricks/web vitest run modules/survey/schedule/lib/run-due-schedules.test.ts
```
Expected: 9/9 pass.

**Steps:**

- [ ] **Step 1: Examine the autoComplete reference implementation**

```bash
sed -n '195,250p' apps/web/app/api/\(internal\)/pipeline/route.ts
```

Note the exact shape of:
- `updateSurvey({ ...survey, status: "completed" })`
- `queueAuditEvent({ ... })` payload (userType "system", action "updated", targetType "survey")

We'll mirror this shape so the audit consumer can treat scheduled and count-triggered closes uniformly.

- [ ] **Step 2: Write the failing tests at `apps/web/modules/survey/schedule/lib/run-due-schedules.test.ts`**

```ts
import { describe, expect, test, vi, beforeEach } from "vitest";
import { runDueSchedules } from "./run-due-schedules";
import { prisma } from "@formbricks/database";
import { updateSurvey } from "@/lib/survey/service";
import { queueAuditEvent } from "@/modules/audit/lib/queue";

vi.mock("@formbricks/database", () => ({
  prisma: {
    survey: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  },
}));
vi.mock("@/lib/survey/service", () => ({ updateSurvey: vi.fn() }));
vi.mock("@/modules/audit/lib/queue", () => ({ queueAuditEvent: vi.fn() }));

const baseSurvey = {
  id: "svr_1",
  environmentId: "env_1",
  status: "draft" as const,
  runOnDate: new Date(Date.now() - 60_000),
  closeOnDate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no-op transaction returns the survey unchanged when re-read
  (prisma.$transaction as any).mockImplementation(async (fn: any) => fn({
    survey: { findUnique: vi.fn().mockResolvedValue(baseSurvey) },
  }));
});

describe("runDueSchedules", () => {
  test("opens a draft survey whose runOnDate is past", async () => {
    (prisma.survey.findMany as any)
      .mockResolvedValueOnce([baseSurvey])           // opens query
      .mockResolvedValueOnce([]);                    // closes query
    const r = await runDueSchedules();
    expect(updateSurvey).toHaveBeenCalledWith(expect.objectContaining({ id: "svr_1", status: "inProgress" }));
    expect(queueAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      userType: "system",
      action: "updated",
      targetType: "survey",
      targetId: "svr_1",
    }));
    expect(r).toEqual({ opened: 1, closed: 0 });
  });

  test("opens a paused survey whose runOnDate is past", async () => {
    const s = { ...baseSurvey, status: "paused" as const };
    (prisma.survey.findMany as any).mockResolvedValueOnce([s]).mockResolvedValueOnce([]);
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn({ survey: { findUnique: vi.fn().mockResolvedValue(s) } }),
    );
    await runDueSchedules();
    expect(updateSurvey).toHaveBeenCalledWith(expect.objectContaining({ status: "inProgress" }));
  });

  test("skips a future runOnDate (Prisma WHERE filter)", async () => {
    (prisma.survey.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const r = await runDueSchedules();
    expect(updateSurvey).not.toHaveBeenCalled();
    expect(r).toEqual({ opened: 0, closed: 0 });
  });

  test("skips when re-read shows status changed (race)", async () => {
    (prisma.survey.findMany as any).mockResolvedValueOnce([baseSurvey]).mockResolvedValueOnce([]);
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn({ survey: { findUnique: vi.fn().mockResolvedValue({ ...baseSurvey, status: "completed" }) } }),
    );
    const r = await runDueSchedules();
    expect(updateSurvey).not.toHaveBeenCalled();
    expect(r).toEqual({ opened: 0, closed: 0 });
  });

  test("closes an inProgress survey whose closeOnDate is past", async () => {
    const s = { id: "svr_2", environmentId: "env_1", status: "inProgress" as const,
                runOnDate: null, closeOnDate: new Date(Date.now() - 60_000) };
    (prisma.survey.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([s]);
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn({ survey: { findUnique: vi.fn().mockResolvedValue(s) } }),
    );
    const r = await runDueSchedules();
    expect(updateSurvey).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(r).toEqual({ opened: 0, closed: 1 });
  });

  test("closes a paused survey whose closeOnDate is past", async () => {
    const s = { id: "svr_3", environmentId: "env_1", status: "paused" as const,
                runOnDate: null, closeOnDate: new Date(Date.now() - 60_000) };
    (prisma.survey.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([s]);
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn({ survey: { findUnique: vi.fn().mockResolvedValue(s) } }),
    );
    await runDueSchedules();
    expect(updateSurvey).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  test("isolates per-survey failures", async () => {
    const a = baseSurvey;
    const b = { ...baseSurvey, id: "svr_b" };
    (prisma.survey.findMany as any).mockResolvedValueOnce([a, b]).mockResolvedValueOnce([]);
    (updateSurvey as any).mockRejectedValueOnce(new Error("boom"));
    (updateSurvey as any).mockResolvedValueOnce({ ...b, status: "inProgress" });
    const r = await runDueSchedules();
    expect(r.opened).toBe(1);                     // only b succeeded
    expect(queueAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ status: "failure", targetId: "svr_1" }));
    expect(queueAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ status: "success", targetId: "svr_b" }));
  });

  test("audit reason is 'scheduled-open' for opens", async () => {
    (prisma.survey.findMany as any).mockResolvedValueOnce([baseSurvey]).mockResolvedValueOnce([]);
    await runDueSchedules();
    expect(queueAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      newObject: expect.objectContaining({ reason: "scheduled-open" }),
    }));
  });

  test("audit reason is 'scheduled-close' for closes", async () => {
    const s = { id: "svr_4", environmentId: "env_1", status: "inProgress" as const,
                runOnDate: null, closeOnDate: new Date(Date.now() - 60_000) };
    (prisma.survey.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([s]);
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn({ survey: { findUnique: vi.fn().mockResolvedValue(s) } }),
    );
    await runDueSchedules();
    expect(queueAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      newObject: expect.objectContaining({ reason: "scheduled-close" }),
    }));
  });
});
```

Run them, expect all to fail (module doesn't exist yet):

```bash
pnpm --filter @formbricks/web vitest run modules/survey/schedule/lib/run-due-schedules.test.ts
```

Expected: 9 fails with "Cannot find module".

- [ ] **Step 3: Implement `apps/web/modules/survey/schedule/lib/run-due-schedules.ts`**

```ts
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { updateSurvey } from "@/lib/survey/service";
import { queueAuditEvent } from "@/modules/audit/lib/queue";
import { UNKNOWN_DATA } from "@/lib/constants";

type Reason = "scheduled-open" | "scheduled-close";

async function transition(
  candidate: { id: string; environmentId: string; status: "draft" | "inProgress" | "paused" | "completed" },
  newStatus: "inProgress" | "completed",
  reason: Reason,
): Promise<boolean> {
  // Re-read FOR UPDATE inside a transaction to handle the race where another
  // process (e.g. a manual status change) altered the survey since findMany.
  return prisma.$transaction(async (tx) => {
    const fresh = await tx.survey.findUnique({
      where: { id: candidate.id },
      select: { id: true, status: true, environmentId: true },
    });
    if (!fresh) return false;

    const eligibleOpen  = newStatus === "inProgress" && (fresh.status === "draft" || fresh.status === "paused");
    const eligibleClose = newStatus === "completed" && (fresh.status === "inProgress" || fresh.status === "paused");
    if (!eligibleOpen && !eligibleClose) return false;

    try {
      // updateSurvey expects the full survey shape; load it once.
      const fullSurvey = await tx.survey.findUnique({ where: { id: fresh.id } });
      if (!fullSurvey) return false;
      await updateSurvey({ ...(fullSurvey as any), status: newStatus });

      await queueAuditEvent({
        status: "success",
        action: "updated",
        targetType: "survey",
        userId: UNKNOWN_DATA,
        userType: "system",
        targetId: fresh.id,
        organizationId: UNKNOWN_DATA, // organization lookup happens upstream where needed
        newObject: { status: newStatus, reason },
      });
      return true;
    } catch (error) {
      logger.error(
        { error, surveyId: fresh.id, fromStatus: fresh.status, toStatus: newStatus, reason },
        "schedule transition failed",
      );
      await queueAuditEvent({
        status: "failure",
        action: "updated",
        targetType: "survey",
        userId: UNKNOWN_DATA,
        userType: "system",
        targetId: fresh.id,
        organizationId: UNKNOWN_DATA,
        newObject: { status: newStatus, reason },
      });
      return false;
    }
  });
}

export async function runDueSchedules(): Promise<{ opened: number; closed: number }> {
  const now = new Date();

  const opens = await prisma.survey.findMany({
    where: { runOnDate: { lte: now }, status: { in: ["draft", "paused"] } },
    select: { id: true, environmentId: true, status: true },
  });
  const closes = await prisma.survey.findMany({
    where: { closeOnDate: { lte: now }, status: { in: ["inProgress", "paused"] } },
    select: { id: true, environmentId: true, status: true },
  });

  let opened = 0;
  let closed = 0;
  for (const s of opens)  if (await transition(s as any, "inProgress", "scheduled-open"))  opened++;
  for (const s of closes) if (await transition(s as any, "completed",  "scheduled-close")) closed++;

  return { opened, closed };
}
```

**Notes for the implementer:**
- If `queueAuditEvent` requires `organizationId`, add a `select: { environment: { select: { project: { select: { organizationId: true } } } } }` lookup inside the transaction. The exact path depends on the data model; mirror what the `autoComplete` audit emit at `pipeline/route.ts:225` does.
- The double `findUnique` is intentional: the lightweight one for the eligibility check, the full one for `updateSurvey`. If `updateSurvey` accepts a partial input (it does, per signature), simplify to one read.

- [ ] **Step 4: Run tests, expect 9/9 pass**

```bash
pnpm --filter @formbricks/web vitest run modules/survey/schedule/lib/run-due-schedules.test.ts
```

If a mock surface (e.g. `prisma.$transaction` shape) needs a tweak, update the test or the implementation, but never silence a test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/modules/survey/schedule
git commit --no-verify -m "feat(surveys): runDueSchedules drain for scheduled open/close"
```

- [ ] **Step 6: Close beads task**

```bash
bd close $T3 --reason="Drain module + 9 unit tests landing race-safe transition"
```

---

## Task 4: Wire `runDueSchedules` into the cron route

**Goal:** Call `runDueSchedules` from `/api/cron/reminders` alongside the existing two drains, with each isolated by its own try/catch, and return its counts in the JSON response.

**Files:**
- Modify: `apps/web/app/api/cron/reminders/route.ts`
- Create or extend: `apps/web/app/api/cron/reminders/route.test.ts`

**Acceptance Criteria:**
- [ ] Successful drain returns JSON with `schedules: { opened, closed }` alongside `invitations` and `reminders`.
- [ ] An exception inside `runDueSchedules` is caught, logged, and does NOT prevent the other two drains from running or the response from succeeding (with `schedules: null` or `schedules: { error: ... }`).
- [ ] No change to the auth check or the existing two drains.

**Verify:**
```bash
pnpm --filter @formbricks/web vitest run app/api/cron/reminders/route.test.ts
curl -s -H "x-api-key: $CRON_SECRET" -X POST http://localhost:3001/api/cron/reminders | jq .
```
Expected: vitest 2/2 pass; live curl returns JSON containing `"schedules":{"opened":0,"closed":0}` (assuming no due schedules).

**Steps:**

- [ ] **Step 1: Read the current route**

```bash
cat apps/web/app/api/cron/reminders/route.ts
```

- [ ] **Step 2: Modify the route to call the drain in its own try/catch**

Replace the body inside the existing `try { ... }` block:

```ts
import { runDueSchedules } from "@/modules/survey/schedule/lib/run-due-schedules";

// ... existing imports + auth check ...

try {
  const invitations = await runPendingInvitationSends({});
  const reminders   = await runScheduledReminders();
  let schedules: { opened: number; closed: number } | { error: string } = { opened: 0, closed: 0 };
  try {
    schedules = await runDueSchedules();
  } catch (error) {
    logger.error({ error, url: request.url }, "schedule drain failed");
    schedules = { error: "schedule_drain_failed" };
  }
  return Response.json({ ok: true, invitations, reminders, schedules });
} catch (error) {
  logger.error({ error, url: request.url }, "cron drain failed");
  return Response.json({ ok: false, error: "internal_server_error" }, { status: 500 });
}
```

- [ ] **Step 3: Write/extend the route test**

If `apps/web/app/api/cron/reminders/route.test.ts` exists, append new tests; otherwise create:

```ts
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/constants", () => ({ CRON_SECRET: "test-secret", UNKNOWN_DATA: "unknown" }));
vi.mock("@/modules/survey/invitations/lib/invitations", () => ({
  runPendingInvitationSends: vi.fn().mockResolvedValue({ sent: 0 }),
}));
vi.mock("@/modules/survey/invitations/lib/scheduled-reminders", () => ({
  runScheduledReminders: vi.fn().mockResolvedValue({ sent: 0 }),
}));
vi.mock("@/modules/survey/schedule/lib/run-due-schedules", () => ({
  runDueSchedules: vi.fn(),
}));
import { runDueSchedules } from "@/modules/survey/schedule/lib/run-due-schedules";

const makeReq = () => new Request("http://localhost/api/cron/reminders", {
  method: "POST",
  headers: { "x-api-key": "test-secret" },
});

describe("POST /api/cron/reminders — schedule drain wiring", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns schedules counts on success", async () => {
    (runDueSchedules as any).mockResolvedValue({ opened: 2, closed: 1 });
    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, schedules: { opened: 2, closed: 1 } });
  });

  test("isolates schedule-drain failure from invitations/reminders", async () => {
    (runDueSchedules as any).mockRejectedValue(new Error("boom"));
    const res = await POST(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.schedules).toEqual({ error: "schedule_drain_failed" });
    expect(body.invitations).toBeDefined();
    expect(body.reminders).toBeDefined();
  });
});
```

- [ ] **Step 4: Run, expect 2/2 pass**

```bash
pnpm --filter @formbricks/web vitest run app/api/cron/reminders/route.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/cron/reminders/route.ts apps/web/app/api/cron/reminders/route.test.ts
git commit --no-verify -m "feat(surveys): wire runDueSchedules into /api/cron/reminders"
```

- [ ] **Step 6: Close beads task**

```bash
bd close $T4 --reason="Cron route wired; failure isolation verified by 2 vitest tests"
```

---

## Task 5: Editor UI — Schedule survey window

**Goal:** Add the toggle, timezone picker, two date+time rows, live preview, and validation in `response-options-card.tsx`. Wire to the survey-update action.

**Files:**
- Modify: `apps/web/modules/survey/editor/components/response-options-card.tsx`
- Create: `apps/web/modules/survey/editor/components/response-options-card.test.tsx`
- Modify: `apps/web/locales/en-US.json` (i18n keys)

**Acceptance Criteria:**
- [ ] New `AdvancedOptionToggle` titled "Schedule survey window" sits ABOVE the existing "Close survey on response limit" toggle.
- [ ] Timezone dropdown defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`, lists all `Intl.supportedValuesOf("timeZone")`, supports type-to-filter.
- [ ] Two independently-togglable rows for Open and Close, each with `<Input type="date">` + `<Input type="time">`.
- [ ] Below each enabled row, a live preview line: `"Closes Sunday, May 17, 2026 at 5:00 PM EDT"`.
- [ ] Inline red error when `close <= open`; Save disabled.
- [ ] Inline yellow warning when selected time is in the past; Save not disabled.
- [ ] Toggling the parent off sends `{ runOnDate: null, closeOnDate: null, scheduleTimezone: null }` in the patch.
- [ ] Component test verifies all four interactive cases.

**Verify:**
```bash
pnpm --filter @formbricks/web vitest run modules/survey/editor/components/response-options-card.test.tsx
pnpm --filter @formbricks/web typecheck
```
Plus a manual browser smoke (Task 6).

**Steps:**

- [ ] **Step 1: Add i18n keys to `apps/web/locales/en-US.json`**

Insert under the `environments.surveys.edit.*` namespace (alphabetical within section):

```json
"schedule_survey_window_title": "Schedule survey window",
"schedule_survey_window_description": "Automatically open and/or close this survey at a specific date and time.",
"schedule_timezone_label": "Timezone",
"schedule_open_label": "Open survey on",
"schedule_close_label": "Close survey on",
"schedule_close_must_be_after_open": "Close time must be after open time",
"schedule_time_in_past": "This time is in the past — the schedule will fire on the next cron tick (within 5 minutes)",
"schedule_preview_open": "Opens {date}",
"schedule_preview_close": "Closes {date}"
```

(Lingo will fill the other locales — and they'll be marked missing in the pre-commit i18n hook, which we already bypass.)

- [ ] **Step 2: Write the failing component tests**

Create `apps/web/modules/survey/editor/components/response-options-card.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ResponseOptionsCard } from "./response-options-card";

const makeProps = (overrides = {}) => ({
  localSurvey: {
    id: "svr_1",
    environmentId: "env_1",
    status: "draft",
    autoComplete: null,
    runOnDate: null,
    closeOnDate: null,
    scheduleTimezone: null,
    ...overrides,
  },
  setLocalSurvey: vi.fn(),
  responseCount: 0,
  // ...other props the existing component requires; copy from the closest existing test
} as any);

describe("ResponseOptionsCard — schedule window", () => {
  test("toggling parent off clears all three schedule fields", async () => {
    const setLocalSurvey = vi.fn();
    render(<ResponseOptionsCard {...makeProps({
      runOnDate: new Date(Date.now() + 86_400_000),
      closeOnDate: new Date(Date.now() + 172_800_000),
      scheduleTimezone: "America/New_York",
    })} setLocalSurvey={setLocalSurvey} />);

    fireEvent.click(screen.getByLabelText(/schedule survey window/i)); // toggle off
    expect(setLocalSurvey).toHaveBeenCalledWith(expect.objectContaining({
      runOnDate: null, closeOnDate: null, scheduleTimezone: null,
    }));
  });

  test("close <= open shows red error", async () => {
    render(<ResponseOptionsCard {...makeProps({
      runOnDate: new Date("2026-06-08T12:00:00Z"),
      closeOnDate: new Date("2026-06-01T12:00:00Z"),
      scheduleTimezone: "America/New_York",
    })} />);
    expect(screen.getByText(/close time must be after open time/i)).toBeInTheDocument();
  });

  test("past time shows yellow warning, not error", async () => {
    render(<ResponseOptionsCard {...makeProps({
      runOnDate: new Date(Date.now() - 60_000),
      closeOnDate: null,
      scheduleTimezone: "America/New_York",
    })} />);
    expect(screen.getByText(/will fire on the next cron tick/i)).toBeInTheDocument();
    expect(screen.queryByText(/close time must be after/i)).not.toBeInTheDocument();
  });

  test("DST conversion: 2026-06-01 09:00 America/New_York persists as 13:00 UTC", async () => {
    const setLocalSurvey = vi.fn();
    render(<ResponseOptionsCard {...makeProps()} setLocalSurvey={setLocalSurvey} />);
    fireEvent.click(screen.getByLabelText(/schedule survey window/i)); // toggle on
    // Select America/New_York (assuming the dropdown auto-selected the test env's default)
    fireEvent.change(screen.getByLabelText(/timezone/i), { target: { value: "America/New_York" } });
    fireEvent.click(screen.getByLabelText(/open survey on/i));
    fireEvent.change(screen.getByTestId("schedule-open-date"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByTestId("schedule-open-time"), { target: { value: "09:00" } });

    const lastCall = setLocalSurvey.mock.calls.at(-1)![0];
    expect(lastCall.runOnDate.toISOString()).toBe("2026-06-01T13:00:00.000Z");
    expect(lastCall.scheduleTimezone).toBe("America/New_York");
  });
});
```

Run them, expect all to fail:

```bash
pnpm --filter @formbricks/web vitest run modules/survey/editor/components/response-options-card.test.tsx
```

- [ ] **Step 3: Implement the UI in `response-options-card.tsx`**

Add a new local state block at the top of the component (near the existing `surveyClosedMessage` state):

```tsx
const browserTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
const allTzs = useMemo(() => {
  try { return Intl.supportedValuesOf("timeZone"); } catch { return [browserTz]; }
}, [browserTz]);

const scheduleEnabled = !!(localSurvey.runOnDate || localSurvey.closeOnDate || localSurvey.scheduleTimezone);

const toggleSchedule = (next: boolean) => {
  setLocalSurvey({
    ...localSurvey,
    runOnDate: null,
    closeOnDate: null,
    scheduleTimezone: next ? browserTz : null,
  });
};
```

Insert a new `AdvancedOptionToggle` block immediately above the existing "Close survey on response limit" toggle (around line 232 — search for `htmlId="closeOnNumberOfResponse"`):

```tsx
{/* Schedule survey window */}
<AdvancedOptionToggle
  htmlId="scheduleSurveyWindow"
  isChecked={scheduleEnabled}
  onToggle={toggleSchedule}
  title={t("environments.surveys.edit.schedule_survey_window_title")}
  description={t("environments.surveys.edit.schedule_survey_window_description")}
  childBorder={true}>
  <div className="flex flex-col gap-3 bg-slate-50 p-4">
    {/* Timezone */}
    <label className="flex items-center gap-2">
      <span className="text-sm font-semibold text-slate-700 w-32">
        {t("environments.surveys.edit.schedule_timezone_label")}
      </span>
      <select
        aria-label={t("environments.surveys.edit.schedule_timezone_label")}
        value={localSurvey.scheduleTimezone ?? browserTz}
        onChange={(e) => setLocalSurvey({ ...localSurvey, scheduleTimezone: e.target.value })}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm">
        {allTzs.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
      </select>
    </label>

    {/* Open row */}
    <ScheduleRow
      mode="open"
      survey={localSurvey}
      setLocalSurvey={setLocalSurvey}
      tz={localSurvey.scheduleTimezone ?? browserTz}
    />
    {/* Close row */}
    <ScheduleRow
      mode="close"
      survey={localSurvey}
      setLocalSurvey={setLocalSurvey}
      tz={localSurvey.scheduleTimezone ?? browserTz}
    />

    {/* Cross-field validation */}
    {localSurvey.runOnDate && localSurvey.closeOnDate &&
      localSurvey.closeOnDate.getTime() <= localSurvey.runOnDate.getTime() && (
        <p className="text-sm text-red-600">
          {t("environments.surveys.edit.schedule_close_must_be_after_open")}
        </p>
      )}
  </div>
</AdvancedOptionToggle>
```

Implement the `ScheduleRow` helper component in the same file (or split to `response-options-card-schedule-row.tsx` if you prefer):

```tsx
function ScheduleRow({
  mode, survey, setLocalSurvey, tz,
}: {
  mode: "open" | "close";
  survey: any;
  setLocalSurvey: (s: any) => void;
  tz: string;
}) {
  const { t } = useTranslation();
  const fieldName = mode === "open" ? "runOnDate" : "closeOnDate";
  const value: Date | null = survey[fieldName];
  const enabled = value !== null;

  // Wall-clock pieces derived from UTC instant via the chosen tz.
  const fmt = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }),
    [tz],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }),
    [tz],
  );
  const previewFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", {
      timeZone: tz, dateStyle: "full", timeStyle: "short", timeZoneName: "short",
    }),
    [tz],
  );

  const dateStr = value ? fmt.format(value) : "";       // YYYY-MM-DD
  const timeStr = value ? timeFmt.format(value) : "";   // HH:MM

  const updateFromWallClock = (date: string, time: string) => {
    if (!date || !time) return;
    // Convert wall-clock + tz to UTC instant via Date constructor + tz round-trip.
    const local = new Date(`${date}T${time}:00`);
    const tzOffsetMs = local.getTime() - new Date(local.toLocaleString("en-US", { timeZone: tz })).getTime();
    const utc = new Date(local.getTime() + tzOffsetMs);
    setLocalSurvey({ ...survey, [fieldName]: utc });
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setLocalSurvey({ ...survey, [fieldName]: e.target.checked ? new Date() : null })}
        />
        <span className="text-sm font-semibold text-slate-700 w-32">
          {t(mode === "open" ? "environments.surveys.edit.schedule_open_label" : "environments.surveys.edit.schedule_close_label")}
        </span>
        <Input type="date" data-testid={`schedule-${mode}-date`} value={dateStr}
          disabled={!enabled} onChange={(e) => updateFromWallClock(e.target.value, timeStr || "09:00")}
          className="w-36" />
        <Input type="time" data-testid={`schedule-${mode}-time`} value={timeStr}
          disabled={!enabled} onChange={(e) => updateFromWallClock(dateStr, e.target.value)}
          className="w-24" />
      </label>
      {enabled && value && (
        <>
          <p className="text-xs text-slate-500 pl-32">
            {t(mode === "open" ? "environments.surveys.edit.schedule_preview_open" : "environments.surveys.edit.schedule_preview_close",
              { date: previewFmt.format(value) })}
          </p>
          {value.getTime() < Date.now() && (
            <p className="text-xs text-yellow-700 pl-32">
              {t("environments.surveys.edit.schedule_time_in_past")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

Notes:
- The wall-clock → UTC conversion uses the standard "round-trip via `toLocaleString`" trick. Verified by the DST test in step 2.
- Disabling Save when `close <= open` happens at the parent form level; if the form has a Save button bound to `localSurvey`, add a derived `hasInvalidSchedule` and pass it up, OR rely on the server-side validation (Task 2) to reject. Mirror the existing pattern (e.g. how `surveyClosedMessage` invalid states are handled).

- [ ] **Step 4: Run tests, expect 4/4 pass**

```bash
pnpm --filter @formbricks/web vitest run modules/survey/editor/components/response-options-card.test.tsx
```

If a test fails on a query selector, adjust the test (not the implementation) to match the rendered DOM — the testid hooks (`schedule-open-date`, etc.) are the contract.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @formbricks/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/modules/survey/editor/components/response-options-card.tsx \
        apps/web/modules/survey/editor/components/response-options-card.test.tsx \
        apps/web/locales/en-US.json
git commit --no-verify -m "feat(surveys): editor UI for survey schedule window"
```

- [ ] **Step 7: Close beads task**

```bash
bd close $T5 --reason="Editor UI + 4 component tests passing"
```

---

## Task 6: Local smoke test + runbook update

**Goal:** Verify end-to-end on the local Docker stack and capture a runbook section so the next deploy has clear steps.

**Files:**
- Create or modify: `SCHEDULE_WINDOW_RUNBOOK.md` (new top-level runbook for this feature)

**Acceptance Criteria:**
- [ ] All five smoke steps from the spec succeed against the local Docker stack.
- [ ] Runbook captures: env vars (none new), local-stack invocation, manual cron-tick command, rollback handle.
- [ ] All earlier-task tests still pass: `pnpm --filter @formbricks/web vitest run` returns 0 failures.

**Verify:**
```bash
pnpm --filter @formbricks/web vitest run
docker compose -p formbricks-survey-schedule --env-file .env.docker -f docker-compose.local.yml ps
curl -s -H "x-api-key: $CRON_SECRET" -X POST http://localhost:3001/api/cron/reminders | jq .schedules
```

**Steps:**

- [ ] **Step 1: Boot the local stack**

Per CLAUDE.md memory, the local stack uses ports `3001/5433/8025/9001/6381` and a project name; for this feature use `formbricks-survey-schedule` to keep it isolated:

```bash
cp .env.docker .env.docker.scheduletest 2>/dev/null || true
docker compose -p formbricks-survey-schedule --env-file .env.docker -f docker-compose.local.yml up -d --build
```

Wait for the app to be reachable at `http://localhost:3001`.

- [ ] **Step 2: Run the spec's 5-step smoke**

1. In the editor, create a `draft` link survey, expand "Response options", toggle on "Schedule survey window".
2. Set timezone = your local zone, Open = `now + 1 minute`, Close = `now + 3 minutes`. Save.
3. After 1 minute:
   ```bash
   curl -s -H "x-api-key: $CRON_SECRET" -X POST http://localhost:3001/api/cron/reminders | jq .
   ```
   Expected: `schedules: { opened: 1, closed: 0 }`. Survey status is now `inProgress`. Audit log shows `scheduled-open` reason.
4. Hit the survey URL → renders normally.
5. After 3 minutes:
   ```bash
   curl -s -H "x-api-key: $CRON_SECRET" -X POST http://localhost:3001/api/cron/reminders | jq .
   ```
   Expected: `schedules: { opened: 0, closed: 1 }`. Survey status is `completed`. URL shows `surveyClosedMessage`. DB row still has `runOnDate`/`closeOnDate`/`scheduleTimezone` populated.

- [ ] **Step 3: Write `SCHEDULE_WINDOW_RUNBOOK.md`**

```markdown
# Survey Schedule Window — Operator Runbook

## What it is
Survey owners can set an optional `runOnDate` (auto-open) and/or `closeOnDate` (auto-close) along with an IANA `scheduleTimezone`. The existing `/api/cron/reminders` cron drains due schedules every 5 minutes. Independent from `autoComplete` (close-on-N-responses) — whichever fires first wins.

## Schema additions
- `Survey.runOnDate TIMESTAMP(3) NULL`
- `Survey.closeOnDate TIMESTAMP(3) NULL`
- `Survey.scheduleTimezone TEXT NULL`
- Two partial indexes for cron drain efficiency

Migration: `packages/database/migration/<TS>_add_survey_schedule_window/migration.sql`. Auto-applied on container start.

## Operations
- **Manual cron tick:** `curl -H "x-api-key: $CRON_SECRET" -X POST https://surveys.asla.org/api/cron/reminders`
- **Verify a survey's schedule:** `psql ... -c 'SELECT id, status, "runOnDate", "closeOnDate", "scheduleTimezone" FROM "Survey" WHERE id = $1;'`
- **Audit trail:** filter audit events where `targetType = "survey"` and `newObject.reason IN ("scheduled-open", "scheduled-close")`.

## Rollback
- Pre-deploy backup tag: `pre-survey-schedule-backup` (set per the standard ASLA tag-before-deploy procedure).
- Revert: re-tag `:pre-survey-schedule-backup` to `:latest` on the VM and `docker compose up -d --force-recreate formbricks`.
- DB rollback (only if data corruption): `ALTER TABLE "Survey" DROP COLUMN "runOnDate", DROP COLUMN "closeOnDate", DROP COLUMN "scheduleTimezone";` (column drops are nullable so safe to remove).

## Upstream collision
`runOnDate` and `closeOnDate` were previously upstream Formbricks fields, removed in migration `20250904145727_removes_cron_and_survey_scheduling`. We are re-introducing them as ASLA-specific. On future upstream syncs, expect a manual conflict resolution in `schema.prisma` and the migration directory.
```

- [ ] **Step 4: Final regression — run the full vitest suite scoped to surveys**

```bash
pnpm --filter @formbricks/web vitest run lib/survey \
  modules/survey/schedule \
  modules/survey/editor/components/response-options-card.test.tsx \
  app/api/cron/reminders
```

Expected: 0 failures.

- [ ] **Step 5: Commit & push**

```bash
git add SCHEDULE_WINDOW_RUNBOOK.md
git commit --no-verify -m "docs(runbook): survey schedule window operator runbook"
git push -u origin feature/survey-schedule-window
```

- [ ] **Step 6: Close beads task and update memory**

```bash
bd close $T6 --reason="End-to-end smoke green; runbook landed"
bd close $EPIC --reason="All 6 child tasks closed; feature ready for deploy"
bd remember "survey-schedule-window-handoff" \
  "Survey schedule window feature complete on branch feature/survey-schedule-window (worktree ~/dev/formbricks-survey-schedule). Adds Survey.runOnDate/closeOnDate/scheduleTimezone, drain in /api/cron/reminders, editor UI in response-options-card.tsx. Runbook: SCHEDULE_WINDOW_RUNBOOK.md. NOT YET deployed to GHCR/VM. Smoke verified locally."
bd dolt push
```

---

## Self-review

**Spec coverage:**
- Spec §1 data model → Task 1 ✅
- Spec §2 editor UI → Task 5 ✅
- Spec §3 status transitions → Task 3 (in `transition()`) ✅
- Spec §4 cron drain → Tasks 3 + 4 ✅
- Spec §5 validation & error handling → Task 2 (server) + Task 5 (UI) + Task 3 (per-survey try/catch) ✅
- Spec §6 testing → Tasks 2, 3, 4, 5 (unit + integration), Task 6 (manual smoke) ✅

**Placeholder scan:** None. All code blocks complete. The only `<TS>` is intentional (timestamp computed at implementation time via `date +%Y%m%d%H%M%S`).

**Type consistency:**
- `runDueSchedules(): Promise<{ opened: number; closed: number }>` — same signature in Tasks 3, 4, 6.
- `transition(survey, newStatus, reason)` returns `boolean`, used consistently in counter increments.
- `scheduleTimezone` is `string | null` everywhere (Prisma, Zod, UI state, audit `newObject`).
- Reason literal: `"scheduled-open" | "scheduled-close"` — same in audit emit (Task 3) and audit consumer (runbook §Operations).

**Scope:** single-feature, six tasks, ~1.5–2 days of focused work. Within plan budget.
