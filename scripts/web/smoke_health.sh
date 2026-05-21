#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: smoke_health.sh

Checks the web health endpoint.

Environment:
  WEB_URL  Default: http://127.0.0.1:8000
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

WEB_URL="${WEB_URL:-http://127.0.0.1:8000}"

curl -fsS "$WEB_URL/health" | jq .
