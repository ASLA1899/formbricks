# Survey Schedule Window — Operator Runbook

## What it is

Survey owners can set an optional `runOnDate` (auto-open) and/or `closeOnDate` (auto-close) along with an IANA `scheduleTimezone`. The existing `/api/cron/reminders` cron drains due schedules every 5 minutes. Independent from `autoComplete` (close-on-N-responses) — whichever fires first wins.

Status transitions:
- `runOnDate` ≤ now: `draft` or `paused` → `inProgress`
- `closeOnDate` ≤ now: `inProgress` or `paused` → `completed`
- Already-`completed` surveys are never auto-reopened.

Idempotency comes from the status leaving the eligible set after the transition. There is no "hasFired" flag.

## Schema additions

- `Survey.runOnDate         TIMESTAMP(3) NULL`
- `Survey.closeOnDate       TIMESTAMP(3) NULL`
- `Survey.scheduleTimezone  TEXT          NULL`
- Two partial indexes (`Survey_runOnDate_idx`, `Survey_closeOnDate_idx`) for cron-drain efficiency.

Migration: `packages/database/migration/<timestamp>_add_survey_schedule_window/migration.sql`. Auto-applied on container startup per the standard ASLA migration runner.

## Operations

**Manual cron tick (force a drain):**
```bash
curl -H "x-api-key: $CRON_SECRET" -X POST https://surveys.asla.org/api/cron/reminders | jq .schedules
# expected: { "opened": <n>, "closed": <m> } or { "error": "schedule_drain_failed" }
```

**Verify a survey's schedule:**
```sql
SELECT id, name, status, "runOnDate", "closeOnDate", "scheduleTimezone"
FROM "Survey"
WHERE id = '<survey-id>';
```

**Audit trail:**
The drain emits standard audit events with `userType = "system"`, `targetType = "survey"`, and `newObject.reason ∈ ("scheduled-open", "scheduled-close")`. Filter by these to distinguish auto-transitions from manual or response-count-based ones.

## Local smoke (5-step manual test)

1. In the editor, create a `draft` link survey, expand "Response options", toggle on "Schedule survey window".
2. Set timezone = your local zone, Open = `now + 1 minute`, Close = `now + 3 minutes`. Save.
3. After 1 minute:
   ```bash
   curl -s -H "x-api-key: $CRON_SECRET" -X POST http://localhost:3001/api/cron/reminders | jq .
   ```
   Expected: `schedules: { opened: 1, closed: 0 }`. Survey status is now `inProgress`. Audit log shows `reason: "scheduled-open"`.
4. Hit the survey URL → renders normally.
5. Trigger cron again after 3 minutes:
   ```bash
   curl -s -H "x-api-key: $CRON_SECRET" -X POST http://localhost:3001/api/cron/reminders | jq .
   ```
   Expected: `schedules: { opened: 0, closed: 1 }`. Survey status is `completed`. URL shows the `surveyClosedMessage`. The `runOnDate`/`closeOnDate`/`scheduleTimezone` columns remain populated for audit.

## Rollback

- Pre-deploy backup tag: tag the running image as `pre-survey-schedule-backup` BEFORE re-tagging `:latest`.
- Image revert: `docker tag ghcr.io/asla1899/formbricks:pre-survey-schedule-backup ghcr.io/asla1899/formbricks:latest && docker compose up -d --force-recreate formbricks`.
- DB rollback (only if absolutely needed — the columns are nullable and harmless):
  ```sql
  DROP INDEX IF EXISTS "Survey_runOnDate_idx";
  DROP INDEX IF EXISTS "Survey_closeOnDate_idx";
  ALTER TABLE "Survey" DROP COLUMN IF EXISTS "runOnDate";
  ALTER TABLE "Survey" DROP COLUMN IF EXISTS "closeOnDate";
  ALTER TABLE "Survey" DROP COLUMN IF EXISTS "scheduleTimezone";
  ```

## Upstream collision

`runOnDate` and `closeOnDate` were previously upstream Formbricks fields, removed by their migration `20250904145727_removes_cron_and_survey_scheduling`. ASLA reintroduces them with the same names. Future upstream syncs will likely need a manual conflict resolution in `schema.prisma` and the migration directory. The drain module (`apps/web/modules/survey/schedule/lib/run-due-schedules.ts`) is ASLA-only — no upstream equivalent exists.
