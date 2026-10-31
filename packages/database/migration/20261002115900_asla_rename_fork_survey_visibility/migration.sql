-- ASLA fork only (ASL-1863, Formbricks upgrade 1.0b). Not an upstream migration.
--
-- The 4.9 fork shipped its own per-survey access feature (fork migration `add_survey_acl`): enum
-- "SurveyVisibility" ('private', 'public') and column "Survey"."visibility" (default 'private').
-- Upstream 6.1.2 migration 20261002120000_add_survey_visibility_columns creates a type and a column
-- with the SAME names and the values ('restricted', 'workspace'), guarded by
-- `EXCEPTION WHEN duplicate_object THEN NULL` and `ADD COLUMN IF NOT EXISTS`. On a fork database
-- those guards skip silently: the fork's type and column survive, the runner exits 0, and every
-- survey then fails to load (dry run ASL-1820, failure 1).
--
-- This migration frees the names first. It sorts immediately before the upstream one, so
-- `apply-migrations.js` (also run by `formbricks-authzed-prepare` and the fbs-migrate job) applies it
-- ahead of that migration in every path.
--
--   enum   "SurveyVisibility" ('private','public')  ->  "SurveyAccessMode"
--   column "Survey"."visibility"                    ->  "Survey"."accessMode"
--
-- The data is kept: every row keeps its 'private' / 'public' value for the port that builds on it
-- (upgrade issue 14a). Renaming a type updates every column, default and function that uses it, and
-- the column default ('private') moves with the column.
--
-- Fail-open until that port lands: after the upstream migration creates its own "visibility" column
-- (default 'workspace'), every survey is 'workspace' and nothing reads "accessMode", so surveys that
-- were 'private' become visible to the whole workspace. Acceptable in the sandbox. Do not cut over
-- production before the access-mode port has mapped "accessMode" back onto upstream visibility.
--
-- Idempotent and a no-op on a database that never had the fork feature (fresh install, or a second
-- run). It acts only when "SurveyVisibility" still has the fork's labels ('private' and 'public') and
-- "SurveyAccessMode" does not exist, so it can never rename upstream's own type.

SET lock_timeout = '1s';

DO $$
BEGIN
  IF EXISTS (
       SELECT 1
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = current_schema() AND t.typname = 'SurveyVisibility' AND t.typtype = 'e'
     )
     AND EXISTS (
       SELECT 1
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = current_schema() AND t.typname = 'SurveyVisibility' AND e.enumlabel = 'private'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = current_schema() AND t.typname = 'SurveyAccessMode'
     )
  THEN
    ALTER TYPE "SurveyVisibility" RENAME TO "SurveyAccessMode";

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Survey' AND column_name = 'visibility'
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Survey' AND column_name = 'accessMode'
    ) THEN
      ALTER TABLE "Survey" RENAME COLUMN "visibility" TO "accessMode";
    END IF;
  END IF;
END $$;

RESET lock_timeout;
