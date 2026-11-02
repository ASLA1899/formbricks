-- ASLA fork only (ASL-1875, Formbricks upgrade 1.2-10). Not an upstream migration.
--
-- Per-survey opt-in for the Snowflake response sync. On a database restored from the 4.9 fork the column
-- already exists (it was added there outside a migration), so the statement is guarded and is a no-op.
-- On a fresh database it creates it. Metadata-only: a constant default, no table rewrite. Idempotent.

BEGIN;

SET LOCAL lock_timeout = '1s';

ALTER TABLE "Survey" ADD COLUMN IF NOT EXISTS "snowflakeSync" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
