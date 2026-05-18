#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-deploy/web/.env}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  echo "CLOUDFLARE_TUNNEL_TOKEN is required in the environment or $ENV_FILE" >&2
  exit 1
fi

export COMPOSE_PROFILES="${COMPOSE_PROFILES:-cloudflare}"
export WEB_URL="${WEB_URL:-http://127.0.0.1:8080}"

./scripts/web/deploy_prod.sh
