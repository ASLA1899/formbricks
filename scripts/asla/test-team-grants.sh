#!/usr/bin/env bash
# ASLA fork (ASL-1883): runs the generated team-grants SQL on a throwaway PostgreSQL 17 container with
# synthetic rows and a minimal copy of the 6.1.2 tables. Needs Docker and pnpm deps installed.
#   A dry run changes nothing   B apply   C apply again (no change)   D demote an owner   E bad email
#   I foreign pre-image refused  J later owner change kept  K existing team restored
#   F no active owner   G survey in another workspace / owner outside the org   H rollback from the pre-image
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
CREATE TABLE "User"(id text PRIMARY KEY, email text, "isActive" boolean DEFAULT true);
CREATE TABLE "Membership"("userId" text, "organizationId" text, accepted boolean DEFAULT false, role "OrganizationRole" DEFAULT 'member', PRIMARY KEY("userId","organizationId"));
CREATE TABLE "Team"(id text PRIMARY KEY, name text, "organizationId" text, updated_at timestamp NOT NULL, UNIQUE("organizationId", name));
CREATE TABLE "TeamUser"("teamId" text REFERENCES "Team"(id) ON DELETE CASCADE, "userId" text, role "TeamUserRole", updated_at timestamp NOT NULL, PRIMARY KEY("teamId","userId"));
CREATE TABLE "WorkspaceTeam"("workspaceId" text, "teamId" text REFERENCES "Team"(id) ON DELETE CASCADE, permission "WorkspaceTeamPermission" DEFAULT 'read', updated_at timestamp NOT NULL, PRIMARY KEY("workspaceId","teamId"));
CREATE TABLE "Survey"(id text PRIMARY KEY, "ownerId" text, updated_at timestamp, "workspaceId" text);
INSERT INTO "Organization" VALUES ('o1','Org'),('o2','Other'); INSERT INTO "Workspace" VALUES ('w1','Surveys','o1'),('w2','Surveys','o2');
INSERT INTO "User" VALUES ('u1','admin@x.org'),('u2','a@x.org'),('u3','b@x.org'),('u4','c@x.org'),('u5','bill@x.org');
INSERT INTO "Membership" VALUES ('u1','o1',true,'owner'),('u2','o1',true,'owner'),('u3','o1',true,'owner'),('u4','o1',false,'owner'),('u5','o1',true,'billing');
INSERT INTO "User" VALUES ('u6','stranger@y.org',true);
INSERT INTO "Membership" VALUES ('u6','o2',true,'member');
INSERT INTO "Survey" VALUES ('cmsurvey0000000000000001',NULL,NULL,'w1'),('cmsurvey0000000000000002','u3',NULL,'w1'),('cmsurvey0000000000000003',NULL,NULL,'w2');
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
gen "$TMP/m.json" --preimage | psqlc -t > "$TMP/pre.json"
gen "$TMP/m.json" | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "A dry run leaves roles" "$(roles)" "$before"
check "A dry run leaves no team" "$(team)" "-"
gen "$TMP/m.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "B roles (u4 not accepted, u5 billing untouched)" "$(roles)" "u1=owner,u2=member,u3=member,u4=owner*,u5=billing,u6=member"
check "B team = members only" "$(team)" "u2,u3"
check "B grant" "$(psqlc -c 'SELECT permission FROM "WorkspaceTeam"')" "readWrite"
check "B survey owner set only where empty" "$(psqlc -c 'SELECT string_agg(coalesce("ownerId",$$-$$), $$,$$ ORDER BY id) FROM "Survey"')" "u2,u3,-"
snap="$(psqlc -c 'SELECT count(*), max(updated_at) FROM "TeamUser"')"
gen "$TMP/m.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "C rerun keeps roles" "$(roles)" "u1=owner,u2=member,u3=member,u4=owner*,u5=billing,u6=member"
check "C rerun keeps team rows untouched" "$(psqlc -c 'SELECT count(*), max(updated_at) FROM "TeamUser"')" "$snap"
check "C one team" "$(psqlc -c 'SELECT count(*) FROM "Team"')" "1"
sed 's/"owners":\["admin@x.org"\]/"owners":["admin@x.org","b@x.org"]/' "$TMP/m.json" > "$TMP/d.json"
gen "$TMP/d.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "D promoted user leaves the team" "$(team)" "u2"
sed 's/admin@x.org/typo@x.org/' "$TMP/m.json" > "$TMP/e.json"
if gen "$TMP/e.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null 2>&1; then check "E unknown email aborts" "ran" "failed"; else check "E unknown email aborts" "failed" "failed"; fi
check "E nothing changed" "$(team)" "u2"
# F: the only accepted owner is inactive -> the mapping must abort
psqlc -c "UPDATE \"User\" SET \"isActive\" = false WHERE id = 'u3'" >/dev/null
sed 's/"owners":\[[^]]*\]/"owners":["b@x.org"]/' "$TMP/m.json" > "$TMP/f.json"
if gen "$TMP/f.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null 2>&1; then check "F inactive-only owner aborts" "ran" "failed"; else check "F inactive-only owner aborts" "failed" "failed"; fi
psqlc -c "UPDATE \"User\" SET \"isActive\" = true WHERE id = 'u3'" >/dev/null
# G: survey in another workspace, and an owner who belongs to another organization
sed 's/cmsurvey0000000000000001/cmsurvey0000000000000003/' "$TMP/m.json" > "$TMP/g1.json"
if gen "$TMP/g1.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null 2>&1; then check "G survey in another workspace aborts" "ran" "failed"; else check "G survey in another workspace aborts" "failed" "failed"; fi
sed 's/"ownerEmail":"a@x.org"}/"ownerEmail":"stranger@y.org"}/' "$TMP/m.json" > "$TMP/g2.json"
if gen "$TMP/g2.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null 2>&1; then check "G owner outside the org aborts" "ran" "failed"; else check "G owner outside the org aborts" "failed" "failed"; fi
check "G other org survey untouched" "$(psqlc -c 'SELECT coalesce("ownerId",$$-$$) FROM "Survey" WHERE id = $$cmsurvey0000000000000003$$')" "-"
# H: rollback restores the pre-image (roles as before B, team gone, survey owner back to empty)
gen "$TMP/m.json" --rollback "$TMP/pre.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "H roles restored" "$(roles)" "$before"
check "H team gone" "$(psqlc -c 'SELECT count(*) FROM "Team"')" "0"
check "H grants and members gone" "$(psqlc -c 'SELECT (SELECT count(*) FROM "WorkspaceTeam") + (SELECT count(*) FROM "TeamUser")')" "0"
check "H survey owner restored" "$(psqlc -c 'SELECT coalesce("ownerId",$$-$$) FROM "Survey" WHERE id = $$cmsurvey0000000000000001$$')" "-"
# I: a pre-image from another organization is refused, and nothing is written there
cat > "$TMP/m2.json" <<'JSON'
{"organizationName":"Other","workspaceName":"Surveys","team":{"name":"All staff","permission":"readWrite"},
 "owners":["stranger@y.org"],"surveyOwners":[{"surveyId":"cmsurvey0000000000000003","ownerEmail":"stranger@y.org"}]}
