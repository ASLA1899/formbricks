# Survey Schedule Window — Design

**Date:** 2026-05-04
**Author:** Greg Cohen (ASLA fork)
**Status:** Approved (brainstorm) → ready for plan

## Summary

Add an optional **scheduled open/close window** to surveys. A user can pick a date, time, and IANA timezone for when the survey should automatically open and/or close. Enforcement piggybacks on the existing `/api/cron/reminders` 5-minute cron. The existing `autoComplete` (close-on-N-responses) feature is unchanged and runs in parallel — whichever close trigger fires first wins.

## Motivation

Today, ASLA staff manually flip survey status from `draft` → `inProgress` and `inProgress` → `completed` at the right moments. For surveys tied to a member-vote deadline or a chapter-event window, the deadline is known in advance and human-clicked status changes are error-prone (forgot to close, closed in the wrong timezone, closed too early). Letting the survey carry its own schedule removes that operational toil.

## Scope

**In scope**

- New `Survey.runOnDate`, `Survey.closeOnDate`, `Survey.scheduleTimezone` fields.
- Editor UI to set the window (date + time + tz).
- Cron drain that auto-transitions status when scheduled times pass.
- Audit logging on every auto-transition (success and failure).
- Server-side validation (close > open, valid IANA tz).

**Out of scope**

- Email/Slack/in-app notification when a schedule fires (audit log only).
- Recurring schedules.
- Per-respondent timezone display on the survey-taker UI.
- Editing the schedule via the public survey API (link surveys are unaffected).

## Design

### 1. Data model

Three new optional fields on `Survey` (`packages/database/schema.prisma`):

```prisma
model Survey {
  // ... existing fields ...
  runOnDate         DateTime?  // UTC instant when the survey should auto-open. Null = no scheduled open.
  closeOnDate       DateTime?  // UTC instant when the survey should auto-close. Null = no scheduled close.
  scheduleTimezone  String?    // IANA tz used for editor display. Null when both timestamps are null.
}
```

**Why three columns vs. a JSON blob:** indexable for the cron query (`WHERE runOnDate <= now()`), Prisma-typed, no JSON shenanigans.

**Storage semantics:** `runOnDate` and `closeOnDate` are absolute UTC instants — same convention as `Survey.createdAt`. `scheduleTimezone` is *display-only* (round-trips the wall-clock the user typed). Conversion happens in the editor at save time.

**Migration**

New file: `packages/database/migration/<timestamp>-survey-schedule/migration.sql`. Adds three nullable columns plus two partial indexes:

```sql
ALTER TABLE "Survey"
  ADD COLUMN IF NOT EXISTS "runOnDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closeOnDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduleTimezone" TEXT;

CREATE INDEX IF NOT EXISTS "Survey_runOnDate_idx"
  ON "Survey" ("runOnDate") WHERE "runOnDate" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Survey_closeOnDate_idx"
  ON "Survey" ("closeOnDate") WHERE "closeOnDate" IS NOT NULL;
```

Backfill: nothing — all existing rows get NULL. Migration runner picks it up automatically on container start (per ASLA deploy convention).

**Zod / types** (`packages/types/surveys/types.ts`):

- Extend `ZSurvey` and `ZSurveyUpdateInput` with the three optional fields.
- `scheduleTimezone` validated at runtime against `Intl.supportedValuesOf("timeZone")` (Node 18+).
- Cross-field validation: if both timestamps are set, refine that `closeOnDate > runOnDate`.

### 2. Editor UI

One new toggle in `apps/web/modules/survey/editor/components/response-options-card.tsx`, positioned **above** the existing "Close survey on response limit" toggle.

**Toggle:**
- Label: "Schedule survey window"
- Description: "Automatically open and/or close this survey at a specific date and time."

**Expanded panel:**

```
┌─ Schedule survey window ───────────────────────────────┐
│  Timezone:  [ America/New_York            ▾ ]          │
│                                                        │
│  ☐  Open survey on   [ 2026-05-10 ] [ 09:00 ]          │
│  ☐  Close survey on  [ 2026-05-17 ] [ 17:00 ]          │
└────────────────────────────────────────────────────────┘
```

