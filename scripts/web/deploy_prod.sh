#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/web/compose.prod.yml}"
ENV_FILE="${ENV_FILE:-deploy/web/.env}"
WEB_URL="${WEB_URL:-http://127.0.0.1:8080}"
WEB_SKIP_BUILD="${WEB_SKIP_BUILD:-false}"
COMPOSE_ARGS=(-f "$COMPOSE_FILE")

if [ -f "$ENV_FILE" ]; then
  COMPOSE_ARGS=(--env-file "$ENV_FILE" "${COMPOSE_ARGS[@]}")
  env_skip_build="$(sed -n 's/^WEB_SKIP_BUILD=//p' "$ENV_FILE" | tail -n 1)"
  if [ -n "$env_skip_build" ] && [ "$WEB_SKIP_BUILD" = "false" ]; then
    WEB_SKIP_BUILD="$env_skip_build"
  fi
fi

./scripts/web/prepare_prod_dirs.sh

if [ "$WEB_SKIP_BUILD" = "true" ]; then
  docker compose "${COMPOSE_ARGS[@]}" up -d --no-build
else
  docker compose "${COMPOSE_ARGS[@]}" up -d --build
fi

echo "waiting for web health..."
for _ in $(seq 1 60); do
  if curl -fsS "$WEB_URL/health" >/dev/null; then
    curl -fsS "$WEB_URL/health" | jq .
    exit 0
  fi

  sleep 2
done

echo "web health check failed: $WEB_URL/health"
docker compose "${COMPOSE_ARGS[@]}" ps
docker compose "${COMPOSE_ARGS[@]}" logs --tail 100 web
exit 1
