#!/usr/bin/env bash
# deploy/deploy-party.sh - ship the party relay (party/server.ts) to home-server and restart it.
#
#   Usage: deploy/deploy-party.sh
#
# The static games go out with deploy.sh; this is only the small Node service that TV + phone
# games talk through, so it's needed only when party/ changes. Like deploy.sh it ships the
# committed HEAD. The server's Node (Ubuntu's build) can't strip TypeScript itself, so this Mac's
# Node strips the types to give server.js; a release is that, a package.json and the one
# dependency, ws. The first run also creates the service
# user and installs the systemd unit. It needs root over SSH, since the deploy user can't manage
# services.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-100.79.18.73}"   # tailnet IP of `home-server`
APP_ROOT=/srv/kenney-party
KEEP_RELEASES="${KEEP_RELEASES:-3}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
log(){ printf '\033[34m==>\033[0m %s\n' "$*"; }

SHA="$(git rev-parse --short HEAD)"
REL="${APP_ROOT}/releases/$(date -u +%Y%m%d%H%M%S)-${SHA}"
SSH="ssh -o StrictHostKeyChecking=accept-new root@${DEPLOY_HOST}"
WS_VERSION="$(node -p "require('./node_modules/ws/package.json').version")"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
git show "HEAD:party/server.ts" | node -e "
  const src = require('node:fs').readFileSync(0, 'utf8');
  process.stdout.write(require('node:module').stripTypeScriptTypes(src));
" > "$STAGE/server.js"
printf '{ "name": "kenney-party", "private": true, "type": "module" }\n' > "$STAGE/package.json"
mkdir -p "$STAGE/node_modules"
cp -R node_modules/ws "$STAGE/node_modules/ws"
log "Release $SHA (ws $WS_VERSION) → $REL"

$SSH "id kenneyparty >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin kenneyparty; mkdir -p '$REL'"
rsync -a --delete -e "ssh -o StrictHostKeyChecking=accept-new" "$STAGE/" "root@${DEPLOY_HOST}:$REL/"
rsync -a -e "ssh -o StrictHostKeyChecking=accept-new" deploy/kenney-party.service "root@${DEPLOY_HOST}:/etc/systemd/system/kenney-party.service"

$SSH bash -s <<EOF
set -euo pipefail
chown -R root:root '$REL'
chmod -R a+rX '$REL'
ln -sfn '$REL' '$APP_ROOT/current.tmp' && mv -Tf '$APP_ROOT/current.tmp' '$APP_ROOT/current'
systemctl daemon-reload
systemctl enable --quiet kenney-party
systemctl restart kenney-party
sleep 1
systemctl is-active --quiet kenney-party || { journalctl -u kenney-party -n 30 --no-pager; exit 1; }
ls -1dt '$APP_ROOT'/releases/* | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf
curl -fsS http://127.0.0.1:8083/party/health
EOF
log "Relay is up"
