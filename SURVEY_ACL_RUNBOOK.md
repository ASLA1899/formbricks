# Survey ACL — Production Rollout Runbook

**Prepared for:** ASLA IT (gcohen@asla.org)
**Feature:** Per-survey access control on `https://surveys.asla.org`
**Branch:** `feature/survey-acl`
**Deploy mechanism:** GHCR image push/pull (NOT local image transfer)

This runbook executes the deploy in **gated steps** so a respondent-side regression is caught **before** the app code ships. The schema migration is applied first via a one-shot migration container, against the still-running old image — old code ignores the new columns, so the worst case at that point is a clean revert.

> ⚠️ Do **not** skip step 5 (live respondent smoke test). It is the load-bearing check between schema migration and app deploy.

---

## What This Feature Does

- **Existing surveys:** grandfathered to `visibility = public` — every ASLA member sees them, exactly as today.
- **New surveys:** default to `visibility = private` — only the creator + survey admins + people on the SurveyAccess list see them.
- **`gcohen@asla.org`:** auto-granted `Membership.surveyAdmin = true` — sees everything.
- **Respondent flow (`/s/<id>`, `/api/v1/client/...`):** unchanged. The ACL applies only to the admin UI.
- **System pipeline, webhooks, integrations, API tokens:** unchanged. ACL does not apply.

## What This Feature Does NOT Touch

- Microsoft 365 SSO (`299f6f52a` + `14ac8ce0e`) — independent, ships in the same image.
- Snowflake export, response submission, public survey URLs.

## ⚠️ Important Security Model (read before deploy)

In ASLA's non-EE deployment, every member defaults to `OrganizationRole.owner`. The ACL therefore deliberately **does not** trust the org role for managing surveyAdmin or survey sharing — only:

- **Existing surveyAdmins** can promote/demote other surveyAdmins.
- **Survey creator OR existing surveyAdmin** can manage that survey's visibility / access list / delete / copy.

The **first surveyAdmin** is bootstrapped by the data migration script (`scripts/2026-04-26-survey-acl-migration.sql`) which sets `Membership.surveyAdmin = true` for `gcohen@asla.org`. **If that script fails to find the user row, the deployment has zero surveyAdmins and recovery requires direct DB access.** This is intentional fail-closed behavior.

---

## Pre-Flight Checklist

- [ ] `gcohen@asla.org` exists in production `User` table:
  ```bash
  ssh -p 2222 -i ~/.ssh/id_ed25519_workgh gregcohen@20.185.219.8 \
    'docker exec formbricks-postgres psql -U formbricks -d formbricks \
      -c "SELECT id, email FROM \"User\" WHERE email = '\''gcohen@asla.org'\'';"'
  ```
  Expected: one row.
- [ ] Local CI / smoke test of `feature/survey-acl` branch passed (vitest + dev-server click-through).
- [ ] Migration verified safe by applying against a clone of the prod schema dump.
- [ ] No active maintenance windows or live invitation campaigns in flight.
- [ ] `it@aslalabs.org` mail-from is reachable (no SMTP issues).
- [ ] You can SSH to the VM: `ssh -p 2222 -i ~/.ssh/id_ed25519_workgh gregcohen@20.185.219.8 'whoami'`.

---

## 1. Backups (DB + Image Rollback Tag)

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_workgh gregcohen@20.185.219.8

# DB backup
mkdir -p /opt/formbricks/backups
TS=$(date +%Y%m%d-%H%M%S)
docker exec formbricks-postgres pg_dump -U formbricks formbricks | \
  gzip > /opt/formbricks/backups/pre-acl-${TS}.sql.gz
ls -lh /opt/formbricks/backups/pre-acl-${TS}.sql.gz
# Sanity-check the dump contains expected tables:
gunzip -c /opt/formbricks/backups/pre-acl-${TS}.sql.gz | grep -c '^CREATE TABLE'
# Expected: ~33

