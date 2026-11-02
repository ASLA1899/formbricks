#!/usr/bin/env bash
# ASLA fork (ASL-1883): runs the generated team-grants SQL on a throwaway PostgreSQL 17 container with
# synthetic rows and a minimal copy of the 6.1.2 tables. Needs Docker and pnpm deps installed.
#   A dry run changes nothing   B apply   C apply again (no change)   D demote an owner   E bad email   F no owner
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="asl1883-pg-$$"
TMP="$(mktemp -d)"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=t "${PG_IMAGE:-postgres:17-alpine}" >/dev/null
for _ in $(seq 1 40); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
psqlc() { docker exec -i "$NAME" psql -U postgres -X -q -At "$@"; }
psqlc -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TYPE "OrganizationRole" AS ENUM ('owner','manager','member','billing');
CREATE TYPE "TeamUserRole" AS ENUM ('admin','contributor');
CREATE TYPE "WorkspaceTeamPermission" AS ENUM ('read','readWrite','manage');
CREATE TABLE "Organization"(id text PRIMARY KEY, name text);
CREATE TABLE "Workspace"(id text PRIMARY KEY, name text, "organizationId" text);
CREATE TABLE "User"(id text PRIMARY KEY, email text);
CREATE TABLE "Membership"("userId" text, "organizationId" text, accepted boolean DEFAULT false, role "OrganizationRole" DEFAULT 'member', PRIMARY KEY("userId","organizationId"));
CREATE TABLE "Team"(id text PRIMARY KEY, name text, "organizationId" text, updated_at timestamp NOT NULL, UNIQUE("organizationId", name));
CREATE TABLE "TeamUser"("teamId" text, "userId" text, role "TeamUserRole", updated_at timestamp NOT NULL, PRIMARY KEY("teamId","userId"));
CREATE TABLE "WorkspaceTeam"("workspaceId" text, "teamId" text, permission "WorkspaceTeamPermission" DEFAULT 'read', updated_at timestamp NOT NULL, PRIMARY KEY("workspaceId","teamId"));
CREATE TABLE "Survey"(id text PRIMARY KEY, "ownerId" text, updated_at timestamp);
INSERT INTO "Organization" VALUES ('o1','Org'); INSERT INTO "Workspace" VALUES ('w1','Surveys','o1');
INSERT INTO "User" VALUES ('u1','admin@x.org'),('u2','a@x.org'),('u3','b@x.org'),('u4','c@x.org'),('u5','bill@x.org');
INSERT INTO "Membership" VALUES ('u1','o1',true,'owner'),('u2','o1',true,'owner'),('u3','o1',true,'owner'),('u4','o1',false,'owner'),('u5','o1',true,'billing');
INSERT INTO "Survey" VALUES ('cmsurvey0000000000000001',NULL,NULL),('cmsurvey0000000000000002','u3',NULL);
SQL
gen() { (cd "$ROOT" && npx --yes tsx scripts/asla/apply-team-grants.ts "$@"); }
cat > "$TMP/m.json" <<'JSON'
{"organizationName":"Org","workspaceName":"Surveys","team":{"name":"All staff","permission":"readWrite"},
 "owners":["admin@x.org"],"surveyOwners":[{"surveyId":"cmsurvey0000000000000001","ownerEmail":"a@x.org"},{"surveyId":"cmsurvey0000000000000002","ownerEmail":"a@x.org"}]}
JSON
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "PASS $1"; else echo "FAIL $1: got [$2] want [$3]"; fail=1; fi; }
roles() { psqlc -c "SELECT string_agg(\"userId\"||'='||role||(CASE WHEN accepted THEN '' ELSE '*' END), ',' ORDER BY \"userId\") FROM \"Membership\""; }
team() { psqlc -c "SELECT coalesce(string_agg(\"userId\", ',' ORDER BY \"userId\"),'-') FROM \"TeamUser\""; }
before="$(roles)"
gen "$TMP/m.json" | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "A dry run leaves roles" "$(roles)" "$before"
check "A dry run leaves no team" "$(team)" "-"
gen "$TMP/m.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "B roles (u4 not accepted, u5 billing untouched)" "$(roles)" "u1=owner,u2=member,u3=member,u4=owner*,u5=billing"
check "B team = members only" "$(team)" "u2,u3"
check "B grant" "$(psqlc -c 'SELECT permission FROM "WorkspaceTeam"')" "readWrite"
check "B survey owner set only where empty" "$(psqlc -c 'SELECT string_agg(coalesce("ownerId",$$-$$), $$,$$ ORDER BY id) FROM "Survey"')" "u2,u3"
snap="$(psqlc -c 'SELECT count(*), max(updated_at) FROM "TeamUser"')"
gen "$TMP/m.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "C rerun keeps roles" "$(roles)" "u1=owner,u2=member,u3=member,u4=owner*,u5=billing"
check "C rerun keeps team rows untouched" "$(psqlc -c 'SELECT count(*), max(updated_at) FROM "TeamUser"')" "$snap"
check "C one team" "$(psqlc -c 'SELECT count(*) FROM "Team"')" "1"
sed 's/"owners":\["admin@x.org"\]/"owners":["admin@x.org","b@x.org"]/' "$TMP/m.json" > "$TMP/d.json"
gen "$TMP/d.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "D promoted user leaves the team" "$(team)" "u2"
sed 's/admin@x.org/typo@x.org/' "$TMP/m.json" > "$TMP/e.json"
if gen "$TMP/e.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null 2>&1; then check "E unknown email aborts" "ran" "failed"; else check "E unknown email aborts" "failed" "failed"; fi
check "E nothing changed" "$(team)" "u2"
exit $fail
