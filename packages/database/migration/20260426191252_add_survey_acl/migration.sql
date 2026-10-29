-- ===========================================================================
-- Capture pre-existing schema drift
-- ---------------------------------------------------------------------------
-- The following columns/tables/indexes/FKs already exist in production
-- (applied via `prisma db push` in earlier development cycles, with no
-- corresponding migration file checked in). They are NOT new for this
-- feature, but Prisma considers them part of schema.prisma and will re-emit
-- them in any future `migrate dev`.
--
-- We use IF NOT EXISTS / catalog probes here so this section is a no-op on
-- prod (and any other env where db push has been run) but correctly creates
-- them on a fresh database that has only ever applied migrations.
-- ===========================================================================

ALTER TABLE "public"."Survey" ADD COLUMN IF NOT EXISTS "autoAdvance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."Survey" ADD COLUMN IF NOT EXISTS "snowflakeSync" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "public"."OptionList" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "options" TEXT[],
    "projectId" TEXT NOT NULL,

    CONSTRAINT "OptionList_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OptionList_projectId_idx" ON "public"."OptionList"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "OptionList_projectId_name_key" ON "public"."OptionList"("projectId", "name");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OptionList_projectId_fkey'
  ) THEN
    ALTER TABLE "public"."OptionList"
      ADD CONSTRAINT "OptionList_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ===========================================================================
-- Per-survey access control (the actual feature)
-- ===========================================================================

-- CreateEnum
CREATE TYPE "public"."SurveyVisibility" AS ENUM ('private', 'public');

-- AlterTable
ALTER TABLE "public"."Membership" ADD COLUMN     "surveyAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."Survey" ADD COLUMN     "visibility" "public"."SurveyVisibility" NOT NULL DEFAULT 'private';

-- CreateTable
CREATE TABLE "public"."SurveyAccess" (
    "surveyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyAccess_pkey" PRIMARY KEY ("surveyId","userId")
);

-- CreateIndex
CREATE INDEX "SurveyAccess_userId_idx" ON "public"."SurveyAccess"("userId");

-- AddForeignKey
ALTER TABLE "public"."SurveyAccess" ADD CONSTRAINT "SurveyAccess_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "public"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SurveyAccess" ADD CONSTRAINT "SurveyAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
