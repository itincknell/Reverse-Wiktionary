#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: prepare_prod_dirs.sh

Creates production app and data directories.

Environment:
  REVERSE_WIKTIONARY_APP_DIR    Default: /opt/reverse-wiktionary/app
  REVERSE_WIKTIONARY_DATA_ROOT  Default: /opt/reverse-wiktionary/data
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT="${REVERSE_WIKTIONARY_DATA_ROOT:-/opt/reverse-wiktionary/data}"
APP_DIR="${REVERSE_WIKTIONARY_APP_DIR:-/opt/reverse-wiktionary/app}"

mkdir -p "$APP_DIR"
mkdir -p "$ROOT/qdrant/storage"
mkdir -p "$ROOT/redis/data"
mkdir -p "$ROOT/logs/nginx"
mkdir -p "$ROOT/audio-cache/nginx"
mkdir -p "$ROOT/pronunciation-cache/nginx"
mkdir -p "$ROOT/snapshots"

echo "app dir: $APP_DIR"
echo "data root: $ROOT"
