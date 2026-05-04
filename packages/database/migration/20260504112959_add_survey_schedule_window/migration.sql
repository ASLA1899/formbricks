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