# Image rollback tag (locally on VM — already exists if you ran the prep work)
docker tag ghcr.io/asla1899/formbricks:latest ghcr.io/asla1899/formbricks:pre-acl-backup
docker images ghcr.io/asla1899/formbricks --format '{{.Repository}}:{{.Tag}} {{.ID}}'
# Expected: at minimum :latest and :pre-acl-backup at the same SHA, plus the
# CI-generated :sha-<commit> tag at the same SHA.
```

The `:sha-<commit>` tag from CI also serves as a rollback handle. Note its commit hash for the record.

---

## 2. Build & Push the New Image

Build is local because the VM is RAM-constrained (8 GB, OOMs on `next build`).

```bash
# On the dev machine
cd /Users/gcohen/dev/formbricks-survey-acl
git checkout feature/survey-acl
git pull --ff-only

# Capture the commit you're shipping (for the rollback story)
COMMIT_SHA=$(git rev-parse --short HEAD)
echo "Shipping commit $COMMIT_SHA"

# Authenticate to GHCR if you haven't recently
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <your-github-username> --password-stdin
# (token needs write:packages scope; create at https://github.com/settings/tokens)

# Build for amd64 (matches the Linux/amd64 VM) and push to GHCR.
# Note: Apple Silicon Mac builds for amd64 via Rosetta have intermittently
# stalled in the Next.js TypeScript-check phase. If you hit that, build on a
# native Linux/amd64 host (small Azure VM, EC2, etc.) and push from there.
docker buildx build --platform linux/amd64 \
  -t ghcr.io/asla1899/formbricks:sha-${COMMIT_SHA} \
  -f apps/web/Dockerfile \
  --push .
```

This pushes a **commit-pinned tag** (`:sha-${COMMIT_SHA}`). Whether `:latest` on GHCR also gets updated depends on your build pipeline — both behaviors are safe **as long as nobody runs `docker compose pull` on the VM until the cutover step**, since the running container uses the VM's local image cache, not GHCR's `:latest`.

---

## 3. Apply Schema Migration (without restarting the running app)

The new image's startup script auto-runs `db:migrate:deploy`. To preserve the gated rollout, we run that against the live DB ahead of replacing the running container, using a one-shot container that joins the postgres container's network namespace:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_workgh gregcohen@20.185.219.8

cd /opt/formbricks
POSTGRES_PASSWORD=$(grep ^POSTGRES_PASSWORD .env | cut -d= -f2-)
COMMIT_SHA=<commit-from-step-2>

docker pull ghcr.io/asla1899/formbricks:sha-${COMMIT_SHA}

docker run --rm \
  --network container:formbricks-postgres \
  -e DATABASE_URL="postgresql://formbricks:${POSTGRES_PASSWORD}@localhost:5432/formbricks" \
  ghcr.io/asla1899/formbricks:sha-${COMMIT_SHA} \
  pnpm --filter @formbricks/database db:migrate:deploy
```

Watch for: `Successfully applied schema migration: 20260426191252_add_survey_acl` and `All migrations completed`.

The migration is idempotent for pre-existing schema drift (autoAdvance, snowflakeSync, OptionList) and additive for the survey-acl items.

Verify directly:

```bash
docker exec formbricks-postgres psql -U formbricks -d formbricks -c '\d "Survey"' | grep -iE 'visibility|autoAdvance|snowflakeSync'
docker exec formbricks-postgres psql -U formbricks -d formbricks -c '\d "Membership"' | grep -i 'surveyAdmin'
docker exec formbricks-postgres psql -U formbricks -d formbricks -c '\d "SurveyAccess"' | head -10
```

Expected:
- `visibility | "SurveyVisibility" | not null default 'private'`
- `surveyAdmin | boolean | not null default false`
- `SurveyAccess` table with PK `(surveyId, userId)` and `userId` index.

**App at this point:** unchanged production image is still running. Old code does not read the new columns — the site continues working.

---

## 4. Run the Data Migration

Bootstrap gcohen as surveyAdmin and grandfather existing surveys to public:

```bash
# inside the VM
cd /opt/formbricks

# Get the migration SQL onto the VM (one-shot — pull from the branch)
git clone --depth=1 -b feature/survey-acl \
  https://github.com/ASLA1899/formbricks.git /tmp/survey-acl-migration
docker cp /tmp/survey-acl-migration/scripts/2026-04-26-survey-acl-migration.sql \
  formbricks-postgres:/tmp/survey-acl-migration.sql

docker exec formbricks-postgres psql -U formbricks -d formbricks \
  -v ON_ERROR_STOP=1 -f /tmp/survey-acl-migration.sql

# Cleanup
rm -rf /tmp/survey-acl-migration
```

