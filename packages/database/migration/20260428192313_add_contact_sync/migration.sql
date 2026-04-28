-- ===========================================================================
-- Phase 1a: ContactSync — Snowflake → Formbricks Contact mirror config + runs
-- Idempotent: enum guarded by pg_type; tables/indexes/constraints use
-- IF NOT EXISTS or pg_constraint guards.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SyncStatus') THEN
    CREATE TYPE "public"."SyncStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "public"."ContactSync" (
  "id"               TEXT          NOT NULL,
  "created_at"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)  NOT NULL,
  "environmentId"    TEXT          NOT NULL,
  "snowflakeQueryId" TEXT          NOT NULL,
  "columnMapping"    JSONB         NOT NULL,
  "intervalMinutes"  INTEGER       NOT NULL DEFAULT 60,
  "enabled"          BOOLEAN       NOT NULL DEFAULT true,
  "lastRunAt"        TIMESTAMP(3),
  "lastRunStatus"    "public"."SyncStatus",

  CONSTRAINT "ContactSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContactSync_environmentId_key"
  ON "public"."ContactSync"("environmentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactSync_environmentId_fkey') THEN
    ALTER TABLE "public"."ContactSync"
      ADD CONSTRAINT "ContactSync_environmentId_fkey"
      FOREIGN KEY ("environmentId") REFERENCES "public"."Environment"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "public"."ContactSyncRun" (
  "id"              TEXT          NOT NULL,
  "syncId"          TEXT          NOT NULL,
  "startedAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"      TIMESTAMP(3),
  "status"          "public"."SyncStatus" NOT NULL,
  "rowsProcessed"   INTEGER       NOT NULL DEFAULT 0,
  "rowsCreated"     INTEGER       NOT NULL DEFAULT 0,
  "rowsUpdated"     INTEGER       NOT NULL DEFAULT 0,
  "rowsDeactivated" INTEGER       NOT NULL DEFAULT 0,
  "errorMessage"    TEXT,

  CONSTRAINT "ContactSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContactSyncRun_syncId_startedAt_idx"
  ON "public"."ContactSyncRun"("syncId", "startedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactSyncRun_syncId_fkey') THEN
    ALTER TABLE "public"."ContactSyncRun"
      ADD CONSTRAINT "ContactSyncRun_syncId_fkey"
      FOREIGN KEY ("syncId") REFERENCES "public"."ContactSync"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
