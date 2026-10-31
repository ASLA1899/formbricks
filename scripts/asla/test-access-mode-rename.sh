#!/usr/bin/env bash
# ASLA fork (ASL-1863): proves migration 20261002115900_asla_rename_fork_survey_visibility on a
# throwaway PostgreSQL 17 container with synthetic rows (no real data). Needs Docker.
#   scenario A  fork database (enum private/public): rename, then upstream's visibility migration
#   scenario B  rerun of the rename on the result of A: no-op
#   scenario C  database that never had the fork feature: rename is a no-op, upstream migration works
#   scenario D  database already on upstream's SurveyVisibility (restricted/workspace): rename must not touch it
#   scenario E  control: upstream migration alone on a fork database keeps the fork labels (the bug)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="$ROOT/packages/database/migration"
RENAME="$MIG/20261002115900_asla_rename_fork_survey_visibility/migration.sql"
UPSTREAM="$MIG/20261002120000_add_survey_visibility_columns/migration.sql"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
NAME="asl1863-pg-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=t "$PG_IMAGE" >/dev/null
for _ in $(seq 1 40); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
psqlc() { docker exec -i "$NAME" psql -U postgres -d "$1" -X -q -v ON_ERROR_STOP=1 -At; }
newdb() { docker exec "$NAME" psql -U postgres -X -q -c "CREATE DATABASE \"$1\"" >/dev/null; }
run_file() { docker exec -i "$NAME" psql -U postgres -d "$1" -X -q -v ON_ERROR_STOP=1 < "$2" >/dev/null; }
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "PASS $1"; else echo "FAIL $1: got [$2] want [$3]"; fail=1; fi; }
base_tables='CREATE TABLE "User" (id text primary key); CREATE TABLE "Survey" (id text primary key, name text);'
fork_state="$base_tables
CREATE TYPE \"SurveyVisibility\" AS ENUM ('private','public');
ALTER TABLE \"Survey\" ADD COLUMN visibility \"SurveyVisibility\" NOT NULL DEFAULT 'private';
INSERT INTO \"Survey\"(id,name,visibility) VALUES ('s1','a','private'),('s2','b','public'),('s3','c','private');"

# A
newdb a; echo "$fork_state" | psqlc a
run_file a "$RENAME"; run_file a "$UPSTREAM"
check "A access-mode values kept" "$(psqlc a <<<'SELECT string_agg(id || $$=$$ || "accessMode"::text, $$,$$ ORDER BY id) FROM "Survey"')" "s1=private,s2=public,s3=private"
check "A access-mode type" "$(psqlc a <<<"SELECT udt_name FROM information_schema.columns WHERE table_name='Survey' AND column_name='accessMode'")" "SurveyAccessMode"
check "A access-mode default" "$(psqlc a <<<"SELECT column_default FROM information_schema.columns WHERE table_name='Survey' AND column_name='accessMode'")" "'private'::\"SurveyAccessMode\""
check "A visibility type" "$(psqlc a <<<"SELECT udt_name FROM information_schema.columns WHERE table_name='Survey' AND column_name='visibility'")" "SurveyVisibility"
check "A visibility labels" "$(psqlc a <<<"SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='SurveyVisibility'")" "restricted,workspace"
check "A visibility values" "$(psqlc a <<<'SELECT string_agg(DISTINCT visibility::text, $$,$$) FROM "Survey"')" "workspace"
check "A row count" "$(psqlc a <<<'SELECT count(*) FROM "Survey"')" "3"
# B
run_file a "$RENAME"
check "B rerun leaves accessMode" "$(psqlc a <<<"SELECT udt_name FROM information_schema.columns WHERE table_name='Survey' AND column_name='accessMode'")" "SurveyAccessMode"
check "B rerun leaves upstream type" "$(psqlc a <<<"SELECT udt_name FROM information_schema.columns WHERE table_name='Survey' AND column_name='visibility'")" "SurveyVisibility"
# C
newdb c; echo "$base_tables" | psqlc c
run_file c "$RENAME"; run_file c "$UPSTREAM"
check "C fresh: no accessMode" "$(psqlc c <<<"SELECT count(*) FROM information_schema.columns WHERE table_name='Survey' AND column_name='accessMode'")" "0"
check "C fresh: upstream visibility" "$(psqlc c <<<"SELECT udt_name FROM information_schema.columns WHERE table_name='Survey' AND column_name='visibility'")" "SurveyVisibility"
# D
newdb d; echo "$base_tables CREATE TYPE \"SurveyVisibility\" AS ENUM ('restricted','workspace'); ALTER TABLE \"Survey\" ADD COLUMN visibility \"SurveyVisibility\" NOT NULL DEFAULT 'workspace';" | psqlc d
run_file d "$RENAME"
check "D upstream type untouched" "$(psqlc d <<<"SELECT count(*) FROM pg_type WHERE typname='SurveyAccessMode'")" "0"
# E (the bug this migration prevents): upstream migration alone on a fork database keeps the fork's labels
newdb e; echo "$fork_state" | psqlc e
run_file e "$UPSTREAM" 2>/dev/null
check "E without the rename the fork labels survive (the bug)" "$(psqlc e <<<"SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='SurveyVisibility'")" "private,public"
exit $fail
