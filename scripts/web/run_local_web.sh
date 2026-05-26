#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: run_local_web.sh

Starts the local web service with uvicorn.

Environment:
  HOST                           Default: 127.0.0.1
  PORT                           Default: 8000
  WEB_WORKERS                    Default: 1
  COLLECTION_NAME                Default: reverse_wiktionary_test
  MODEL_NAME                     Default: sentence-transformers/all-MiniLM-L6-v2
  MODEL_DEVICE                   Default: auto
  QDRANT_URL                     Default: http://localhost:6333
  QDRANT_HNSW_EF                 Default: 512
  QDRANT_ACORN_MAX_SELECTIVITY   Default: 1.0
  REDIS_URL                      Default: redis://localhost:6379/0
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
WORKERS="${WEB_WORKERS:-1}"

export APP_ENV="${APP_ENV:-development}"
export COLLECTION_NAME="${COLLECTION_NAME:-reverse_wiktionary_test}"
export MODEL_NAME="${MODEL_NAME:-sentence-transformers/all-MiniLM-L6-v2}"
export MODEL_DEVICE="${MODEL_DEVICE:-auto}"
export QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
export QDRANT_HNSW_EF="${QDRANT_HNSW_EF:-512}"
export QDRANT_ACORN_MAX_SELECTIVITY="${QDRANT_ACORN_MAX_SELECTIVITY:-1.0}"
export SEARCH_EXACT_FILTERED="${SEARCH_EXACT_FILTERED:-false}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export DEFAULT_LIMIT="${DEFAULT_LIMIT:-25}"
export MAX_LIMIT="${MAX_LIMIT:-100}"
export SESSION_TTL_SECONDS="${SESSION_TTL_SECONDS:-86400}"
export SECURE_COOKIES="${SECURE_COOKIES:-false}"

exec uvicorn src.web.app:app \
  --host "$HOST" \
  --port "$PORT" \
  --workers "$WORKERS"
