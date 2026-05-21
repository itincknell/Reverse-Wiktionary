#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: logs.sh [service]

Follows Docker Compose logs.

Environment:
  COMPOSE_FILE  Default: deploy/web/compose.prod.yml
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

COMPOSE_FILE="${COMPOSE_FILE:-deploy/web/compose.prod.yml}"
SERVICE="${1:-web}"

docker compose -f "$COMPOSE_FILE" logs -f "$SERVICE"
