# Formbricks Deployment Guide - Azure VM

Complete guide for deploying custom Formbricks builds to the Azure VM (nan01).

## Overview

**Fork:** `github.com/ASLA1899/formbricks`
**Branch:** `feature/dropdown-display-option`
**Production URL:** https://surveys.asla.org
**VM Location:** `/opt/formbricks/`

### Why Build Locally?

The Azure VM (8GB RAM + 4GB swap) cannot build Formbricks Docker images. Next.js builds require 8-10GB+ memory and cause OOM kills on the VM.

**Solution:** Build on your Mac, push to GHCR, pull on the VM.

## Prerequisites

- Docker with buildx support
- SSH access to Azure VM
- Build secrets configured (`.secrets/` directory)
- GHCR classic PAT with `write:packages` scope (shared with contractiq2 deploy)

### Build Secrets Setup

Create secrets directory with required files:

```bash
cd /Users/gcohen/dev/formbricks
mkdir -p .secrets

# Add your secrets (get from 1Password or existing .env)
echo "postgresql://user:pass@host:5432/db" > .secrets/database_url
echo "your-32-char-encryption-key-here" > .secrets/encryption_key
echo "redis://host:6379" > .secrets/redis_url
echo "" > .secrets/sentry_auth_token  # Optional
echo "ghp_your_pat_here" > .secrets/ghcr_token  # write:packages scope
chmod 600 .secrets/*
```