- **Timezone dropdown:** searchable IANA list. Default = `Intl.DateTimeFormat().resolvedOptions().timeZone` (browser zone). Single tz shared by both pickers.
- **Open/close rows:** independently togglable. Date + time use existing `<Input type="date">` / `<Input type="time">`.
- **Live preview** beneath each enabled row: `Closes Sunday, May 17, 2026 at 5:00 PM EDT` rendered via `Intl.DateTimeFormat`.
- **Inline validation:**
  - Both rows enabled and `close <= open` → red "Close time must be after open time", Save disabled.
  - Selected time already in the past → yellow "This time is in the past — the schedule will fire on the next cron tick (within 5 minutes)". Allowed, not blocked.
- **Persisted shape:** wall-clock + tz are component state; on save, the action receives `{ runOnDate: <UTC ISO>, closeOnDate: <UTC ISO>, scheduleTimezone: <IANA> }`.
- **Toggling the parent off** clears all three fields to `null`.

The existing `SurveyStatusDropdown` is unchanged — manual status changes still work and interact with an armed schedule per the rules in §3.

### 3. Status transition rules

Triggered exclusively by the cron drain. Manual status changes via the editor remain untouched.

| Trigger | Eligible from | Transition to |
|---------|---------------|---------------|
| `runOnDate` ≤ now | `draft`, `paused` | `inProgress` |
| `closeOnDate` ≤ now | `inProgress`, `paused` | `completed` |

Already-`completed` surveys are never auto-reopened. If a user manually re-opens a completed survey while `closeOnDate` is in the past, the next cron tick will close it again (declared close time wins — same idempotency model as `autoComplete`).

We do **not** store a "hasFired" flag. Idempotency comes from the status leaving the eligible set after the transition.

### 4. Cron drain

New module: `apps/web/modules/survey/schedule/lib/run-due-schedules.ts`.

```ts
export async function runDueSchedules(): Promise<{ opened: number; closed: number }> {
  const now = new Date();

  const opens = await prisma.survey.findMany({
    where: { runOnDate:   { lte: now }, status: { in: ["draft", "paused"] } },
    select: { id: true, status: true, environmentId: true, runOnDate: true },
  });
  const closes = await prisma.survey.findMany({
    where: { closeOnDate: { lte: now }, status: { in: ["inProgress", "paused"] } },
    select: { id: true, status: true, environmentId: true, closeOnDate: true },
  });

  let opened = 0;
  let closed = 0;
  for (const s of opens)  if (await transition(s, "inProgress", "scheduled-open"))  opened++;
  for (const s of closes) if (await transition(s, "completed",  "scheduled-close")) closed++;

  return { opened, closed };
}
```

`transition(survey, newStatus, reason)`:

1. Opens a `prisma.$transaction`, re-reads the survey `FOR UPDATE`, re-checks status is still in the eligible set (handles the "user manually flipped it 200ms ago" race).
2. Calls the existing `updateSurvey()` helper — same code path that `autoComplete` uses today (`apps/web/app/api/(internal)/pipeline/route.ts:208`). This gives us cache invalidation, real-time push, and follow-up triggers for free.
3. Emits `queueAuditEvent` with `action: "updated"`, `userType: "system"`, `targetType: "survey"`, and `metadata.reason = "scheduled-open" | "scheduled-close"`. On exception, emits the same payload with `status: "failure"`.
4. Returns `true` on success, `false` on skip or failure.

**Wiring** (`apps/web/app/api/cron/reminders/route.ts`):

```ts
const invitations = await runPendingInvitationSends({});
const reminders   = await runScheduledReminders();
const schedules   = await runDueSchedules();
return Response.json({ ok: true, invitations, reminders, schedules });
```

Each drain is awaited in its own try/catch — one failing doesn't block the others. The VM-side cron caller is unchanged (already firing every 5 min for invitations/reminders).

### 5. Validation & error handling

**Server-side**

- `closeOnDate > runOnDate` when both set → 422 with field-level error.
- `scheduleTimezone` must be a recognized IANA zone → 422.
- `scheduleTimezone` is auto-cleared to `null` when both timestamps are nulled (DB tidiness).
- No upper bound on schedule horizon. No lower bound — past times are accepted (fire on next tick).

**Cron drain**

- Per-survey try/catch around `transition()` — single failure doesn't block the batch.
- Failures logged via `@formbricks/logger` with `{ surveyId, fromStatus, toStatus, reason, error }`.
- Failure audit event emitted (matches the autoComplete failure path).
- Top-level drain failure returns `{ ok: false }` from the cron endpoint without affecting the other two drains.

**Race conditions**

