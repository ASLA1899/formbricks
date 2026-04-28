-- ===========================================================================
-- Phase 1a: Contact mirror — add typed identity columns + source tagging
-- ---------------------------------------------------------------------------
-- Idempotent: each ALTER / CREATE uses IF NOT EXISTS so re-running is a
-- no-op. Backfills are also idempotent (UPDATE ... WHERE email IS NULL).
-- ===========================================================================

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContactSource') THEN
    CREATE TYPE "public"."ContactSource" AS ENUM ('snowflake', 'manual', 'csv');
  END IF;
END $$;

-- AlterTable: Contact additions
ALTER TABLE "public"."Contact" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "public"."Contact" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "public"."Contact" ADD COLUMN IF NOT EXISTS "source" "public"."ContactSource" NOT NULL DEFAULT 'manual';
ALTER TABLE "public"."Contact" ADD COLUMN IF NOT EXISTS "inactive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."Contact" ADD COLUMN IF NOT EXISTS "inactiveAt" TIMESTAMP(3);

-- Backfill email column from email attribute (where present).
-- Joins ContactAttribute → ContactAttributeKey (key='email'), takes the
-- attribute value, lowercases + trims it. Idempotent (only updates rows
-- where email is currently NULL).
UPDATE "public"."Contact" c
SET "email" = LOWER(TRIM(ca."value"))
FROM "public"."ContactAttribute" ca
JOIN "public"."ContactAttributeKey" cak ON cak."id" = ca."attributeKeyId"
WHERE ca."contactId" = c."id"
  AND cak."key" = 'email'
  AND cak."environmentId" = c."environmentId"
  AND c."email" IS NULL
  AND ca."value" IS NOT NULL
  AND TRIM(ca."value") <> '';

-- Index: lookups by (environmentId, inactive)
CREATE INDEX IF NOT EXISTS "Contact_environmentId_inactive_idx"
  ON "public"."Contact"("environmentId", "inactive");

-- Partial unique indexes: enforce email + externalId uniqueness per environment
-- but only when the column is non-null (legacy rows may lack email).
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_environmentId_email_unique"
  ON "public"."Contact"("environmentId", "email")
  WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Contact_environmentId_externalId_unique"
  ON "public"."Contact"("environmentId", "externalId")
  WHERE "externalId" IS NOT NULL;
