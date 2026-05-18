#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
WORKERS="${WEB_WORKERS:-1}"

export APP_ENV="${APP_ENV:-development}"
export COLLECTION_NAME="${COLLECTION_NAME:-reverse_wiktionary_v2}"
export MODEL_NAME="${MODEL_NAME:-sentence-transformers/distiluse-base-multilingual-cased-v2}"
export MODEL_DEVICE="${MODEL_DEVICE:-auto}"
export QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
export QDRANT_HNSW_EF="${QDRANT_HNSW_EF:-64}"
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
