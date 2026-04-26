# Survey ACL — Production Rollout Runbook

**Prepared for:** ASLA IT (gcohen@asla.org)
**Feature:** Per-survey access control on `https://surveys.asla.org`
**Branch:** `feature/survey-acl`

This runbook executes the deploy in **gated steps** so a respondent-side regression is caught **before** the app code ships. The schema migration is applied first, against a still-running old image — old code ignores the new columns, so the worst case at that point is a clean revert.

> ⚠️ Do **not** skip step 4 (live respondent smoke test). It is the load-bearing check between schema migration and app deploy.

---

## What This Feature Does

- **Existing surveys:** grandfathered to `visibility = public` — every ASLA member sees them, exactly as today.
- **New surveys:** default to `visibility = private` — only the creator + survey admins + people on the SurveyAccess list see them.
- **`gcohen@asla.org`:** auto-granted `Membership.surveyAdmin = true` — sees everything.
- **Respondent flow (`/s/<id>`, `/api/v1/client/...`):** unchanged. The ACL applies only to the admin UI.
- **System pipeline, webhooks, integrations, API tokens:** unchanged. ACL does not apply.

## What This Feature Does NOT Touch

- Microsoft 365 SSO (`299f6f52a` + `14ac8ce0e`) — independent.
- Org roles (`owner` / `manager` / `member` / `billing`) — unchanged. The new `surveyAdmin` flag is a separate axis.
- Snowflake export, response submission, public survey URLs.

---

## Pre-Flight Checklist

- [ ] DB backup taken **and verified restorable** within the last hour.
  ```bash
  ssh -p 2222 -i ~/.ssh/id_ed25519_workgh asla@20.185.219.8 \
    'cd /opt/formbricks && docker compose exec -T postgres pg_dump -U formbricks formbricks | gzip > /opt/formbricks/backups/pre-acl-$(date +%Y%m%d-%H%M%S).sql.gz'
  ```
- [ ] `gcohen@asla.org` exists in production `User` table.
  ```bash
  ssh -p 2222 -i ~/.ssh/id_ed25519_workgh asla@20.185.219.8 \
    'cd /opt/formbricks && docker compose exec -T postgres psql -U formbricks -d formbricks \
      -c "SELECT id, email FROM \"User\" WHERE email = '\''gcohen@asla.org'\'';"'
  ```
  Expected: one row.
- [ ] Local dev DB validation completed (schema push + migration script idempotency confirmed).
- [ ] No active maintenance windows or live invitation campaigns in flight.
- [ ] Slack/email standby — let stakeholders know a brief look-and-feel change is coming.

---

## 1. Build & Stage the New Image (locally)

Per `MEMORY.md` deployment process — VM cannot build (OOM at 8 GB).

```bash
cd /Users/gcohen/dev/formbricks-survey-acl
git checkout feature/survey-acl
git pull --ff-only

docker buildx build --platform linux/amd64 \
  --secret id=DATABASE_URL,src=.secrets/DATABASE_URL \
  --secret id=ENCRYPTION_KEY,src=.secrets/ENCRYPTION_KEY \
  --secret id=NEXTAUTH_SECRET,src=.secrets/NEXTAUTH_SECRET \
  -t formbricks-local:survey-acl-amd64 \
  -f apps/web/Dockerfile .

docker save formbricks-local:survey-acl-amd64 | gzip | \
  ssh -p 2222 -i ~/.ssh/id_ed25519_workgh asla@20.185.219.8 \
    'gunzip | docker load'
```

**Do not start the new image yet.** It's just staged on the VM.

Tag the currently-running production image as a backup before doing anything destructive:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_workgh asla@20.185.219.8 \
  'docker tag formbricks-local:dropdown-fix-v2-amd64 formbricks-local:pre-acl-backup'
