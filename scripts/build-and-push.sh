#!/usr/bin/env bash
# =============================================================================
# Formbricks — Build and push image to GHCR
#
# Builds formbricks-web for linux/amd64 and pushes to
# ghcr.io/asla1899/formbricks. Tags :latest and :sha-<short>.
#
# Runs locally on Mac because the Azure VM doesn't have enough RAM for a
# Next.js build (~10 GB peak). Replaces the old `docker save | ssh | docker
# load` flow, which moved ~3 GB over SSH each deploy.
#
# Usage:
#   ./scripts/build-and-push.sh
#
# Prerequisites:
#   - .secrets/ghcr_token           classic PAT, write:packages scope
#   - .secrets/database_url         build-time secret (mounted, not baked)
#   - .secrets/encryption_key       build-time secret
#   - .secrets/redis_url            build-time secret
#   - .secrets/sentry_auth_token    build-time secret
#   - docker buildx (bundled with Docker Desktop)
# =============================================================================
set -euo pipefail

REGISTRY="ghcr.io/asla1899"
IMAGE="formbricks"
PLATFORM="linux/amd64"
USERNAME="asla1899"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="${REPO_ROOT}/.secrets/ghcr_token"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
log()  { echo -e "${GREEN}[push]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; }

cd "$REPO_ROOT"

# --- Validate secrets ---
for f in ghcr_token database_url encryption_key redis_url sentry_auth_token; do
  if [[ ! -f ".secrets/$f" ]]; then
    err "Missing secret: .secrets/$f"
    exit 1
  fi
done

# --- Git metadata ---
SHA="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  warn "Building from branch '$BRANCH' (not main). Tagging as sha-$SHA only."
fi

# --- Login ---
log "Logging into $REGISTRY..."
tr -d '[:space:]' < "$TOKEN_FILE" | docker login ghcr.io -u "$USERNAME" --password-stdin

# --- Build + push ---
log "Building $IMAGE (sha-$SHA) for $PLATFORM..."
docker buildx build --platform "$PLATFORM" \
  --secret id=database_url,src=.secrets/database_url \
  --secret id=encryption_key,src=.secrets/encryption_key \
  --secret id=redis_url,src=.secrets/redis_url \
  --secret id=sentry_auth_token,src=.secrets/sentry_auth_token \
  -t "$REGISTRY/$IMAGE:latest" \
  -t "$REGISTRY/$IMAGE:sha-$SHA" \
  -f apps/web/Dockerfile \
  --push \
  .

log ""
log "Done. Pushed $REGISTRY/$IMAGE with tags :latest and :sha-$SHA"
log ""
log "To deploy on the VM:"
log "  ssh -i ~/.ssh/id_ed25519_workgh -p 2222 gregcohen@20.185.219.8 \\"
log "    'cd /opt/formbricks && docker compose pull formbricks && docker compose up -d formbricks'"
