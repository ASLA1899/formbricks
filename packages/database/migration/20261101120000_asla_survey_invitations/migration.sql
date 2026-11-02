-- ASLA fork only (ASL-1876, Formbricks upgrade 1.2-11a). Not an upstream migration.
--
-- Declares the fork's survey invitation objects to Prisma. They come from two 4.9 fork migrations
-- (add_survey_invitations, add_invitation_name_fields). On a database restored from the 4.9 fork they
-- already exist, so every statement is guarded and the DDL is a no-op there. On a fresh database it
-- creates them.
--
--   column "Survey"."invitationConfig"
--   table  "SurveyInvitation"
--
-- No data is read, changed or removed. Idempotent.

BEGIN;

SET LOCAL lock_timeout = '1s';

ALTER TABLE "Survey" ADD COLUMN IF NOT EXISTS "invitationConfig" JSONB;

CREATE TABLE IF NOT EXISTS "SurveyInvitation" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "surveyId" TEXT NOT NULL,
    "contactId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "recipientFirstName" TEXT,
    "recipientLastName" TEXT,
    "linkToken" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseId" TEXT,
    "lastReminderAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "sentOffsetDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "SurveyInvitation_pkey" PRIMARY KEY ("id")
);

-- A 4.9 database that took the first migration but not the second gets the name columns here.
ALTER TABLE "SurveyInvitation" ADD COLUMN IF NOT EXISTS "recipientFirstName" TEXT;
ALTER TABLE "SurveyInvitation" ADD COLUMN IF NOT EXISTS "recipientLastName" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "SurveyInvitation_linkToken_key" ON "SurveyInvitation"("linkToken");
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyInvitation_responseId_key" ON "SurveyInvitation"("responseId");
CREATE INDEX IF NOT EXISTS "SurveyInvitation_surveyId_respondedAt_idx" ON "SurveyInvitation"("surveyId", "respondedAt");
CREATE INDEX IF NOT EXISTS "SurveyInvitation_surveyId_contactId_idx" ON "SurveyInvitation"("surveyId", "contactId");
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyInvitation_surveyId_recipientEmail_key" ON "SurveyInvitation"("surveyId", "recipientEmail");

DO $$
BEGIN
  ALTER TABLE "SurveyInvitation" ADD CONSTRAINT "SurveyInvitation_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "SurveyInvitation" ADD CONSTRAINT "SurveyInvitation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "SurveyInvitation" ADD CONSTRAINT "SurveyInvitation_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
