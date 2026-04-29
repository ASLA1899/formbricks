# Phase 1a — Contact Mirror Rollout Runbook

**Prepared for:** ASLA IT (gcohen@asla.org)
**Feature:** Snowflake → Formbricks Contact mirror foundation on `https://surveys.asla.org`
**Branch:** `feature/contact-mirror-phase-1a` (worktree at `~/dev/formbricks-phase1a/`)
**Deploy mechanism:** GHCR image push/pull (per `CLAUDE.md` — VM cannot build)
**Spec:** `docs/superpowers/specs/2026-04-27-audience-system-redesign-design.md`
**Plan:** `docs/superpowers/plans/2026-04-28-audience-system-phase-1a.md`

This runbook executes the deploy in **gated steps**. Phase 1a is purely additive — every change is backwards-compatible (typed columns are nullable; existing email-attribute lookups still work via the legacy fallback path) — so the rollback path is simple. The new sync runs only when an operator configures and enables a `ContactSync` row, so an idle deploy has zero behavioural change.

> ⚠️ **Step 4 (local smoke test) is load-bearing.** Skip it and you may not catch a Snowflake credential or column-mapping issue until after a real sync touches production Contacts.

---

## What This Phase Ships

| User-visible change | Where |
|---|---|
| Settings → "Snowflake Sync" page | `/environments/<env>/settings/snowflake-sync` |
| Run Sync Now button + run history | same page |
| Source badge on Contact detail (Snowflake / Manual / CSV) | `/environments/<env>/contacts/<id>` |
| Inactive banner on Contact detail when `inactive=true` | same |
| Source + active filters on contacts list | `/environments/<env>/contacts` (URL params `?source=&active=`) |
| CSV upload now captures arbitrary columns as attributes | Recipients & Reminders → Upload CSV |
| Cron `/api/cron/reminders` also runs due ContactSyncs | every 5 min on the VM |

## What This Phase Does NOT Ship (Phase 1b)

- New `Audience` table or Audiences UI page.
- `surveyDerived` audience type.
- Survey audience picker rewrite — existing manual-list / segment / Snowflake-query flows still work as today.
- Demographics snapshot on `SurveyInvitation`.
- Reverse-ETL of responses to Snowflake (Phase 2).

## Architecture Recap

