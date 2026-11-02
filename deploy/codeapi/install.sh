#!/usr/bin/env bash
# Adds code execution (creating Word, Excel and PowerPoint files) to the LibreChat that already
# runs on this server, or updates it to CODEAPI_IMAGE_TAG.
#
#   sudo bash install.sh
#
# LibreChat itself is not replaced. On the first run only, a block of settings is appended to its
# .env and LibreChat restarts once, after a database backup. Safe to run again.
set -euo pipefail

# The code-interpreter commit to deploy: the full SHA of a successful "Publish Images" run.
CODEAPI_IMAGE_TAG=9b1a80a4a210070ec1d88236a49fe6fba58eabf6

cd "$(dirname "$(readlink -f "$0")")"
DIR=$(pwd)
MARK_BEGIN='# >>> code execution, added by codeapi/install.sh'
MARK_END='# <<< code execution'

fail() { echo "ERROR: $*" >&2; exit 1; }
# Retries a command for up to three minutes.
wait_for() { for _ in $(seq 1 90); do "$@" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

[ "$(id -u)" = 0 ] || fail "run as root: sudo bash install.sh"
[[ $CODEAPI_IMAGE_TAG =~ ^[0-9a-f]{40}$ ]] || fail "CODEAPI_IMAGE_TAG at the top of install.sh is not a full commit SHA"
[ "$(uname -m)" = x86_64 ] || fail "the images are built for x86_64 (amd64) only"
[ -e /dev/kvm ] || fail "/dev/kvm is missing. Code execution needs KVM. On your own machine, turn on \
virtualization (Intel VT-x, or AMD-V/SVM) in the BIOS; on a VPS, ask the provider for nested virtualization."
docker compose version >/dev/null 2>&1 || fail "the Docker Compose plugin is missing"

# ---------------------------------------------------------- the running LibreChat
docker inspect LibreChat >/dev/null 2>&1 || fail "there is no container named LibreChat. Check with: docker ps"

# Join the network of LibreChat's own Compose project, so LibreChat can reach http://codeapi:3112.
LC_PROJECT=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' LibreChat)
LC_NETWORKS=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' LibreChat)
if grep -qx "${LC_PROJECT}_default" <<<"$LC_NETWORKS"; then
  LC_NETWORK=${LC_PROJECT}_default
else
  LC_NETWORK=$(head -n1 <<<"$LC_NETWORKS")
fi
[ -n "$LC_NETWORK" ] || fail "LibreChat is not on a Docker network"
case $LC_NETWORK in
  bridge | host | none) fail "LibreChat runs on Docker's '$LC_NETWORK' network, which code execution cannot \
join. Start LibreChat with docker compose, then run this again." ;;
esac

LC_ENV=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/.env"}}{{.Source}}{{end}}{{end}}' LibreChat)
[ -n "$LC_ENV" ] && [ -f "$LC_ENV" ] \
  || fail "LibreChat does not read a mounted .env file. Send the output of: docker inspect LibreChat"
LC_PORT=$(sed -n 's/^PORT=//p' "$LC_ENV" | tail -n1 | tr -d "\"' \r")
LC_PORT=${LC_PORT:-3080}

docker exec LibreChat sh -c 'grep -rqs CODEAPI_JWT_PRIVATE_JWK_JSON /app/packages/api/dist /app/packages/api/src' \
  || fail "the LibreChat image on this server is too old for code execution. \
Deploy a recent librechat-arabic-admin tag first (workflow.md, section 3.5)."

LINKED=false
grep -qxF "$MARK_BEGIN" "$LC_ENV" && LINKED=true
# Code-execution lines from an older setup; they are commented out when LibreChat is connected.
OLD_RE='^[[:space:]]*(LIBRECHAT_CODE_BASEURL|CODEAPI_[A-Z_]+)='

OTHER=$(docker ps -a --filter label=com.docker.compose.service=sandbox-runner \
  --format '{{.Label "com.docker.compose.project"}} {{.Label "com.docker.compose.project.working_dir"}}' \
  | grep -v '^codeapi ' | sort -u | head -n1 || true)
if [ -n "$OTHER" ]; then
  read -r OTHER_PROJECT OTHER_DIR <<<"$OTHER"
  [ "$OTHER_PROJECT" != "$LC_PROJECT" ] || fail "LibreChat's own Compose files in $OTHER_DIR also run a \
code-interpreter. Nothing was changed. Remove those services from them, then run this again."
  fail "an older code-interpreter runs on this machine. Nothing was changed.
Stop it (its data is kept), then run this again:
  cd $OTHER_DIR && sudo docker compose down"
fi