```

---

## 2. Apply Schema Migration (no app deploy yet)

The schema is **additive** — adding `Membership.surveyAdmin`, `Survey.visibility`, and the `SurveyAccess` table — so the still-running production image can ignore these columns without error.

Use `prisma db push` (per project convention; no migration files):

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_workgh asla@20.185.219.8

# inside the VM
cd /opt/formbricks
git fetch origin
git checkout feature/survey-acl
git pull --ff-only

# Push schema using the new image (without restarting the running web container)
docker run --rm \
  --network host \
  -v "$PWD/packages/database/schema.prisma:/app/packages/database/schema.prisma" \
  -e DATABASE_URL="$(grep ^DATABASE_URL .env | cut -d= -f2-)" \
  formbricks-local:survey-acl-amd64 \
  pnpm --filter @formbricks/database db:push
```

Verify:

```bash
docker compose exec -T postgres psql -U formbricks -d formbricks -c '\d "Survey"'   | grep -E 'visibility'
docker compose exec -T postgres psql -U formbricks -d formbricks -c '\d "Membership"' | grep -E 'surveyAdmin'
docker compose exec -T postgres psql -U formbricks -d formbricks -c '\d "SurveyAccess"'
```

Expected:
- `visibility | "SurveyVisibility" | not null default 'private'`
- `surveyAdmin | boolean | not null default false`
- `SurveyAccess` table with PK `(surveyId, userId)` + index on `userId`.

**App at this point:** unchanged production image is still running. Old code does not read the new columns — the site continues working.

---

## 3. Run the Data Migration

```bash
# inside the VM, /opt/formbricks
docker compose exec -T postgres psql -U formbricks -d formbricks \
  -f - < scripts/2026-04-26-survey-acl-migration.sql
```

Watch for these `NOTICE` lines:

```
NOTICE:  Found survey-admin user: gcohen@asla.org (id=...)
NOTICE:  N memberships updated to surveyAdmin=true
NOTICE:  M existing surveys set to visibility=public (grandfather)
```

Expected: N ≥ 1 (at least one membership for gcohen). M = current production survey count. If `N == 0` and gcohen has memberships, something is wrong — abort and investigate.

Sanity:

```bash
docker compose exec -T postgres psql -U formbricks -d formbricks -c \
  "SELECT u.email, m.\"surveyAdmin\" FROM \"Membership\" m JOIN \"User\" u ON u.id=m.\"userId\" WHERE m.\"surveyAdmin\";"

docker compose exec -T postgres psql -U formbricks -d formbricks -c \
  "SELECT visibility, count(*) FROM \"Survey\" GROUP BY visibility;"
```

Expected:
- Only gcohen's memberships are surveyAdmin=true.
- Every existing survey is visibility=public (count matches pre-migration `count(*)`).

---

## 4. ⚠️ Live Respondent Smoke Test (BEFORE deploying app code)

This is the gate. If respondents broke after the schema migration, you find out **now** when rolling forward is still cheap.

Open an incognito window. Hit a known-live survey URL:

```
https://surveys.asla.org/s/<known-live-survey-id>
```

- [ ] Page loads.
- [ ] Survey renders (questions/welcome card visible).
- [ ] Submit a response.
- [ ] Response landed: check Snowflake (`SELECT * FROM <table> ORDER BY received_at DESC LIMIT 1;`) and any active webhook destination.

If anything is broken: see Rollback (Schema Stage) below.

If everything is green: continue.

---

## 5. Deploy the New App Image

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519_workgh asla@20.185.219.8

cd /opt/formbricks
# Update docker-compose to point web service at survey-acl image, OR retag:
docker tag formbricks-local:survey-acl-amd64 formbricks-local:dropdown-fix-v2-amd64

