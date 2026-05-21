#!/usr/bin/env bash

set -euo pipefail

COMPOSE_FILE="deploy/compose/qdrant.yml"

usage() {
  cat <<'EOF'
Usage: stop_qdrant.sh

Stops the local Qdrant Docker Compose service.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

docker compose -f "$COMPOSE_FILE" down