`.secrets/` is excluded from git locally via `.git/info/exclude` (avoids conflicts with upstream's `.gitignore`).

## Standard Deployment Process

### Step 1: Build and Push to GHCR

```bash
cd /Users/gcohen/dev/formbricks

# Make sure you're on the right branch
git checkout feature/dropdown-display-option
git pull

./scripts/build-and-push.sh
```

The script logs into GHCR, runs `docker buildx build --platform linux/amd64 --push`, and tags the image as both `ghcr.io/asla1899/formbricks:latest` and `ghcr.io/asla1899/formbricks:sha-<short>` for rollback.

**Build time:** ~15-20 minutes on M-series Mac (build + push)

**Troubleshooting:**
- If build fails with TypeScript errors, rebase on upstream
- Sentry auth errors are non-fatal (source maps won't upload but build completes)
- For a fresh build without cache, set `DOCKER_BUILDKIT_NO_CACHE=1` before running the script, or temporarily add `--no-cache` to the `docker buildx build` line in `scripts/build-and-push.sh`

### Step 2: Deploy on the VM

```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "cd /opt/formbricks && docker compose pull formbricks && docker compose up -d formbricks"
```

**What this does:**
1. VM's docker daemon (pre-authenticated via `/opt/formbricks/.secrets/ghcr_token`, a read-only PAT) pulls `ghcr.io/asla1899/formbricks:latest`
2. `docker compose up -d` recreates the formbricks container with the new image
3. Postgres/Redis/MinIO sidecars are left alone (they're stateful)

### Step 3: Apply Database Schema Changes (If Needed)

If your changes include Prisma schema updates:

```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "cd /opt/formbricks && \
   docker compose exec formbricks sh -c 'cd packages/database && npx prisma db push --skip-generate --accept-data-loss'"
```

**Note:** We use `prisma db push` instead of `migrate deploy` because this fork doesn't maintain migration files.

### Step 4: Verify Deployment

```bash
# Check container status
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "docker ps | grep formbricks"

# Check logs (should see "Ready in Xms")
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "docker logs formbricks --tail 50"

# Test HTTP response
curl -s -o /dev/null -w "%{http_code}" https://surveys.asla.org/
# Should return: 200
```

## Important Notes

### Docker Image Naming

The VM's `docker-compose.yml` references:
```
ghcr.io/asla1899/formbricks:latest
```

`build-and-push.sh` always tags both `:latest` and `:sha-<short>`, so `docker compose pull` picks up the new `:latest` on every deploy.

### Cache Issues

If you make code changes but the deployed container doesn't reflect them, rebuild without cache by temporarily editing `scripts/build-and-push.sh` to add `--no-cache` to the `docker buildx build` invocation. Turborepo's internal cache can also bypass this — the Dockerfile uses a fresh checkout, so a new git SHA should always produce fresh output.

### Database Migrations

This fork uses direct schema pushes instead of migration files:

```bash
# Check what changes will be applied
npx prisma db push --help

# Apply schema (use inside container)
docker compose exec formbricks sh -c 'cd packages/database && npx prisma db push --skip-generate'
```

**To check if table exists:**
```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "cd /opt/formbricks && \
   docker compose exec postgres psql -U formbricks -d formbricks -c '\dt'"
```

## VM Configuration

### File Structure

```
/opt/formbricks/
├── docker-compose.yml      # Service definitions
├── .env                    # Environment variables (DATABASE_URL, secrets, etc.)
└── uploads/               # Persistent user uploads
```

### docker-compose.yml Service

```yaml
services:
  formbricks:
    image: ghcr.io/asla1899/formbricks:latest
    container_name: formbricks
    restart: unless-stopped
    depends_on:
      - postgres
      - redis
      - minio
    environment:
      WEBAPP_URL: https://surveys.asla.org
      DATABASE_URL: postgresql://formbricks:${POSTGRES_PASSWORD}@postgres:5432/formbricks
      # ... other env vars
```

### Quick Fixes

**Container won't start:**
```bash
# Check logs
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "docker logs formbricks"

# Common issues:
# - Database connection (check DATABASE_URL in .env)
# - Missing environment variables
# - Port conflicts (unlikely with Caddy reverse proxy)
```

**Rollback to a previous SHA:**
```bash
# Pull the known-good SHA and retag it as :latest, then bounce the container
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "sudo docker pull ghcr.io/asla1899/formbricks:sha-<good-sha> && \
   sudo docker tag ghcr.io/asla1899/formbricks:sha-<good-sha> ghcr.io/asla1899/formbricks:latest && \
   cd /opt/formbricks && sudo docker compose up -d formbricks"
```

**Clean up old images:**
```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "docker image prune -a"
```

## Updating the Fork

When upstream Formbricks releases updates:

```bash
cd /Users/gcohen/dev/formbricks

# Add upstream if not already added
git remote add upstream https://github.com/formbricks/formbricks.git

# Fetch and rebase
git fetch upstream
git checkout feature/dropdown-display-option
git rebase upstream/main

# Resolve conflicts if any
# Then force push (careful!)
git push origin feature/dropdown-display-option --force-with-lease

# Rebuild and deploy
```

## Complete Deployment Checklist

Use this for deployments:

```
Pre-deployment:
[ ] Code committed and pushed to origin
[ ] On correct branch (feature/dropdown-display-option)
[ ] Build secrets configured in .secrets/ (including ghcr_token)

Build + Push:
[ ] ./scripts/build-and-push.sh completed successfully
[ ] Image pushed as :latest and :sha-<short> to ghcr.io/asla1899/formbricks

Deploy:
[ ] VM pulled the new image (docker compose pull formbricks)
[ ] Container recreated (docker compose up -d formbricks)

Post-deployment:
[ ] Database schema applied (if schema changes)
[ ] Container running (docker ps shows formbricks)
[ ] Logs show "Ready in Xms"
[ ] Site accessible: https://surveys.asla.org/ returns 200
[ ] Feature tested in browser

Cleanup:
[ ] Deployment documented in changelog/notes
```

## Monitoring & Health Checks

**Container health:**
```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "docker ps --filter name=formbricks --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
```

**Database connections:**
```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "cd /opt/formbricks && docker compose exec postgres psql -U formbricks -d formbricks -c 'SELECT count(*) FROM pg_stat_activity;'"
```

**Disk space:**
```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "df -h /var/lib/docker"
```

## Troubleshooting

### Build Issues

**Problem:** TypeScript compilation errors
**Solution:** Rebase on upstream main, resolve conflicts

**Problem:** Out of memory during build
**Solution:** Ensure you're building locally (Mac), not on VM

**Problem:** "Failed to load secrets"
**Solution:** Check `.secrets/` directory exists with all required files

### Deployment Issues

**Problem:** Container shows old code after deployment
**Solution:** Confirm the image SHA changed on GHCR (rebuild with `--no-cache` if cache was stale); verify VM ran `docker compose pull formbricks` before `up -d`

**Problem:** Database table doesn't exist
**Solution:** Run `prisma db push` after deploying

**Problem:** `docker compose pull` returns `unauthorized` on VM
**Solution:** VM PAT expired. Re-login with the refreshed token:
```bash
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "sudo cat /opt/formbricks/.secrets/ghcr_token | sudo docker login ghcr.io -u asla1899 --password-stdin"
```

### Runtime Issues

**Problem:** Container crashes/restarts constantly
**Solution:** Check logs for errors, verify DATABASE_URL is correct

**Problem:** "Cannot connect to database"
**Solution:** Verify postgres container is running, check credentials in .env

**Problem:** UI loads but surveys don't work
**Solution:** Check browser console for errors, verify API endpoints

## See Also

- [Azure VM Operations](../azure_vm/AZURE_VM_OPERATIONS_AND_RUNTIME.md) - Full VM documentation
- [DEPLOYMENT_SAVED_OPTION_LISTS.md](./DEPLOYMENT_SAVED_OPTION_LISTS.md) - Feature-specific deployment notes
- [VM Docker Compose](ssh://gregcohen@20.185.219.8:2222//opt/formbricks/docker-compose.yml) - Live config on VM

## Quick Reference Commands

```bash
# Full deployment: build + push locally, then pull + restart on VM
cd /Users/gcohen/dev/formbricks && ./scripts/build-and-push.sh && \
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "cd /opt/formbricks && docker compose pull formbricks && docker compose up -d formbricks"

# Quick restart (no rebuild, no pull)
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "cd /opt/formbricks && docker compose restart formbricks"

# View logs
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "docker logs formbricks -f"

# Check database tables
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \
  "cd /opt/formbricks && docker compose exec postgres psql -U formbricks -d formbricks -c '\dt'"
```

---

## Scheduled reminders (ASLA)

The survey invitation + reminder feature (see `apps/web/modules/survey/invitations/`)
ships with an endpoint for scheduled reminders at `POST /api/cron/reminders`. The
endpoint is authenticated with the same `CRON_SECRET` used by the internal pipeline.

Formbricks has no built-in scheduler, so this must be driven externally. On the
production VM, add a daily crontab entry:

```bash
# Edit VM crontab
ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 "crontab -e"

# Line to add (runs 09:00 VM time every day)
0 9 * * * /usr/bin/curl -sS -X POST -H "x-api-key: $CRON_SECRET" https://surveys.asla.org/api/cron/reminders >> /var/log/formbricks-reminders.log 2>&1
```

`$CRON_SECRET` must be exported in the user's shell environment (or inlined
directly — it's the same value as in `/opt/formbricks/.env`).

Each run is idempotent: every (invitation, offset-day) pair is stored in
`SurveyInvitation.sentOffsetDays`, so re-running or running more than once a
day will not cause duplicate emails.

---

**Last Updated:** 2026-04-23
**Maintainer:** Greg Cohen
**VM:** nan01 (20.185.219.8:2222)