docker compose up -d web
docker compose logs -f --tail=200 web
```

Watch startup logs. Expected: clean Next.js boot, no Prisma client errors, no "column does not exist" failures. Ctrl-C the log tail once steady.

---

## 6. Post-Deploy Smoke Tests

Run all of these. Tick each before declaring success.

1. [ ] Open https://surveys.asla.org in incognito → branded login renders.
2. [ ] Hit a live survey URL `https://surveys.asla.org/s/<known-live-id>` → loads and accepts a response.
3. [ ] Sign in as `gcohen@asla.org` → survey list shows **all** surveys (same count as pre-deploy).
4. [ ] Sign in as a non-admin member → survey list shows only the **grandfathered** (public) surveys (also same count as pre-deploy, since everything was made public).
5. [ ] As that member, click "New Survey" → new survey is created with `visibility = private`. Reload — only the creator sees it.
6. [ ] As the creator, open Settings → Sharing → flip to "Public" → another non-admin member can now see it in their list.
7. [ ] Set back to "Private" → add the other member via the access list → they see it.
8. [ ] Submit a response to a live survey → check Snowflake export landed (pipeline logs + table).
9. [ ] Check active webhook destination(s) received the response payload.

If any item fails: see Rollback (App Stage) below.

---

## 7. 30-Minute Observation Period

Tail logs in two windows for 30 minutes:

```bash
docker compose logs -f --tail=0 web
```

Watch for:
- `403` / `404` spikes on respondent endpoints (`/s/...`, `/api/v1/client/...`) — should be near zero.
- Repeated Prisma errors mentioning `surveyAccess`, `visibility`, or `surveyAdmin`.
- Authorization errors that look like the new `loadSurveyForAccess` helper rejecting legitimate access (could indicate a missing membership for someone who should have one).

Spot-check Snowflake:
```sql
SELECT count(*) FROM <table> WHERE received_at > DATEADD('minute', -30, CURRENT_TIMESTAMP());
```
Should be in the normal hourly range — no zero, no order-of-magnitude drop.

If the 30-minute window passes clean: ship is complete. Tag the image as the new known-good:

```bash
docker tag formbricks-local:survey-acl-amd64 formbricks-local:known-good-$(date +%Y%m%d)
```

---

## Rollback Procedures

| Scenario | Action |
|---|---|
| **App boot fails after deploy** | `docker compose down web && docker tag formbricks-local:pre-acl-backup formbricks-local:dropdown-fix-v2-amd64 && docker compose up -d web`. Schema stays — old code ignores new columns. |
| **ACL is blocking respondents (unexpected)** | Respondent paths don't use ACL; if /s/ is broken, the schema or app boot is the cause, not the ACL. Roll back the app image. |
| **ACL is blocking admins who should have access** | Surface emergency: temporarily flip everything public: `UPDATE "Survey" SET visibility='public';`. Then restart web. Investigate root cause without time pressure. |
| **Migration partial / wrong** | Re-run the migration script (idempotent). If gcohen flagging is wrong: `UPDATE "Membership" SET "surveyAdmin"=false WHERE "userId" != '<gcohen-id>';`. |
| **Catastrophic** | `docker compose stop web` → restore the pre-migration backup: `gunzip -c /opt/formbricks/backups/pre-acl-<ts>.sql.gz \| docker compose exec -T postgres psql -U formbricks -d formbricks` → restart with the pre-acl-backup image. |

### Schema-Stage Rollback (post step 2 / before step 5)

The new columns are nullable-with-default and additive — they're harmless to leave in place if you decide to abort the rollout. But if you want a fully clean revert:

```sql
ALTER TABLE "Membership" DROP COLUMN "surveyAdmin";
ALTER TABLE "Survey" DROP COLUMN "visibility";
DROP TABLE "SurveyAccess";
DROP TYPE "SurveyVisibility";
```

(Old image keeps running; nothing else to revert.)

---

## Sign-Off

- [ ] Deploy completed
- [ ] All 9 smoke tests passed
- [ ] 30-minute observation clean
- [ ] Pre-acl-backup image and pre-migration DB backup retained for at least 7 days
- [ ] gcohen@asla.org sees all surveys; non-admin members see grandfathered set; new surveys default private — verified by direct user test, not just SQL

**Operator:** ____________________
**Date/Time UTC:** ____________________
