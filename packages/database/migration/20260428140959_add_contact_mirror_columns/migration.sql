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

-- Backfill email column from email attribute, deduplicated.
--
-- Some legacy environments may have multiple Contact rows with the same
-- email-attribute value (the previous schema did not enforce uniqueness).
-- We can only set the typed `email` column on ONE row per
-- (environmentId, lowercased-trimmed-email) group, otherwise the partial
-- unique index below would fail. We pick the most-recently-updated row in
-- each group as the canonical row; the other duplicates are left with
-- `email = NULL` for an operator to reconcile later.
--
-- Idempotent: only updates rows where typed `email` is currently NULL.
WITH candidates AS (
  SELECT
    c.id AS contact_id,
    LOWER(TRIM(ca."value")) AS normalized_email,
    c."environmentId" AS environment_id,
    c."updated_at" AS updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY c."environmentId", LOWER(TRIM(ca."value"))
      ORDER BY c."updated_at" DESC, c.id ASC
    ) AS rn
  FROM "public"."Contact" c
  JOIN "public"."ContactAttribute" ca ON ca."contactId" = c.id
  JOIN "public"."ContactAttributeKey" cak ON cak.id = ca."attributeKeyId"
  WHERE cak."key" = 'email'
    AND cak."environmentId" = c."environmentId"
    AND c."email" IS NULL
    AND ca."value" IS NOT NULL
    AND TRIM(ca."value") <> ''
)
UPDATE "public"."Contact" c
SET "email" = candidates.normalized_email
FROM candidates
WHERE candidates.contact_id = c.id
  AND candidates.rn = 1;

-- Surface duplicate-email Contacts (rn > 1) that were intentionally left
-- with NULL typed email. Operators can reconcile these in the UI later.
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT
      LOWER(TRIM(ca."value")) AS normalized_email,
      c."environmentId" AS environment_id,
      ROW_NUMBER() OVER (
        PARTITION BY c."environmentId", LOWER(TRIM(ca."value"))
        ORDER BY c."updated_at" DESC, c.id ASC
      ) AS rn
    FROM "public"."Contact" c
    JOIN "public"."ContactAttribute" ca ON ca."contactId" = c.id
    JOIN "public"."ContactAttributeKey" cak ON cak.id = ca."attributeKeyId"
    WHERE cak."key" = 'email'
      AND cak."environmentId" = c."environmentId"
      AND ca."value" IS NOT NULL
      AND TRIM(ca."value") <> ''
  ) ranked
  WHERE rn > 1;

  IF duplicate_count > 0 THEN
    RAISE NOTICE 'Contact mirror migration: % contact rows had duplicate email-attribute values within an environment and were left with NULL typed email. Reconcile via UI.', duplicate_count;
  END IF;
END $$;

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