Watch for these `NOTICE` lines:

```
NOTICE:  Found survey-admin user: gcohen@asla.org (id=...)
NOTICE:  N memberships updated to surveyAdmin=true
NOTICE:  M existing surveys set to visibility=public (grandfather)
```

Expected: N ≥ 1 (at least one membership for gcohen). M = current production survey count. If `N == 0` after a fresh apply, gcohen's row may have been missing or the script was already run.

**If the script aborts with `gcohen@asla.org not found in "User"`:** stop here. Either the email in the script doesn't match production, or the user row is missing. Don't proceed without a bootstrap surveyAdmin — the deployment will have zero surveyAdmins and no UI path to create one.

Sanity:

```bash
docker exec formbricks-postgres psql -U formbricks -d formbricks -c \
  "SELECT u.email, m.\"surveyAdmin\" FROM \"Membership\" m JOIN \"User\" u ON u.id=m.\"userId\" WHERE m.\"surveyAdmin\";"

docker exec formbricks-postgres psql -U formbricks -d formbricks -c \
  "SELECT visibility, count(*) FROM \"Survey\" GROUP BY visibility;"
```

Expected:
- Only gcohen's memberships show `surveyAdmin = true`.
- Every existing survey is `visibility = public` (count matches pre-migration `count(*)`).

---

## 5. ⚠️ Live Respondent Smoke Test (BEFORE deploying app code)

This is the gate. If respondents broke after the schema or data migration, you find out **now** when rolling forward is still cheap.

Open an incognito window. Hit a known-live survey URL:

```
https://surveys.asla.org/s/<known-live-survey-id>
```

- [ ] Page loads.
- [ ] Survey renders (questions / welcome card visible).
- [ ] Submit a response.
- [ ] Response landed: check Snowflake (`SELECT * FROM <table> ORDER BY received_at DESC LIMIT 1;`) and any active webhook destination.

If anything is broken: see Rollback (Schema Stage) below.

If everything is green: continue.

---

## 6. Deploy the New App Image

Replace `:latest` with the new commit's tag and recreate the container:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_workgh gregcohen@20.185.219.8

cd /opt/formbricks
COMMIT_SHA=<commit-from-step-2>

# Re-tag locally so docker compose pulls the new content under :latest
docker tag ghcr.io/asla1899/formbricks:sha-${COMMIT_SHA} \
  ghcr.io/asla1899/formbricks:latest

docker compose up -d --force-recreate formbricks
docker compose logs -f --tail=200 formbricks
```

Watch startup logs. Expected:
- Migration runner: `All migrations completed` (mostly no-ops since schema was applied in step 3).
- `🗃️ Running SAML database setup...` → `✅ Database setup completed`.
- `🚀 Starting Next.js server...` → `✓ Ready in <ms>`.
- No Prisma client errors. No "column does not exist" failures.

Ctrl-C the log tail once steady.

---

## 7. Post-Deploy Smoke Tests

Run all of these against `https://surveys.asla.org`. Tick each before declaring success.

1. [ ] Open in incognito → branded login page renders. The "Sign in with Microsoft" button is visible (M365 SSO ships in the same image).
2. [ ] Hit a live survey URL `https://surveys.asla.org/s/<known-live-id>` → loads and accepts a response.
3. [ ] Sign in as `gcohen@asla.org` → survey list shows **all** surveys (same count as pre-deploy).
4. [ ] Sign in as a non-admin member → survey list shows only the **grandfathered** (public) surveys (same count as pre-deploy, since everything was made public).
5. [ ] As that member, click "New Survey" → survey is created with `visibility = private`. Reload — only the creator sees it. (Other non-admin members do **not** see it.)
6. [ ] As the creator, open Settings → **Sharing** card → flip to "Public" → another non-admin member can now see it in their list.
7. [ ] Set back to "Private" → add the other member via the access list → they see it. Remove them → they don't.
8. [ ] As gcohen, Org Settings → Members → toggle a member's "Survey Admin" on → sign in as that member → they now see all surveys. Toggle off → access reverts.
9. [ ] Submit a response to a live survey → check Snowflake export landed (pipeline logs + Snowflake row).
10. [ ] Check active webhook destination(s) received the response payload.

