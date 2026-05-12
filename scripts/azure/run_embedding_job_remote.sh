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
prepareProcessedIfMissing="${prepareProcessedIfMissing:-false}"
allowRawDownload="${allowRawDownload:-false}"

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
trap './scripts/stop_qdrant.sh' EXIT

run_id="$(date -u +%Y%m%dT%H%M%SZ)"

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
  --run-id "$run_id" \
  --progress-every 100000

./scripts/store_qdrant_snapshot.sh \
  --collection-name "$collectionName" \
  --run-id "$run_id" \
  --upload \
  --storage-account "$storageAccount" \
  --container "$container"

az storage blob upload \
  --account-name "$storageAccount" \
  --container-name "$container" \
  --name "embeddings/$run_id/manifest.json" \
  --file "data/embeddings/$run_id/manifest.json" \
  --overwrite true \
  --auth-mode login

echo
echo "Remote embedding job complete."
echo "embedding run id: $run_id"