- **Two new Prisma tables:** `ContactSync` (config; one per environment in v1, enforced by `@unique([environmentId])`) and `ContactSyncRun` (audit log per sync run).
- **Five new Contact columns:** `email`, `externalId`, `source`, `inactive`, `inactiveAt`. `email` and `externalId` are partial-unique per environment (raw SQL — Prisma can't express `WHERE` on indexes natively).
- **Source semantics:** `snowflake` rows are sync-managed (sync overwrites mapped fields; `inactive` is set when they drop out of the source query). `manual` and `csv` rows are protected — the sync runner never touches them.
- **Cron:** the sync runner piggybacks on the existing `/api/cron/reminders` endpoint, gated by per-row `intervalMinutes + lastRunAt`. No new system cron entry.

---

## Pre-Flight Checklist

- [ ] `feature/contact-mirror-phase-1a` is up to date locally and tests pass:
      `pnpm --filter @formbricks/web vitest run modules/contacts modules/survey/invitations modules/ee/contacts` → 387/387 green.
- [ ] Pre-existing Snowflake creds in `.env.docker` and on the VM are still valid (the new sync uses the same `SNOWFLAKE_*` env vars as the existing member-lookup feature).
- [ ] A Snowflake query is registered in `apps/web/app/api/member-lookup/query-config.json` that returns the contact set you want mirrored. The query must return at minimum an `email` column. `externalId` (member number) is strongly recommended as the canonical identity. Other columns become attributes.
- [ ] You have a recent prod DB backup (`/opt/formbricks/backups/` on the VM).

---

## Step 1 — Build + push the GHCR image

From the Mac, in the worktree:

```bash
cd ~/dev/formbricks-phase1a
git status                  # confirm: feature/contact-mirror-phase-1a, clean
git rev-parse --short HEAD  # capture the SHA — you'll tag :sha-<this>
./scripts/build-and-push.sh # builds linux/amd64, pushes :latest + :sha-<short>
```

The build takes ~10 min and ~10 GB RAM. Confirm both tags landed on GHCR before moving on.

**Capture the rollback handle:** before retagging `:latest` on the VM, you'll create a `:pre-phase1a-backup` tag pointing at the currently-running image (Step 3). This is your one-click revert.

---

## Step 2 — Pre-deploy DB backup

```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "cd /opt/formbricks && docker compose exec -T postgres pg_dump -U postgres formbricks | gzip > /opt/formbricks/backups/pre-phase1a-$(date +%Y%m%d-%H%M%S).sql.gz"
```

Verify the backup file size is roughly the same as the most recent backup. If significantly smaller, investigate before continuing.

---

## Step 3 — Tag rollback handle, pull, restart

On the VM:

```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8

cd /opt/formbricks

# Capture current running image SHA for one-click rollback
CURRENT=$(docker compose images formbricks --format '{{.Tag}}' | head -1)
docker tag ghcr.io/asla1899/formbricks:$CURRENT ghcr.io/asla1899/formbricks:pre-phase1a-backup

# Pull the new image (whatever sha you tagged in Step 1)
docker compose pull formbricks

# Restart — the entrypoint runs db:migrate:deploy, which copies the two new
# migration files from packages/database/migration/ into Prisma's standard
# migrations/ dir and applies them. Phase 1a's migrations are idempotent.
docker compose up -d formbricks
```

Wait ~30 seconds, then check the container logs:

```bash
docker compose logs --tail=100 formbricks | grep -E "migration|Listening|Error"
```

Expected:
- `Successfully applied schema migration: 20260428140959_add_contact_mirror_columns`
- `Successfully applied schema migration: 20260428192313_add_contact_sync`
- `Listening on port 3000`

If you see `RAISE NOTICE` output mentioning duplicate-email rows being left with NULL typed-email, that's expected behaviour — those duplicates can be reconciled later via the UI. Note the count for follow-up.

---

## Step 4 — Local smoke test (BEFORE configuring prod)

Don't configure a real Snowflake sync against production yet. Smoke-test against the local Docker stack first:

```bash
cd ~/dev/formbricks-phase1a
# --env-file .env.docker is REQUIRED — the Dockerfile mounts DATABASE_URL_BUILD,
# REDIS_URL_BUILD, and ENCRYPTION_KEY_BUILD as build-time secrets via docker
# compose's `secrets:` block, and those vars only live in .env.docker (not the
# project's default .env). Without it the build aborts with
# "Invalid environment variables: DATABASE_URL is not a valid URL".
docker compose -p formbricks-phase1a --env-file .env.docker -f docker-compose.local.yml up -d --build
# Wait ~10 min for the build, then:
docker compose -p formbricks-phase1a --env-file .env.docker -f docker-compose.local.yml logs --tail=50 formbricks
```

Visit `http://localhost:3001/`. Sign in with the seeded user (or create one).

### 4a. Configure the sync via UI

- Visit `/environments/<env-id>/settings/snowflake-sync`.
- Pick a query from the dropdown (whichever Snowflake query you want to mirror — the registry is in `apps/web/app/api/member-lookup/query-config.json`).
- Click **Preview rows + detect columns**. Verify:
  - Sample rows render (5 rows, totalRows reported).
  - Auto-detected mapping looks correct: `EMAIL` → `typed:email`, `MEMBER_ID` (or similar) → `typed:externalId`, demographic columns → existing attribute keys when present, otherwise `unmapped`.
- Override mappings as needed for any unmapped columns. Set the interval (default 60 min is fine).
- Click **Save configuration**. Verify the form saves cleanly (no toast error).

### 4b. Trigger a sync run

- Click **Run sync now**. Wait — the button shows "Running…" until the sync finishes.
- On success: toast shows e.g. `Synced 1234 rows: 1234 created, 0 updated, 0 deactivated`.
- The Recent Runs table now shows one row with status `succeeded`.

Verify in the DB:

```bash
docker compose -p formbricks-phase1a -f docker-compose.local.yml exec postgres \
  psql -U postgres -d formbricks -c \
  "SELECT source, COUNT(*) FROM \"Contact\" GROUP BY source;"
# Expected: snowflake | <total Snowflake row count>
```

### 4c. Verify Contact detail page

- Visit `/environments/<env>/contacts`.
- Default view = active contacts of all sources. Click the **Snowflake** chip — list narrows.
- Click any contact. Verify:
  - "Synced from Snowflake" sky-blue badge at top.
  - `email` row shows the typed value.
  - `externalId` row shows the member number via `IdBadge`.
  - Demographic attributes show with a small "from Snowflake" pill if they were mapped to attributes via the sync config.

### 4d. Verify the inactive flow

This is the trickiest behaviour to verify. Fake it:

```bash
docker compose -p formbricks-phase1a -f docker-compose.local.yml exec postgres \
  psql -U postgres -d formbricks -c \
  "UPDATE \"Contact\" SET inactive=true, \"inactiveAt\"=NOW() WHERE source='snowflake' LIMIT 1;"
```

Visit that contact's detail page. Verify:
- Rose-coloured "This contact is marked inactive (since…)" banner.
- The contacts list with `?active=false` shows them. With `?active=all`, they appear alongside active contacts.

Then click **Run sync now** again. The sync should re-find them in Snowflake and clear `inactive=false` automatically. Verify the banner disappears.

### 4e. Verify CSV import

- Visit a survey's Recipients & Reminders → Upload CSV.
- Upload a CSV with `email,firstName,region` (where `region` is NOT yet a `ContactAttributeKey`). Verify the column-mapping modal appears (because `region` is unmapped).
- Confirm the modal lets you map `region` → an existing attribute key OR skip.
- Send invitations. Open one of the resulting Contacts. Verify the `region` attribute persists AND the contact's source is `csv`.

### 4f. Verify cron loop

```bash
CRON_SECRET=$(grep CRON_SECRET .env.docker | cut -d= -f2)
curl -X POST -H "x-api-key: $CRON_SECRET" http://localhost:3001/api/cron/reminders
# Expected: { ok: true, invitations: ..., reminders: ..., syncs: [...] }
```

The `syncs` array shows per-sync results. If `intervalMinutes` hasn't elapsed since the previous run, `syncs` will be `[]` — that's correct behaviour, not a bug.

Manually advance the clock for testing by setting `lastRunAt` back in time:

```bash
docker compose -p formbricks-phase1a -f docker-compose.local.yml exec postgres \
  psql -U postgres -d formbricks -c \
  "UPDATE \"ContactSync\" SET \"lastRunAt\"=NOW() - INTERVAL '2 hours';"
```

Then re-curl the cron endpoint — the sync should fire and a new run row appears.

---

## Step 5 — Configure the production sync

Only after Step 4 passes cleanly:

- On `https://surveys.asla.org/environments/<prod-env>/settings/snowflake-sync`, repeat 4a — pick the production-equivalent query, preview, configure mapping, save.
- Click **Run sync now**. Monitor the run history table. The first sync may take 30s–2m for ASLA's member count; that's expected.
- Spot-check 5–10 random Contacts on the contacts list — verify they have `source=snowflake` and the expected attributes.
- Spot-check a few Segments (e.g. "members in the Northeast region") that previously filtered on `attribute.region` — they should still work since the sync writes BOTH the attribute AND the typed columns.

---

## Step 6 — Monitor for 24h

- The cron runs every 5 min on the VM. Watch a couple of cycles for sync runs to confirm `intervalMinutes` gating works as expected.
- If the production sync produces unexpected `rowsDeactivated` counts (e.g. 1000+ contacts marked inactive on the second run), STOP and investigate — the sync's deactivation rule treats anyone NOT in the source query as inactive, so a query change between runs would visibly bulk-deactivate.
- Operator-visible failures show inline on the Settings → Snowflake Sync page (run history table).

---

## Rollback

If the deploy needs to be reverted:

### Code-only rollback (schema stays, sync just disables)

Toggle `enabled=false` on the ContactSync row via the Settings UI, OR via SQL:

```bash
docker compose exec postgres psql -U postgres -d formbricks -c \
  "UPDATE \"ContactSync\" SET enabled=false;"
```

The cron skips disabled syncs. No further data drift; existing snowflake-source Contacts persist as-is.

### Image-level rollback

```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8

cd /opt/formbricks
docker tag ghcr.io/asla1899/formbricks:pre-phase1a-backup ghcr.io/asla1899/formbricks:latest
docker compose up -d formbricks
```

The schema additions (Phase 1a's two migration files) remain applied — they're additive and the old code ignores the new columns. No data loss.

### Full schema rollback (only if the migrations themselves caused damage)

Restore from the backup taken in Step 2:

```bash
docker compose exec postgres psql -U postgres -d formbricks -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c /opt/formbricks/backups/pre-phase1a-<timestamp>.sql.gz | docker compose exec -T postgres psql -U postgres -d formbricks
```

This is a destructive operation — every table is dropped and recreated from the backup. Only do this if the additive schema migrations themselves corrupted state, which is extremely unlikely.

---

## Known Limitations / Follow-ups

Filed as P3 beads issues, deferrable:
- `beads-1be` — i18n: lift inline English strings on Contact detail attributes section.
- `beads-6gu` — Cleanup: stale `userId` field in ZContact Zod schema.
- `beads-pbc` — Snowflake-sync UX: warn on stale `attr:<id>` references.

Out-of-scope by design (Phase 1b or later):
- Multiple ContactSync configs per environment (Phase 4).
- Audiences page, surveyDerived audience type (Phase 1b).
- Stale-`running`-run sweeper for crash-mid-loop cleanup — TODO comment in `apps/web/modules/contacts/lib/sync.ts`.
- Reverse-ETL of survey responses to Snowflake (Phase 2).

## Useful Commands

```bash
# Recent sync runs across all environments
docker compose exec postgres psql -U postgres -d formbricks -c \
  "SELECT cs.\"environmentId\", csr.\"startedAt\", csr.status, csr.\"rowsProcessed\", csr.\"rowsCreated\", csr.\"rowsUpdated\", csr.\"rowsDeactivated\", csr.\"errorMessage\" FROM \"ContactSyncRun\" csr JOIN \"ContactSync\" cs ON cs.id = csr.\"syncId\" ORDER BY csr.\"startedAt\" DESC LIMIT 20;"

# Contact source breakdown
docker compose exec postgres psql -U postgres -d formbricks -c \
  "SELECT \"environmentId\", source, COUNT(*) FROM \"Contact\" GROUP BY \"environmentId\", source ORDER BY 1, 2;"

# Inactive contacts
docker compose exec postgres psql -U postgres -d formbricks -c \
  "SELECT \"environmentId\", COUNT(*) FROM \"Contact\" WHERE inactive=true GROUP BY \"environmentId\";"

# Force a sync to fire on next cron tick
docker compose exec postgres psql -U postgres -d formbricks -c \
  "UPDATE \"ContactSync\" SET \"lastRunAt\"=NOW() - INTERVAL '2 hours' WHERE \"environmentId\"='<env-id>';"
```
