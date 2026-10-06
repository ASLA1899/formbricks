-- Tracked download links for files attached to survey follow-up emails.
CREATE TABLE IF NOT EXISTS "public"."SurveyFollowUpFileLink" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "first_downloaded_at" TIMESTAMP(3),
    "last_downloaded_at" TIMESTAMP(3),
    "download_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SurveyFollowUpFileLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SurveyFollowUpFileLink_token_key"
  ON "public"."SurveyFollowUpFileLink"("token");

CREATE INDEX IF NOT EXISTS "SurveyFollowUpFileLink_followUpId_created_at_idx"
  ON "public"."SurveyFollowUpFileLink"("followUpId", "created_at");

CREATE INDEX IF NOT EXISTS "SurveyFollowUpFileLink_responseId_idx"
  ON "public"."SurveyFollowUpFileLink"("responseId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyFollowUpFileLink_followUpId_fkey') THEN
    ALTER TABLE "public"."SurveyFollowUpFileLink"
      ADD CONSTRAINT "SurveyFollowUpFileLink_followUpId_fkey"
      FOREIGN KEY ("followUpId") REFERENCES "public"."SurveyFollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyFollowUpFileLink_responseId_fkey') THEN
    ALTER TABLE "public"."SurveyFollowUpFileLink"
      ADD CONSTRAINT "SurveyFollowUpFileLink_responseId_fkey"
      FOREIGN KEY ("responseId") REFERENCES "public"."Response"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
