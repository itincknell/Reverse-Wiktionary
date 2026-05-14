#!/usr/bin/env bash
set -euo pipefail

# Rerun the web/API smoke test from an already extracted VM repo.

repoDir="${repoDir:-/opt/reverse-wiktionary-web-smoke}"
collectionName="${collectionName:-reverse_wiktionary_v1}"
modelName="${modelName:-sentence-transformers/all-mpnet-base-v2}"
runId="${runId:-$(date -u +%Y%m%dT%H%M%SZ)}"

for parameter in "$@"; do
  case "$parameter" in
    repoDir=*) repoDir="${parameter#repoDir=}" ;;
    collectionName=*) collectionName="${parameter#collectionName=}" ;;
    modelName=*) modelName="${parameter#modelName=}" ;;
    runId=*) runId="${parameter#runId=}" ;;
  esac
done

webLog="/tmp/reverse-wiktionary-web-smoke-existing-$runId.log"

cd "$repoDir"

if [ ! -x ".venv/bin/uvicorn" ]; then
  python -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
fi

if ! docker ps --format '{{.Names}}' | grep -qx reverse-wiktionary-redis-smoke; then
  docker rm -f reverse-wiktionary-redis-smoke >/dev/null 2>&1 || true
  docker run -d \
    --name reverse-wiktionary-redis-smoke \
    -p 6379:6379 \
    redis:7 \
    redis-server --appendonly yes >/dev/null
fi

curl -fsS "http://localhost:6333/collections/$collectionName" \
  | jq '{status: .result.status, points: .result.points_count, indexed: .result.indexed_vectors_count, payload_schema: .result.payload_schema}'

pkill -f "uvicorn src.web.app:app" >/dev/null 2>&1 || true

APP_ENV=development \
COLLECTION_NAME="$collectionName" \
MODEL_NAME="$modelName" \
MODEL_DEVICE=auto \
QDRANT_URL=http://localhost:6333 \
REDIS_URL=redis://localhost:6379/0 \
DEFAULT_LIMIT=5 \
MAX_LIMIT=25 \
SECURE_COOKIES=false \
nohup .venv/bin/uvicorn src.web.app:app --host 127.0.0.1 --port 8000 --workers 1 \
  > "$webLog" 2>&1 &

echo "web log: $webLog"

rm -f /tmp/reverse-wiktionary-web-health.json /tmp/reverse-wiktionary-web-search.json

for _ in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:8000/health >/tmp/reverse-wiktionary-web-health.json 2>/dev/null; then
    jq . /tmp/reverse-wiktionary-web-health.json
    break
  fi

  sleep 2
done

if [ ! -s /tmp/reverse-wiktionary-web-health.json ]; then
  echo "Web health check failed"
  tail -n 120 "$webLog" || true
  exit 1
fi

curl -fsS \
  -X POST http://127.0.0.1:8000/api/v1/search \
  -H "Content-Type: application/json" \
  --data '{"query":"a book listing words and their meanings","langs":["English"],"pos":["noun"],"limit":5,"offset":0}' \
  | tee /tmp/reverse-wiktionary-web-search.json \
  | jq '{query, limit, offset, has_more, result_count: (.results | length), first_result: .results[0]}'

tail -n 80 "$webLog" || true

