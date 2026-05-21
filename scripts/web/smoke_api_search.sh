#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: smoke_api_search.sh

Posts one search request to the API.

Environment:
  WEB_URL  Default: http://127.0.0.1:8000
  QUERY    Default: a book listing words and their meanings
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

WEB_URL="${WEB_URL:-http://127.0.0.1:8000}"
QUERY="${QUERY:-a book listing words and their meanings}"

curl -fsS \
  -X POST "$WEB_URL/api/v1/search" \
  -H "Content-Type: application/json" \
  --data "$(jq -n --arg query "$QUERY" '{
    query: $query,
    langs: [],
    pos: [],
    limit: 5,
    offset: 0
  }')" \
  | jq .
