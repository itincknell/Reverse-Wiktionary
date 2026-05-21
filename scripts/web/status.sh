#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: status.sh

Shows Docker Compose service status.

Environment:
  COMPOSE_FILE  Default: deploy/web/compose.prod.yml
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

COMPOSE_FILE="${COMPOSE_FILE:-deploy/web/compose.prod.yml}"

docker compose -f "$COMPOSE_FILE" ps
