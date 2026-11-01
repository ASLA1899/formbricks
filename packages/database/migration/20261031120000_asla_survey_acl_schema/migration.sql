-- ASLA fork only (ASL-1880, Formbricks upgrade 1.2-14a). Not an upstream migration.
--
-- Declares the fork's per-survey access objects to Prisma and maps them onto upstream's visibility.
-- On a database restored from the 4.9 fork these already exist (the 4.9 migration `add_survey_acl`, with
-- the type and column renamed by 20261002115900), so every statement is guarded and the DDL is a no-op
-- there. On a fresh database it creates them.
--
--   enum   "SurveyAccessMode" ('private','public')
--   column "Survey"."accessMode"
--   table  "SurveyAccess" ("surveyId","userId","created_at")   -- the per-person shares
--
-- Mapping: upstream "visibility" follows "accessMode" (private -> restricted, public -> workspace) so the
-- survey outbox trigger projects `survey#private_owner` / `survey#shared_workspace` for each survey.
-- Only "visibility" is written; versions are left as they are, so the projector (or the authzed backfill)
-- reconciles from the row. Rows already in agreement are not touched. Idempotent.

SET lock_timeout = '1s';

DO $$
BEGIN
  CREATE TYPE "SurveyAccessMode" AS ENUM ('private', 'public');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Survey" ADD COLUMN IF NOT EXISTS "accessMode" "SurveyAccessMode" NOT NULL DEFAULT 'private';

CREATE TABLE IF NOT EXISTS "SurveyAccess" (
    "surveyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurveyAccess_pkey" PRIMARY KEY ("surveyId","userId")
);

CREATE INDEX IF NOT EXISTS "SurveyAccess_userId_idx" ON "SurveyAccess"("userId");

DO $$
BEGIN
  ALTER TABLE "SurveyAccess" ADD CONSTRAINT "SurveyAccess_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "SurveyAccess" ADD CONSTRAINT "SurveyAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE "Survey"
SET "visibility" = CASE "accessMode" WHEN 'private' THEN 'restricted'::"SurveyVisibility" ELSE 'workspace'::"SurveyVisibility" END
WHERE "visibility" IS DISTINCT FROM (
  CASE "accessMode" WHEN 'private' THEN 'restricted'::"SurveyVisibility" ELSE 'workspace'::"SurveyVisibility" END
);

RESET lock_timeout;
