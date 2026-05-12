#!/usr/bin/env bash
set -euo pipefail

# Ensure data/processed/latest exists for an embedding job.
#
# Default behavior is strict: require processed artifacts in Blob Storage.
# Optional fallback behavior can prepare processed shards from raw Blob data, and
# optionally download raw data from Kaikki when Blob does not have it.

STORAGE_ACCOUNT=""
CONTAINER=""
PROCESSED_RUN_ID="latest"
PREPARE_IF_MISSING=false
ALLOW_RAW_DOWNLOAD=false

usage() {
  sed -n '5,32p' "$0"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
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
    --prepare-if-missing)
      PREPARE_IF_MISSING=true
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

if [ -z "$STORAGE_ACCOUNT" ]; then
  echo "Missing required argument: --storage-account"
  exit 1
fi

if [ -z "$CONTAINER" ]; then
  echo "Missing required argument: --container"
  exit 1
fi

download_processed() {
  if [ "$PROCESSED_RUN_ID" = "latest" ]; then
    ./scripts/download_processed_from_blob.sh \
      --storage-account "$STORAGE_ACCOUNT" \
      --container "$CONTAINER" \
      --latest
  else
    ./scripts/download_processed_from_blob.sh \
      --storage-account "$STORAGE_ACCOUNT" \
      --container "$CONTAINER" \
      --run-id "$PROCESSED_RUN_ID"
  fi
}

echo "=== Ensuring Processed Input ==="
echo "processed run id: $PROCESSED_RUN_ID"

if download_processed; then
  echo "Processed input is ready."
  exit 0
fi

if [ "$PREPARE_IF_MISSING" != true ]; then
  echo "Processed input was not found, and fallback preparation is disabled."
  exit 1
fi

echo
echo "Processed input not found. Preparing processed input from raw data."

if ! ./scripts/download_raw_from_blob.sh \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER" \
  --latest; then

  if [ "$ALLOW_RAW_DOWNLOAD" != true ]; then
    echo "Raw input was not found in Blob, and Kaikki download fallback is disabled."
    exit 1
  fi

  echo
  echo "Raw input not found in Blob. Downloading from Kaikki."
  ./scripts/download_wiktionary_dump.sh --download-new

  ./scripts/upload_raw_to_blob.sh \
    --storage-account "$STORAGE_ACCOUNT" \
    --container "$CONTAINER"
fi

echo
echo "=== Running Preprocessing ==="
./scripts/run_parse_wiktionary.sh

echo
echo "=== Uploading Prepared Processed Run ==="
./scripts/upload_processed_to_blob.sh \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER"

echo
echo "Processed input is ready."
