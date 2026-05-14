#!/usr/bin/env bash
set -euo pipefail

# Azure Run Command payload for web/API smoke testing.

storageAccount="${storageAccount:-}"
container="${container:-}"
codeArchiveBlob="${codeArchiveBlob:-}"
repoDir="${repoDir:-/opt/reverse-wiktionary-web-smoke}"
collectionName="${collectionName:-reverse_wiktionary_v1}"
modelName="${modelName:-sentence-transformers/all-mpnet-base-v2}"
runId="${runId:-$(date -u +%Y%m%dT%H%M%SZ)}"

for parameter in "$@"; do
  case "$parameter" in
    storageAccount=*) storageAccount="${parameter#storageAccount=}" ;;
    container=*) container="${parameter#container=}" ;;
    codeArchiveBlob=*) codeArchiveBlob="${parameter#codeArchiveBlob=}" ;;
    repoDir=*) repoDir="${parameter#repoDir=}" ;;
    collectionName=*) collectionName="${parameter#collectionName=}" ;;
    modelName=*) modelName="${parameter#modelName=}" ;;
    runId=*) runId="${parameter#runId=}" ;;
  esac
done

if [ -z "$storageAccount" ] || [ -z "$container" ] || [ -z "$codeArchiveBlob" ]; then
  echo "Missing required storageAccount/container/codeArchiveBlob parameters"
  exit 1
fi

archivePath="/tmp/reverse-wiktionary-web-smoke-$runId.tar.gz"
webLog="/tmp/reverse-wiktionary-web-smoke-$runId.log"

echo "=== Azure Identity ==="
az login --identity --output none

echo "=== Download Code Archive ==="
az storage blob download \
  --account-name "$storageAccount" \
  --container-name "$container" \
  --name "$codeArchiveBlob" \
  --file "$archivePath" \
  --auth-mode login \
  --overwrite

echo "=== Extract Repo ==="
rm -rf "$repoDir"
mkdir -p "$repoDir"
tar -xzf "$archivePath" -C "$repoDir"
cd "$repoDir"

echo "=== Python Environment ==="
python -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

echo "=== Start Redis ==="
docker rm -f reverse-wiktionary-redis-smoke >/dev/null 2>&1 || true
docker run -d \
  --name reverse-wiktionary-redis-smoke \
  -p 6379:6379 \
  redis:7 \
  redis-server --appendonly yes >/dev/null

echo "=== Ensure Qdrant ==="
if ! curl -fsS http://localhost:6333/healthz >/dev/null 2>&1; then
  qdrantStorage="/opt/reverse-wiktionary/data/qdrant/storage"

  if [ ! -d "$qdrantStorage" ]; then
    echo "Qdrant is not running and storage was not found: $qdrantStorage"
    exit 1
  fi

  docker rm -f reverse-wiktionary-qdrant-smoke >/dev/null 2>&1 || true
  docker run -d \
    --name reverse-wiktionary-qdrant-smoke \
    -p 6333:6333 \
    -p 6334:6334 \
    -v "$qdrantStorage:/qdrant/storage" \
    qdrant/qdrant:latest >/dev/null
fi

for _ in $(seq 1 90); do
  if curl -fsS http://localhost:6333/healthz >/dev/null 2>&1; then
    break
  fi

  sleep 2
done

curl -fsS "http://localhost:6333/collections/$collectionName" \
  | jq '{status: .result.status, points: .result.points_count, indexed: .result.indexed_vectors_count, queue: .result.update_queue.length}'

echo "=== Start Web App ==="
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

echo "=== Wait For Health ==="
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

echo "=== API Search Smoke ==="
curl -fsS \
  -X POST http://127.0.0.1:8000/api/v1/search \
  -H "Content-Type: application/json" \
  --data '{"query":"a book listing words and their meanings","langs":["English"],"pos":["noun"],"limit":5,"offset":0}' \
  | tee /tmp/reverse-wiktionary-web-search.json \
  | jq '{query, limit, offset, has_more, result_count: (.results | length), first_result: .results[0]}'

echo "=== Web Log Tail ==="
tail -n 80 "$webLog" || true

