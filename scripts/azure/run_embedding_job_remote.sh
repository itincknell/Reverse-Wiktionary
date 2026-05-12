#!/usr/bin/env bash
set -euo pipefail

# Remote Azure VM job invoked by scripts/run_embeddings_on_azure_vm.sh.
#
# The VM is expected to have Azure CLI, Docker, jq, and the project repo
# archive supplied by the launcher. Keeping the remote job explicit makes the
# VM contract visible and avoids hiding infrastructure assumptions inside
# Python code.

storageAccount="${storageAccount:-}"
container="${container:-}"
processedRunId="${processedRunId:-latest}"
collectionName="${collectionName:-reverse_wiktionary_v1}"
modelName="${modelName:-sentence-transformers/all-mpnet-base-v2}"
repoDir="${repoDir:-/opt/reverse-wiktionary}"
codeArchiveBlob="${codeArchiveBlob:-}"
cloudRunId="${cloudRunId:-$(date -u +%Y%m%dT%H%M%SZ)}"
prepareProcessedIfMissing="${prepareProcessedIfMissing:-false}"
allowRawDownload="${allowRawDownload:-false}"
startedAtUtc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
embeddingRunId=""
logFile="/tmp/reverse-wiktionary-$cloudRunId.log"
statusFile="/tmp/reverse-wiktionary-$cloudRunId-status.json"
qdrantStarted=false

for parameter in "$@"; do
  case "$parameter" in
    storageAccount=*)
      storageAccount="${parameter#storageAccount=}"
      ;;
    container=*)
      container="${parameter#container=}"
      ;;
    processedRunId=*)
      processedRunId="${parameter#processedRunId=}"
      ;;
    collectionName=*)
      collectionName="${parameter#collectionName=}"
      ;;
    modelName=*)
      modelName="${parameter#modelName=}"
      ;;
    repoDir=*)
      repoDir="${parameter#repoDir=}"
      ;;
    codeArchiveBlob=*)
      codeArchiveBlob="${parameter#codeArchiveBlob=}"
      ;;
    cloudRunId=*)
      cloudRunId="${parameter#cloudRunId=}"
      logFile="/tmp/reverse-wiktionary-$cloudRunId.log"
      statusFile="/tmp/reverse-wiktionary-$cloudRunId-status.json"
      ;;
    prepareProcessedIfMissing=*)
      prepareProcessedIfMissing="${parameter#prepareProcessedIfMissing=}"
      ;;
    allowRawDownload=*)
      allowRawDownload="${parameter#allowRawDownload=}"
      ;;
  esac
done

if [ -z "$storageAccount" ] || [ -z "$container" ]; then
  echo "Missing required storageAccount/container parameters"
  exit 1
fi

upload_run_artifacts() {
  local exit_code="$1"
  local status="succeeded"
  local finished_at_utc

  if [ "$exit_code" -ne 0 ]; then
    status="failed"
  fi

  finished_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  cat > "$statusFile" <<EOF
{
  "cloud_run_id": "$cloudRunId",
  "embedding_run_id": "$embeddingRunId",
  "started_at_utc": "$startedAtUtc",
  "finished_at_utc": "$finished_at_utc",
  "status": "$status",
  "exit_code": $exit_code,
  "storage_account": "$storageAccount",
  "container": "$container",
  "processed_run_id": "$processedRunId",
  "collection_name": "$collectionName",
  "model_name": "$modelName",
  "code_archive_blob": "$codeArchiveBlob",
  "prepare_processed_if_missing": "$prepareProcessedIfMissing",
  "allow_raw_download": "$allowRawDownload",
  "log_path": "logs/$cloudRunId/remote_embedding_job.log",
  "status_path": "logs/$cloudRunId/status.json",
  "embedding_manifest_path": "embeddings/$embeddingRunId/manifest.json",
  "snapshot_prefix": "indexes/$embeddingRunId"
}
EOF

  az storage blob upload \
    --account-name "$storageAccount" \
    --container-name "$container" \
    --name "logs/$cloudRunId/status.json" \
    --file "$statusFile" \
    --overwrite true \
    --auth-mode login \
    --output none || true

  az storage blob upload \
    --account-name "$storageAccount" \
    --container-name "$container" \
    --name "logs/$cloudRunId/remote_embedding_job.log" \
    --file "$logFile" \
    --overwrite true \
    --auth-mode login \
    --output none || true
}

cleanup() {
  local exit_code="$?"

  if [ "$qdrantStarted" = true ]; then
    ./scripts/stop_qdrant.sh || true
  fi

  upload_run_artifacts "$exit_code"

  exit "$exit_code"
}

trap cleanup EXIT

touch "$logFile"
exec > >(tee -a "$logFile") 2>&1

echo "=== Azure Managed Identity Login ==="
az login --identity --output none

echo "=== Remote Embedding Job ==="
echo "repo: $repoDir"
echo "storage account: $storageAccount"
echo "container: $container"
echo "processed run id: $processedRunId"
echo "collection: $collectionName"
echo "model: $modelName"
echo "code archive: $codeArchiveBlob"
echo "cloud run id: $cloudRunId"
echo "prepare processed if missing: $prepareProcessedIfMissing"
echo "allow raw download: $allowRawDownload"

if [ -n "$codeArchiveBlob" ]; then
  archive_path="$(mktemp).tar.gz"

  mkdir -p "$repoDir"

  az storage blob download \
    --account-name "$storageAccount" \
    --container-name "$container" \
    --name "$codeArchiveBlob" \
    --file "$archive_path" \
    --auth-mode login \
    --output none

  tar -xzf "$archive_path" -C "$repoDir"
  rm -f "$archive_path"
fi

cd "$repoDir"

echo "=== Installing Python Dependencies ==="
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

ensure_args=(
  --storage-account "$storageAccount"
  --container "$container"
  --processed-run-id "$processedRunId"
)

if [ "$prepareProcessedIfMissing" = true ]; then
  ensure_args+=(--prepare-if-missing)
fi

if [ "$allowRawDownload" = true ]; then
  ensure_args+=(--allow-raw-download)
fi

./scripts/ensure_processed_input.sh "${ensure_args[@]}"

./scripts/start_qdrant.sh
qdrantStarted=true

embeddingRunId="$(date -u +%Y%m%dT%H%M%SZ)"

python ./src/embeddings/generate_embeddings.py \
  --processed-dir data/processed/latest \
  --output-root data/embeddings \
  --collection-name "$collectionName" \
  --model-name "$modelName" \
  --device auto \
  --batch-size 128 \
  --queue-size 4 \
  --point-id-shard-size 50000 \
  --recreate-collection \
  --run-id "$embeddingRunId" \
  --progress-every 100000

./scripts/store_qdrant_snapshot.sh \
  --collection-name "$collectionName" \
  --run-id "$embeddingRunId" \
  --upload \
  --storage-account "$storageAccount" \
  --container "$container"

az storage blob upload \
  --account-name "$storageAccount" \
  --container-name "$container" \
  --name "embeddings/$embeddingRunId/manifest.json" \
  --file "data/embeddings/$embeddingRunId/manifest.json" \
  --overwrite true \
  --auth-mode login

echo
echo "Remote embedding job complete."
echo "cloud run id: $cloudRunId"
echo "embedding run id: $embeddingRunId"
echo "log path: logs/$cloudRunId/remote_embedding_job.log"
echo "status path: logs/$cloudRunId/status.json"
