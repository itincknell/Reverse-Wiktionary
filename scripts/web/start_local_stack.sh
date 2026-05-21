#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: start_local_stack.sh

Starts the local Docker Compose stack.

Environment:
  COMPOSE_FILE  Default: deploy/web/compose.local.yml
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

COMPOSE_FILE="${COMPOSE_FILE:-deploy/web/compose.local.yml}"

docker compose -f "$COMPOSE_FILE" up -d --build
