-- ASLA fork only (ASL-1866, Formbricks upgrade 1.2-01). Not an upstream migration.
--
-- Declares the fork's saved option lists ("OptionList") to Prisma, scoped to a workspace.
--
-- On a database restored from the 4.9 fork the table already exists (the 4.9 migration `add_survey_acl`)
-- with a "projectId" column, a foreign key to the table that upstream's
-- 20260330000000_rename_project_to_workspace renamed to "Workspace", and indexes named for "projectId".
-- This migration renames that column, constraint and those indexes. On a fresh database it creates the
-- table. Every statement is guarded, so it is safe to run twice. Nothing is dropped and no row changes.

BEGIN;

SET LOCAL lock_timeout = '1s';

CREATE TABLE IF NOT EXISTS "OptionList" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "options" TEXT[],
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "OptionList_pkey" PRIMARY KEY ("id")
);

-- Restored 4.9 table: "projectId" becomes "workspaceId" (the values are the same ids).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'OptionList' AND column_name = 'projectId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'OptionList' AND column_name = 'workspaceId'
  ) THEN
    ALTER TABLE "OptionList" RENAME COLUMN "projectId" TO "workspaceId";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OptionList_projectId_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OptionList_workspaceId_fkey') THEN
    ALTER TABLE "OptionList" RENAME CONSTRAINT "OptionList_projectId_fkey" TO "OptionList_workspaceId_fkey";
  END IF;
END $$;

ALTER INDEX IF EXISTS "OptionList_projectId_name_key" RENAME TO "OptionList_workspaceId_name_key";
ALTER INDEX IF EXISTS "OptionList_projectId_idx" RENAME TO "OptionList_workspaceId_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "OptionList_workspaceId_name_key" ON "OptionList"("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "OptionList_workspaceId_idx" ON "OptionList"("workspaceId");

DO $$
BEGIN
  ALTER TABLE "OptionList" ADD CONSTRAINT "OptionList_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
