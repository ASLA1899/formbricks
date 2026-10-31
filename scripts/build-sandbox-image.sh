#!/usr/bin/env bash
# =============================================================================
# ASLA fork: build the linux/amd64 web image for the 6.1.2 sandbox (ASL-1863).
#
# Runs on the Mac (never on nan01: the VM cannot build Next.js). Tags the image
# `<registry>/formbricks:6.1.2-asla-<short sha>` and NEVER `:latest`: production
# (`/opt/formbricks`) pulls `:latest`, so a latest tag from this branch would put 6.1.2 one
# `docker compose pull` away from production.
#
# Usage:
#   ./scripts/build-sandbox-image.sh            build and load into the local Docker (default)
#   ./scripts/build-sandbox-image.sh --push     build and push to GHCR (needs .secrets/ghcr_token)
#
# Build-time secrets are not mounted: apps/web/scripts/docker/read-secrets.sh supplies placeholders
# (the build never connects to anything), so no production value reaches this image.
# The sandbox pins the pushed image by digest in azure_vm/scripts/formbricks-staging/images.env.
# =============================================================================
set -euo pipefail

REGISTRY="ghcr.io/asla1899"
IMAGE="formbricks"
PLATFORM="linux/amd64"
MODE="load"
[[ "${1:-}" == "--push" ]] && MODE="push"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "[error] Working tree has uncommitted changes; commit first so the tag matches the source." >&2
  exit 1
fi
SHA="$(git rev-parse --short=9 HEAD)"
TAG="6.1.2-asla-${SHA}"

if [[ "$MODE" == "push" ]]; then
  TOKEN_FILE="${GHCR_TOKEN_FILE:-${REPO_ROOT}/.secrets/ghcr_token}"
  [[ -f "$TOKEN_FILE" ]] || { echo "[error] Missing $TOKEN_FILE" >&2; exit 1; }
  tr -d '[:space:]' < "$TOKEN_FILE" | docker login ghcr.io -u asla1899 --password-stdin
  OUTPUT=(--push)
else
  OUTPUT=(--load)
fi

echo "[build] $REGISTRY/$IMAGE:$TAG ($PLATFORM, $MODE)"
docker buildx build --platform "$PLATFORM" \
  --build-arg NODE_BUILD_JOBS="${NODE_BUILD_JOBS:-8}" \
  -t "$REGISTRY/$IMAGE:$TAG" \
  -f apps/web/Dockerfile \
  "${OUTPUT[@]}" \
  .

echo "[done] $REGISTRY/$IMAGE:$TAG"
