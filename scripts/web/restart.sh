#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: restart.sh [service]

Restarts one Docker Compose service.

Environment:
  COMPOSE_FILE     Default: deploy/web/compose.prod.yml
  ENV_FILE         Default: deploy/web/.env
  WEB_SKIP_BUILD   Default: false
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

COMPOSE_FILE="${COMPOSE_FILE:-deploy/web/compose.prod.yml}"
ENV_FILE="${ENV_FILE:-deploy/web/.env}"
SERVICE="${1:-web}"
WEB_SKIP_BUILD="${WEB_SKIP_BUILD:-false}"

COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if [ -f "$ENV_FILE" ]; then
  COMPOSE_ARGS=(--env-file "$ENV_FILE" "${COMPOSE_ARGS[@]}")
  env_skip_build="$(sed -n 's/^WEB_SKIP_BUILD=//p' "$ENV_FILE" | tail -n 1)"
  if [ -n "$env_skip_build" ] && [ "$WEB_SKIP_BUILD" = "false" ]; then
    WEB_SKIP_BUILD="$env_skip_build"
  fi
fi

if [ "$WEB_SKIP_BUILD" = "true" ]; then
  docker compose "${COMPOSE_ARGS[@]}" up -d --no-build "$SERVICE"
else
  docker compose "${COMPOSE_ARGS[@]}" up -d --build "$SERVICE"
fi