If any item fails: see Rollback (App Stage) below.

---

## 8. 30-Minute Observation Period

Tail logs in two windows for 30 minutes:

```bash
docker compose logs -f --tail=0 formbricks
```

Watch for:
- `403` / `404` spikes on respondent endpoints (`/s/...`, `/api/v1/client/...`) — should be near zero.
- Repeated Prisma errors mentioning `surveyAccess`, `visibility`, or `surveyAdmin`.
- `AuthorizationError: You do not have access to this survey.` from the new `loadSurveyForAccess` helper — could indicate a missing membership for someone who should have access. A handful is fine (someone hitting an old bookmark to a private survey); a flood is a sign the ACL is too tight.
- `OperationNotAllowedError: Only existing survey admins can manage this.` — same logic; ignore unless flooded.

Spot-check Snowflake:
```sql
SELECT count(*) FROM <responses-table> WHERE received_at > DATEADD('minute', -30, CURRENT_TIMESTAMP());
```
Should be in the normal range — no zero, no order-of-magnitude drop.

If the 30-minute window passes clean: ship is complete. The CI-generated `:sha-<commit>` tag pinned at deploy time serves as the new known-good rollback handle.

---

## Rollback Procedures

| Scenario | Action |
|---|---|
| **Migration step 3 fails** | Schema is unchanged (migration is transactional). Old image keeps running. Investigate before retrying. |
| **Data migration step 4 fails partway** | Re-run — script is idempotent. If gcohen flagging is wrong: `UPDATE "Membership" SET "surveyAdmin"=false WHERE "userId" != '<gcohen-id>';` |
| **Respondent smoke test fails after step 5** | Restore DB from backup; old image is still running so app is fine. Investigate. |
| **App boot fails after step 6** | See "App rollback" below. |
| **ACL is unexpectedly blocking admins/respondents post-deploy** | Emergency: `UPDATE "Survey" SET visibility='public';` (flips everything visible). Then `docker compose restart formbricks`. Investigate root cause without time pressure. |
| **Catastrophic** | App rollback **and** DB restore from `pre-acl-${TS}.sql.gz`. |

### App rollback (image-only)

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_workgh gregcohen@20.185.219.8
cd /opt/formbricks
docker tag ghcr.io/asla1899/formbricks:pre-acl-backup ghcr.io/asla1899/formbricks:latest
docker compose up -d --force-recreate formbricks
```

The schema stays in place — old code ignores `visibility`, `surveyAdmin`, `SurveyAccess`. No DB rollback needed.

### Schema rollback (rare — only if you want a fully clean revert)

```sql
ALTER TABLE "Membership" DROP COLUMN "surveyAdmin";
ALTER TABLE "Survey" DROP COLUMN "visibility";
DROP TABLE "SurveyAccess";
DROP TYPE "SurveyVisibility";
```

(Old image keeps running; nothing else to revert.)

### Catastrophic DB restore

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_workgh gregcohen@20.185.219.8
cd /opt/formbricks
docker compose stop formbricks
gunzip -c /opt/formbricks/backups/pre-acl-${TS}.sql.gz | \
  docker exec -i formbricks-postgres psql -U formbricks -d formbricks
docker tag ghcr.io/asla1899/formbricks:pre-acl-backup ghcr.io/asla1899/formbricks:latest
docker compose up -d formbricks
```

---

## Sign-Off

- [ ] DB backup at `/opt/formbricks/backups/pre-acl-${TS}.sql.gz` retained for ≥ 7 days
- [ ] `:pre-acl-backup` and `:sha-<previous-commit>` image tags retained
- [ ] All 10 smoke tests passed
- [ ] 30-minute observation clean
- [ ] gcohen sees all surveys; non-admins see grandfathered set; new surveys default private — verified by direct user test, not just SQL
- [ ] M365 SSO button visible at login (smoke test of the bundled feature)

**Operator:** ____________________
**Date/Time UTC:** ____________________
**Image SHA shipped:** ____________________
**Pre-acl backup retained until:** ____________________
