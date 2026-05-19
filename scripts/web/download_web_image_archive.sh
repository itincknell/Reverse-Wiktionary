#!/usr/bin/env bash
set -euo pipefail

# Download a saved web Docker image archive from Blob Storage and verify it
# against the uploaded manifest.

STORAGE_ACCOUNT=""
CONTAINER=""
TAG="${WEB_IMAGE_TAG:-}"
IMAGE_NAME="${WEB_IMAGE_NAME:-reverse-wiktionary-web}"
BLOB_PREFIX="${WEB_IMAGE_BLOB_PREFIX:-docker-images/web}"
OUTPUT_DIR="${WEB_IMAGE_ARCHIVE_DIR:-/opt/reverse-wiktionary/data/restore}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/web/download_web_image_archive.sh \
    --storage-account NAME \
    --container NAME \
    [--tag TAG] \
    [--image-name NAME] \
    [--blob-prefix PATH] \
    [--output-dir PATH]

Options:
  --storage-account NAME
      Azure Storage account.
  --container NAME
      Azure Blob container.
  --tag TAG
      Image tag. Defaults to the current Git short SHA.
  --image-name NAME
      Docker image repository name. Defaults to reverse-wiktionary-web.
  --blob-prefix PATH
      Blob prefix for archived web images. Defaults to docker-images/web.
  --output-dir PATH
      Local directory for the downloaded archive and manifest.
      Defaults to /opt/reverse-wiktionary/data/restore.
USAGE
}

require_value() {
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then
    echo "$1 requires a value" >&2
    usage >&2
    exit 1
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --storage-account)
      require_value "$@"
      STORAGE_ACCOUNT="$2"
      shift 2
      ;;
    --container)
      require_value "$@"
      CONTAINER="$2"
      shift 2
      ;;
    --tag)
      require_value "$@"
      TAG="$2"
      shift 2
      ;;
    --image-name)
      require_value "$@"
      IMAGE_NAME="$2"
      shift 2
      ;;
    --blob-prefix)
      require_value "$@"
      BLOB_PREFIX="$2"
      shift 2
      ;;
    --output-dir)
      require_value "$@"
      OUTPUT_DIR="$2"
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

if [ -z "$STORAGE_ACCOUNT" ] || [ -z "$CONTAINER" ]; then
  echo "--storage-account and --container are required" >&2
  usage >&2
  exit 1
fi

if [ -z "$TAG" ]; then
  TAG="$(git rev-parse --short=12 HEAD)"
fi

for command in az git jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

mkdir -p "$OUTPUT_DIR"

safeImageName="${IMAGE_NAME//\//_}"
archiveName="$safeImageName-$TAG.tar.gz"
manifestPath="$OUTPUT_DIR/$safeImageName-$TAG.json"
archivePath="$OUTPUT_DIR/$archiveName"
manifestBlob="$BLOB_PREFIX/$TAG/manifest.json"
archiveBlob="$BLOB_PREFIX/$TAG/$archiveName"

az storage blob download \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "$manifestBlob" \
  --file "$manifestPath" \
  --auth-mode login \
  --overwrite \
  --output none

expectedArchive="$(jq -r '.archive' "$manifestPath")"
expectedSha256="$(jq -r '.archive_sha256' "$manifestPath")"
expectedImage="$(jq -r '.image' "$manifestPath")"

if [ "$expectedArchive" != "$archiveName" ]; then
  echo "Manifest archive '$expectedArchive' does not match '$archiveName'" >&2
  exit 1
fi

az storage blob download \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "$archiveBlob" \
  --file "$archivePath" \
  --auth-mode login \
  --overwrite

if command -v shasum >/dev/null 2>&1; then
  actualSha256="$(shasum -a 256 "$archivePath" | awk '{print $1}')"
else
  actualSha256="$(sha256sum "$archivePath" | awk '{print $1}')"
fi

if [ "$actualSha256" != "$expectedSha256" ]; then
  echo "Archive checksum mismatch" >&2
  echo "expected: $expectedSha256" >&2
  echo "actual:   $actualSha256" >&2
  exit 1
fi

echo "image: $expectedImage"
echo "archive: $archivePath"
echo "manifest: $manifestPath"
echo "sha256: $actualSha256"
