#!/usr/bin/env bash
set -euo pipefail

# Load a gzip-compressed Docker archive produced by build_web_image_archive.sh.

ARCHIVE_PATH=""

usage() {
  cat <<'USAGE'
Usage:
  scripts/web/load_web_image_archive.sh --archive PATH

Options:
  --archive PATH
      gzip-compressed Docker archive created by build_web_image_archive.sh.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --archive)
      ARCHIVE_PATH="$2"
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

if [ -z "$ARCHIVE_PATH" ]; then
  echo "--archive is required" >&2
  usage >&2
  exit 1
fi

if [ ! -f "$ARCHIVE_PATH" ]; then
  echo "Archive not found: $ARCHIVE_PATH" >&2
  exit 1
fi

gzip -dc "$ARCHIVE_PATH" | docker load
