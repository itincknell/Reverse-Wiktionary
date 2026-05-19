#!/usr/bin/env bash
set -euo pipefail

# Build the serving web image and save it as a gzip-compressed Docker archive.
# This avoids rebuilding the large torch/sentence-transformers layer on small
# deployment VMs.

IMAGE_NAME="${WEB_IMAGE_NAME:-reverse-wiktionary-web}"
TAG="${WEB_IMAGE_TAG:-}"
OUTPUT_DIR="${WEB_IMAGE_ARCHIVE_DIR:-data/docker-images}"
UPLOAD="false"
STORAGE_ACCOUNT=""
CONTAINER=""
BLOB_PREFIX="docker-images"

usage() {
  cat <<'USAGE'
Usage:
  scripts/web/build_web_image_archive.sh [options]

Options:
  --image-name NAME
      Docker image repository name. Defaults to reverse-wiktionary-web.
  --tag TAG
      Docker image tag. Defaults to the current Git short SHA.
  --output-dir PATH
      Directory for the archive and manifest. Defaults to data/docker-images.
  --upload
      Upload archive and manifest to Azure Blob Storage.
  --storage-account NAME
      Azure Storage account used with --upload.
  --container NAME
      Azure Blob container used with --upload.
  --blob-prefix PATH
      Blob prefix used with --upload. Defaults to docker-images.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --image-name)
      IMAGE_NAME="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --upload)
      UPLOAD="true"
      shift
      ;;
    --storage-account)
      STORAGE_ACCOUNT="$2"
      shift 2
      ;;
    --container)
      CONTAINER="$2"
      shift 2
      ;;
    --blob-prefix)
      BLOB_PREFIX="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "$TAG" ]; then
  TAG="$(git rev-parse --short=12 HEAD)"
fi

if [ "$UPLOAD" = "true" ] && { [ -z "$STORAGE_ACCOUNT" ] || [ -z "$CONTAINER" ]; }; then
  echo "--storage-account and --container are required with --upload" >&2
  exit 1
fi

for command in docker git gzip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

mkdir -p "$OUTPUT_DIR"

IMAGE_REF="$IMAGE_NAME:$TAG"
LATEST_REF="$IMAGE_NAME:latest"
ARCHIVE_NAME="${IMAGE_NAME//\//_}-${TAG}.tar.gz"
ARCHIVE_PATH="$OUTPUT_DIR/$ARCHIVE_NAME"
MANIFEST_PATH="$OUTPUT_DIR/${IMAGE_NAME//\//_}-${TAG}.json"
GIT_COMMIT="$(git rev-parse HEAD)"
CREATED_AT_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

docker build \
  -f deploy/web/Dockerfile \
  -t "$IMAGE_REF" \
  -t "$LATEST_REF" \
  .

docker save "$IMAGE_REF" | gzip -c > "$ARCHIVE_PATH"

if command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
else
  SHA256="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
fi

SIZE_BYTES="$(wc -c < "$ARCHIVE_PATH" | tr -d ' ')"

python3 - "$MANIFEST_PATH" <<PY
import json
import sys

manifest = {
    "image": "$IMAGE_REF",
    "latest_tag": "$LATEST_REF",
    "archive": "$ARCHIVE_NAME",
    "archive_size_bytes": int("$SIZE_BYTES"),
    "archive_sha256": "$SHA256",
    "git_commit": "$GIT_COMMIT",
    "created_at_utc": "$CREATED_AT_UTC",
}

with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2)
    handle.write("\\n")
PY

echo "image: $IMAGE_REF"
echo "archive: $ARCHIVE_PATH"
echo "manifest: $MANIFEST_PATH"
echo "sha256: $SHA256"

if [ "$UPLOAD" = "true" ]; then
  if ! command -v az >/dev/null 2>&1; then
    echo "Required command not found for upload: az" >&2
    exit 1
  fi

  az storage blob upload \
    --account-name "$STORAGE_ACCOUNT" \
    --container-name "$CONTAINER" \
    --name "$BLOB_PREFIX/$TAG/$ARCHIVE_NAME" \
    --file "$ARCHIVE_PATH" \
    --auth-mode login \
    --overwrite

  az storage blob upload \
    --account-name "$STORAGE_ACCOUNT" \
    --container-name "$CONTAINER" \
    --name "$BLOB_PREFIX/$TAG/manifest.json" \
    --file "$MANIFEST_PATH" \
    --content-type application/json \
    --auth-mode login \
    --overwrite
fi