JSON
psqlc -c "UPDATE \"Survey\" SET \"ownerId\" = 'u6' WHERE id = 'cmsurvey0000000000000003'" >/dev/null
if gen "$TMP/m2.json" --rollback "$TMP/pre.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null 2>&1; then check "I foreign pre-image refused" "ran" "failed"; else check "I foreign pre-image refused" "failed" "failed"; fi
check "I other org survey untouched" "$(psqlc -c 'SELECT "ownerId" FROM "Survey" WHERE id = $$cmsurvey0000000000000003$$')" "u6"
# J: rollback does not undo an owner change made after the apply
psqlc -c "DELETE FROM \"Team\"; UPDATE \"Survey\" SET \"ownerId\" = NULL WHERE id IN ('cmsurvey0000000000000001','cmsurvey0000000000000002'); UPDATE \"Survey\" SET \"ownerId\" = 'u3' WHERE id = 'cmsurvey0000000000000002'" >/dev/null
gen "$TMP/m.json" --preimage | psqlc -t > "$TMP/pre2.json"
gen "$TMP/m.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
psqlc -c "UPDATE \"Survey\" SET \"ownerId\" = 'u1' WHERE id IN ('cmsurvey0000000000000001','cmsurvey0000000000000002')" >/dev/null
gen "$TMP/m.json" --rollback "$TMP/pre2.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "J later owner change kept" "$(psqlc -c 'SELECT string_agg("ownerId", $$,$$ ORDER BY id) FROM "Survey" WHERE "workspaceId" = $$w1$$')" "u1,u1"
# K: rollback restores an existing team's members and grant
psqlc -c "DELETE FROM \"Team\"; INSERT INTO \"Team\" VALUES ('t1','All staff','o1',now()); INSERT INTO \"TeamUser\" VALUES ('t1','u1','admin',now()); INSERT INTO \"WorkspaceTeam\" VALUES ('w1','t1','read',now())" >/dev/null
gen "$TMP/m.json" --preimage | psqlc -t > "$TMP/pre3.json"
gen "$TMP/m.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
gen "$TMP/m.json" --rollback "$TMP/pre3.json" --apply | psqlc -v ON_ERROR_STOP=1 >/dev/null
check "K team members restored" "$(psqlc -c 'SELECT string_agg("userId"||$$=$$||role, $$,$$ ORDER BY "userId") FROM "TeamUser"')" "u1=admin"
check "K grant restored" "$(psqlc -c 'SELECT permission FROM "WorkspaceTeam"')" "read"
exit $fail