if [ -f .env ] && [ ! -f librechat.env ]; then
  fail "$DIR/librechat.env is missing. Restore it from your copy, or move .env away to start over."
fi
if [ ! -f .env ] && $LINKED; then
  fail "$LC_ENV has the code-execution block but $DIR/.env is missing. Restore it from your copy, \
or delete the block between the '# >>>' and '# <<<' lines in $LC_ENV and run this again."
fi

# --------------------------------------------------------------------- registry
# The code-interpreter repository is private, so pulling its images needs a GitHub token.
CODEAPI_PROBE=ghcr.io/waeldrwish/codeapi-api:$CODEAPI_IMAGE_TAG
if ! docker manifest inspect "$CODEAPI_PROBE" >/dev/null 2>&1; then
  [ -t 0 ] || fail "cannot read $CODEAPI_PROBE; run: docker login ghcr.io -u waeldrwish"
  echo "The code-interpreter images are private."
  echo "Paste a GitHub token (classic) that has only the read:packages scope."
  GHCR_TOKEN=""
  read -rsp "GitHub token: " GHCR_TOKEN || true
  echo
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u waeldrwish --password-stdin >/dev/null \
    || fail "GitHub rejected the token"
  unset GHCR_TOKEN
  docker manifest inspect "$CODEAPI_PROBE" >/dev/null 2>&1 \
    || fail "$CODEAPI_PROBE not found. Check that the Publish Images run for that commit succeeded."
fi

