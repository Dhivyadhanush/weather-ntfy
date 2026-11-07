#!/usr/bin/env bash
# Update Weather → ntfy from GitHub, rebuild only its compose service, verify
# health, and roll back on failure. Other Docker stacks are never touched.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVICE="${SERVICE:-weather-ntfy}"
PROJECT="${COMPOSE_PROJECT_NAME:-weather-ntfy}"
HEALTH_URL="${HEALTH_URL:-http://172.17.0.1:3102/api/health}"
BRANCH="${BRANCH:-main}"
FORCE=0
CHECK_ONLY=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--check] [--force]

  --check  Only report whether origin/$BRANCH has a new commit.
  --force  Rebuild/restart even when the checkout is already up to date.

Environment:
  APP_DIR              Repository root (default: parent of this script)
  SERVICE              Compose service to update (default: weather-ntfy)
  COMPOSE_PROJECT_NAME Compose project (default: weather-ntfy)
  HEALTH_URL           Health endpoint (default: http://172.17.0.1:3102/api/health)
  BRANCH               Git branch (default: main)
EOF
}

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --force) FORCE=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() {
  log "ERROR: $*"
  exit 1
}

cd "$APP_DIR"
[ -d .git ] || die "$APP_DIR is not a git checkout"
[ -f compose.yaml ] || die "compose.yaml missing in $APP_DIR"

mkdir -p data
exec 9>"data/.update.lock"
flock -n 9 || {
  log "another update is already running"
  exit 0
}

command -v git >/dev/null || die "git not found"
command -v docker >/dev/null || die "docker not found"
command -v curl >/dev/null || die "curl not found"
docker compose version >/dev/null 2>&1 || die "docker compose not available"

# Pin the project so this script can only ever act on this stack.
export COMPOSE_PROJECT_NAME="$PROJECT"

git fetch --quiet origin "$BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$CHECK_ONLY" -eq 1 ]; then
  if [ "$LOCAL" = "$REMOTE" ]; then
    log "up to date at ${LOCAL:0:7}"
  else
    log "update available: ${LOCAL:0:7} -> ${REMOTE:0:7}"
  fi
  exit 0
fi

if [ "$LOCAL" = "$REMOTE" ] && [ "$FORCE" -eq 0 ]; then
  log "up to date at ${LOCAL:0:7}; nothing to do"
  exit 0
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  die "tracked files have local changes; refusing to update"
fi

OLD="$LOCAL"
log "updating ${OLD:0:7} -> ${REMOTE:0:7} (project=$PROJECT service=$SERVICE)"
git pull --ff-only --quiet origin "$BRANCH"
NEW="$(git rev-parse HEAD)"

# --no-deps + explicit service + pinned project: only this service is rebuilt.
build_up() {
  docker compose up -d --build --no-deps --force-recreate "$SERVICE"
}

wait_healthy() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if ! build_up; then
  log "build/start failed; rolling back to ${OLD:0:7}"
  git reset --hard --quiet "$OLD"
  build_up || true
  die "update failed; rollback attempted"
fi

if ! wait_healthy; then
  log "health check failed at $HEALTH_URL; rolling back to ${OLD:0:7}"
  git reset --hard --quiet "$OLD"
  if build_up; then
    wait_healthy || log "warning: rollback health check is still failing"
  fi
  die "update failed health check; rolled back"
fi

log "success: ${OLD:0:7} -> ${NEW:0:7}; $SERVICE is healthy"
log "other containers were not touched (project=$PROJECT, service=$SERVICE, --no-deps)"