- Manual close at the same moment as cron fire → `FOR UPDATE` re-check sees `completed`, skips. No-op.
- User clears `closeOnDate` mid-tick → the in-memory survey from `findMany` is stale, but the re-read inside `transition()` sees the updated row. Status check still passes, so the close fires once more. Same window exists for `autoComplete`. Acceptable.

### 6. Testing

**Unit (vitest)**

`apps/web/modules/survey/schedule/lib/run-due-schedules.test.ts`:
- `draft` + past `runOnDate` → `inProgress`, audit `scheduled-open`.
- `paused` + past `runOnDate` → `inProgress`.
- Future `runOnDate` → skip.
- `completed` + past `runOnDate` → skip (not eligible).
- `inProgress` + past `closeOnDate` → `completed`, audit `scheduled-close`.
- `paused` + past `closeOnDate` → `completed`.
- Same survey: past open AND past close → opens on tick N, closes on tick N+1 (verify same-tick ordering — opens loop runs first).
- One survey's `transition()` throws → others still process; failure logged + audited.
- Returns `{ opened, closed }` counts.

`apps/web/lib/survey/service.test.ts` (extend):
- `updateSurvey` rejects `closeOnDate <= runOnDate` (Zod).
- `updateSurvey` rejects unknown `scheduleTimezone`.
- `updateSurvey` clears `scheduleTimezone` when both timestamps null.

`apps/web/modules/survey/editor/components/response-options-card.test.tsx`:
- Toggling parent off clears all three fields in the patch.
- `close <= open` shows red error, Save disabled.
- Past time shows yellow warning, Save enabled.
- Fixture: `2026-06-01 09:00 America/New_York` produces patch with `runOnDate = "2026-06-01T13:00:00.000Z"` (DST math correct).

**Integration**

`apps/web/app/api/cron/reminders/route.test.ts` (extend or create):
- Response JSON contains `schedules: { opened, closed }` alongside `invitations` / `reminders`.
- `runDueSchedules` throwing doesn't prevent the other two drains.

**Manual smoke** (add to runbook on implementation):
1. Create `draft` link survey, set `runOnDate = now + 1 min`, `closeOnDate = now + 3 min`, tz = local.
2. `curl -H "x-api-key: $CRON_SECRET" -X POST http://localhost:3001/api/cron/reminders` after 1 min → status `inProgress`, audit shows `scheduled-open`.
3. Hit URL → renders.
4. Trigger cron again after 3 min → status `completed`, URL shows `surveyClosedMessage`.
5. DB row still has `runOnDate`/`closeOnDate`/`scheduleTimezone` populated (not auto-cleared on fire — kept for audit).

## Risks & open questions

- **Cron precision (≤5 min lag):** acceptable for ASLA scale. If precision needs tightening later, hybrid lazy-check inside the response pipeline is a 5-line addition.
- **DST transitions:** because we store UTC, DST handling falls entirely on the editor's wall-clock → UTC conversion at save time. `Intl.DateTimeFormat` handles this correctly. Verified by the fixture test above.
- **No backfill needed**, no breaking change to existing surveys, fully backwards-compatible.

## Non-goals reaffirmed

- No notifications when the schedule fires. Survey owners can subscribe to the audit log if they need an event stream.
- No recurring schedules. If/when needed, that's a separate feature with its own data model (`SurveyScheduleRule` table or similar).
- No survey-side timezone display for respondents — the closure page (`surveyClosedMessage`) is timezone-agnostic.

## Files touched (summary)

**New**
- `packages/database/migration/<timestamp>-survey-schedule/migration.sql`
- `apps/web/modules/survey/schedule/lib/run-due-schedules.ts`
- `apps/web/modules/survey/schedule/lib/run-due-schedules.test.ts`

**Modified**
- `packages/database/schema.prisma`
- `packages/types/surveys/types.ts` (Zod schemas)
- `packages/database/zod/surveys.ts` (Zod schemas, if separate)
- `apps/web/lib/survey/service.ts` (validation hook in `updateSurvey`)
- `apps/web/modules/survey/editor/components/response-options-card.tsx` (UI)
- `apps/web/app/api/cron/reminders/route.ts` (wire `runDueSchedules`)
- Translation files: i18n keys for the new toggle, labels, validation messages

**Tests added/extended**
- `apps/web/modules/survey/schedule/lib/run-due-schedules.test.ts` (new)
- `apps/web/lib/survey/service.test.ts` (extend)
- `apps/web/modules/survey/editor/components/response-options-card.test.tsx` (extend or create)
- `apps/web/app/api/cron/reminders/route.test.ts` (extend or create)
