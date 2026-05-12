#!/usr/bin/env bash
set -euo pipefail

# Start an existing Azure VM, run the embedding job remotely, upload the Qdrant
# snapshot back to Blob Storage, and deallocate the VM when the command exits.

RESOURCE_GROUP=""
VM_NAME=""
STORAGE_ACCOUNT=""
CONTAINER=""
PROCESSED_RUN_ID="latest"
COLLECTION_NAME="reverse_wiktionary_v1"
MODEL_NAME="sentence-transformers/all-mpnet-base-v2"
VM_REPO_DIR="/opt/reverse-wiktionary"
DEALLOCATE=true
JOB_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
CODE_ARCHIVE_BLOB="code/$JOB_RUN_ID/repo.tar.gz"
LOCAL_ARCHIVE=""
PREPARE_PROCESSED_IF_MISSING=false
ALLOW_RAW_DOWNLOAD=false

usage() {
  sed -n '5,42p' "$0"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --resource-group)
      RESOURCE_GROUP="$2"
      shift 2
      ;;
    --vm-name)
      VM_NAME="$2"
      shift 2
      ;;
    --storage-account)
      STORAGE_ACCOUNT="$2"
      shift 2
      ;;
    --container)
      CONTAINER="$2"
      shift 2
      ;;
    --processed-run-id)
      PROCESSED_RUN_ID="$2"
      shift 2
      ;;
    --collection-name)
      COLLECTION_NAME="$2"
      shift 2
      ;;
    --model-name)
      MODEL_NAME="$2"
      shift 2
      ;;
    --vm-repo-dir)
      VM_REPO_DIR="$2"
      shift 2
      ;;
    --leave-running)
      DEALLOCATE=false
      shift
      ;;
    --prepare-processed-if-missing)
      PREPARE_PROCESSED_IF_MISSING=true
      shift
      ;;
    --allow-raw-download)
      ALLOW_RAW_DOWNLOAD=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [ -z "$RESOURCE_GROUP" ] || [ -z "$VM_NAME" ]; then
  echo "Missing required arguments: --resource-group and --vm-name"
  exit 1
fi

if [ -z "$STORAGE_ACCOUNT" ] || [ -z "$CONTAINER" ]; then
  echo "Missing required arguments: --storage-account and --container"
  exit 1
fi

cleanup() {
  if [ -n "$LOCAL_ARCHIVE" ]; then
    rm -f "$LOCAL_ARCHIVE"
  fi

  if [ "$DEALLOCATE" = true ]; then
    echo
    echo "=== Deallocating VM ==="
    az vm deallocate \
      --resource-group "$RESOURCE_GROUP" \
      --name "$VM_NAME"
  fi
}

trap cleanup EXIT

LOCAL_ARCHIVE="$(mktemp).tar.gz"

echo "=== Packaging Repo ==="
echo "archive blob: $CONTAINER/$CODE_ARCHIVE_BLOB"

tar -czf "$LOCAL_ARCHIVE" \
  --exclude ".git" \
  --exclude ".DS_Store" \
  --exclude "data" \
  --exclude "revwik" \
  --exclude "__pycache__" \
  .

az storage blob upload \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "$CODE_ARCHIVE_BLOB" \
  --file "$LOCAL_ARCHIVE" \
  --overwrite true \
  --auth-mode login

echo "=== Starting VM ==="
az vm start \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME"

echo
echo "=== Running Remote Embedding Job ==="
az vm run-command invoke \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --command-id RunShellScript \
  --scripts @scripts/azure/run_embedding_job_remote.sh \
  --parameters \
    storageAccount="$STORAGE_ACCOUNT" \
    container="$CONTAINER" \
    processedRunId="$PROCESSED_RUN_ID" \
    collectionName="$COLLECTION_NAME" \
    modelName="$MODEL_NAME" \
    repoDir="$VM_REPO_DIR" \
    codeArchiveBlob="$CODE_ARCHIVE_BLOB" \
    cloudRunId="$JOB_RUN_ID" \
    prepareProcessedIfMissing="$PREPARE_PROCESSED_IF_MISSING" \
    allowRawDownload="$ALLOW_RAW_DOWNLOAD"

echo
echo "=== Cloud Run Artifacts ==="
echo "cloud run id: $JOB_RUN_ID"
echo "code archive: $CONTAINER/$CODE_ARCHIVE_BLOB"
echo "log: $CONTAINER/logs/$JOB_RUN_ID/remote_embedding_job.log"
echo "status: $CONTAINER/logs/$JOB_RUN_ID/status.json"