# ------------------------------------------------------------------------- keys
if [ ! -f .env ]; then
  echo "==> Generating keys"
  # Two Ed25519 key pairs: LibreChat signs user tokens for the code service with the first;
  # the worker signs each execution with the second and the sandbox verifies it.
  KEYGEN_JS=$(cat <<'JS'
const { generateKeyPairSync } = require('crypto');
const kid = 'lc-codeapi-prod-' + new Date().toISOString().slice(0, 7).replace('-', '');
const jwt = generateKeyPairSync('ed25519');
const privateJwk = { ...jwt.privateKey.export({ format: 'jwk' }), kid, alg: 'EdDSA' };
const publicJwk = { ...jwt.publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA' };
const manifest = generateKeyPairSync('ed25519');
console.log(`CODEAPI_JWT_KID=${kid}`);
console.log(`CODEAPI_JWT_PRIVATE_JWK_JSON='${JSON.stringify(privateJwk)}'`);
console.log(`CODEAPI_JWT_JWKS_JSON='${JSON.stringify({ keys: [publicJwk] })}'`);
console.log(`CODEAPI_EXECUTION_MANIFEST_PRIVATE_KEY=${manifest.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')}`);
console.log(`SANDBOX_EXECUTION_MANIFEST_PUBLIC_KEY=${manifest.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`);
JS
)
  KEYS=$(docker exec LibreChat node -e "$KEYGEN_JS")
  [ "$(printf '%s\n' "$KEYS" | grep -c '=')" = 5 ] || fail "key generation failed"
  key() { printf '%s\n' "$KEYS" | grep "^$1="; }

  # Each sandboxed execution takes up to 2 GB and 2 CPUs; leave about 6 GB for everything else.
  # At most 2 at a time, because this machine also runs other projects; more requests wait in line.
  # On a dedicated server raise CODEAPI_MAX_JOBS in .env, then run: docker compose up -d
  MEM_GB=$(awk '/MemTotal/ {printf "%d", $2 / 1024 / 1024}' /proc/meminfo)
  MAX_JOBS=$(( (MEM_GB - 6) / 2 ))
  if [ "$MAX_JOBS" -lt 1 ]; then MAX_JOBS=1; fi
  if [ "$MAX_JOBS" -gt 2 ]; then MAX_JOBS=2; fi

  hex() { openssl rand -hex "$1"; }
  umask 077
  cat > librechat.env <<EOF
$MARK_BEGIN
LIBRECHAT_CODE_BASEURL=http://codeapi:3112/v1
CODEAPI_AUTH_PROVIDER=librechat-jwt
CODEAPI_JWT_ALGORITHM=EdDSA
CODEAPI_JWT_ISSUER=librechat
CODEAPI_JWT_AUDIENCE=codeapi
CODEAPI_JWT_TTL_SECONDS=300
CODEAPI_JWT_MINT_CACHE_SECONDS=30
CODEAPI_JWT_SINGLE_TENANT_ID=legacy
$(key CODEAPI_JWT_KID)
$(key CODEAPI_JWT_PRIVATE_JWK_JSON)
$MARK_END
EOF
  cat > .env <<EOF
# Written by install.sh on $(date -u +%Y-%m-%d). Keep a copy of this file and of librechat.env
# off the server: each holds one half of the same key pair.
CODEAPI_IMAGE_TAG=$CODEAPI_IMAGE_TAG
LIBRECHAT_NETWORK=$LC_NETWORK
$(key CODEAPI_JWT_JWKS_JSON)
$(key CODEAPI_EXECUTION_MANIFEST_PRIVATE_KEY)
$(key SANDBOX_EXECUTION_MANIFEST_PUBLIC_KEY)
CODEAPI_INTERNAL_SERVICE_TOKEN=$(hex 32)
CODEAPI_EGRESS_GRANT_SECRET=$(hex 32)
CODEAPI_REDIS_PASSWORD=$(hex 24)
CODEAPI_MINIO_PASSWORD=$(hex 24)
CODEAPI_MAX_JOBS=$MAX_JOBS
EOF
  umask 022
fi
chmod 600 .env librechat.env
sed -i -e "s/^CODEAPI_IMAGE_TAG=.*/CODEAPI_IMAGE_TAG=$CODEAPI_IMAGE_TAG/" \
  -e "s/^LIBRECHAT_NETWORK=.*/LIBRECHAT_NETWORK=$LC_NETWORK/" .env

# ------------------------------------------------------------------------ start
echo "==> Pulling images"
# The images are large; a retry keeps the layers that already arrived.
for try in 1 2 3; do
  docker compose pull && break
  [ "$try" = 3 ] && fail "pulling failed. If the message says 'unauthorized' or 'denied', log in again \
with a token that has the read:packages scope: docker login ghcr.io -u waeldrwish. \
Otherwise check the internet connection and run this again."
  echo "==> Pulling failed, retrying in 10 seconds"
  sleep 10
done

echo "==> Starting code execution"
# --force-recreate re-attaches the containers when a `docker compose down` in LibreChat's folder
# has recreated its network.
UP_LOG=$(mktemp)
trap 'rm -f "$UP_LOG"' EXIT
if ! docker compose up -d --force-recreate 2>&1 | tee "$UP_LOG"; then
  grep -q 'non-overlapping' "$UP_LOG" && fail "Docker has no free address range for a new network \
(this machine has $(docker network ls -q | wc -l) Docker networks). Remove the networks that no running \
container uses with 'docker network prune', then run this again."
  fail "code execution did not start. Read: docker compose logs --tail 100 sandbox-runner egress_gateway"
fi
wait_for docker exec LibreChat wget -qO- http://codeapi:3112/v1/health \
  || fail "LibreChat cannot reach the code service. Read: docker compose logs --tail 100 codeapi"

# ------------------------------------------------------------- connect LibreChat
if ! $LINKED; then
  docker inspect chat-mongodb >/dev/null 2>&1 \
    || fail "no chat-mongodb container to back up. Nothing was changed in LibreChat."
  echo "==> Backing up LibreChat's database"
  B=$DIR/backups/$(date +%Y%m%d-%H%M%S)
  mkdir -p "$B"
  chmod 700 "$DIR/backups"
  docker exec chat-mongodb mongodump --db LibreChat --archive --gzip > "$B/mongo.archive.gz"
  [ -s "$B/mongo.archive.gz" ] || fail "the database backup is empty. Nothing was changed in LibreChat."
  cp -p "$LC_ENV" "$B/librechat-dot-env.before"

  echo "==> Connecting LibreChat and restarting it"
  # Write in place, never replace the file: it is bind-mounted into the container.
  if grep -qE "$OLD_RE" "$LC_ENV"; then
    echo "    commenting out the old code-execution lines:"
    grep -nE "$OLD_RE" "$LC_ENV" | cut -d= -f1 | sed 's/^/      line /'
    sed -E "s/($OLD_RE)/# replaced by codeapi\/install.sh: \1/" "$B/librechat-dot-env.before" > "$LC_ENV"
  fi
  [ -z "$(tail -c1 "$LC_ENV")" ] || echo >> "$LC_ENV"
  cat librechat.env >> "$LC_ENV"
  docker restart LibreChat >/dev/null
  if ! wait_for docker exec LibreChat wget -qO- "http://127.0.0.1:$LC_PORT/health"; then
    cat "$B/librechat-dot-env.before" > "$LC_ENV"
    docker restart LibreChat >/dev/null
    fail "LibreChat did not come back, so its .env was restored and it was restarted again. \
Read: docker logs --tail 100 LibreChat"
  fi
fi

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
cat <<EOF

Done. Code execution is connected to LibreChat.
In each agent that should create files, turn on "Run Code" (Code Interpreter).

Keep a copy of $DIR/.env and $DIR/librechat.env off this server.
To update later: change CODEAPI_IMAGE_TAG at the top of install.sh and run it again.
EOF
