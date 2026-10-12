#!/usr/bin/env bash
# deploy/deploy.sh - build the site locally and ship it to home-server as a new release.
#
#   Usage: deploy/deploy.sh
#
# Builds here rather than in CI because the Kenney asset bundle only exists on this
# machine. It builds a clean export of the committed HEAD, so uncommitted work in the
# tree never ships. Releases live in /var/www/kenney-toys/releases/<ts>-<sha>; `current` is
# swapped atomically, so Caddy (which roots at current/) never serves a half-copied
# release. No reload is needed - it's static files.
#
# Requires: this Mac on the tailnet (tailscale up) and SSH access to the deploy user.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-100.79.18.73}"   # tailnet IP of `home-server`
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_ROOT="${APP_ROOT:-/var/www/kenney-toys}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SITE_URL="${SITE_URL:-https://toys.projectz.co.nz}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log(){ printf '\033[34m==>\033[0m %s\n' "$*"; }

SHA="$(git rev-parse --short HEAD)"
REL="${APP_ROOT}/releases/$(date -u +%Y%m%d%H%M%S)-${SHA}"
SSH="ssh -o StrictHostKeyChecking=accept-new"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
log "Building $SHA in $BUILD_DIR"
git archive HEAD | tar -x -C "$BUILD_DIR"
ln -s "$ROOT/node_modules" "$BUILD_DIR/node_modules"
( cd "$BUILD_DIR" && KENNEY_ROOT="${KENNEY_ROOT:-$ROOT/../Kenney Game Assets All-in-1 3.7.0}" npm run build )

log "Shipping release → $REL"
$SSH "$REMOTE" "mkdir -p '$REL'"
# --link-dest hard-links files unchanged since the live release, so the ~MBs of
# Kenney art don't get re-copied on every deploy.
rsync -az --delete --link-dest="${APP_ROOT}/current/" -e "$SSH" "$BUILD_DIR/dist/" "$REMOTE:$REL/"

log "Activating"
$SSH "$REMOTE" bash -s -- "$APP_ROOT" "$REL" "$KEEP_RELEASES" <<'REMOTE_SCRIPT'
set -euo pipefail
APP_ROOT="$1"; REL="$2"; KEEP="$3"
# Atomic swap: build the new link beside the old one, then rename over it.
ln -sfn "$REL" "$APP_ROOT/current.tmp"
mv -T "$APP_ROOT/current.tmp" "$APP_ROOT/current"
# Prune old releases, never the live one.
cd "$APP_ROOT/releases"
ls -1t | tail -n +"$((KEEP + 1))" | while read -r old; do
  [ "$APP_ROOT/releases/$old" = "$(readlink -f "$APP_ROOT/current")" ] || rm -rf -- "$old"
done
REMOTE_SCRIPT

log "Live: $SITE_URL"
