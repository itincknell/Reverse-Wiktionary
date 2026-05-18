#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/web/compose.prod.yml}"
ENV_FILE="${ENV_FILE:-deploy/web/.env}"
WEB_URL="${WEB_URL:-http://127.0.0.1:8080}"
COMPOSE_ARGS=(-f "$COMPOSE_FILE")

if [ -f "$ENV_FILE" ]; then
  COMPOSE_ARGS=(--env-file "$ENV_FILE" "${COMPOSE_ARGS[@]}")
fi

./scripts/web/prepare_prod_dirs.sh

docker compose "${COMPOSE_ARGS[@]}" up -d --build

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
