#!/usr/bin/env bash
set -euo pipefail

# Clone or update the public serving repository on an Azure VM.

REPO_URL="${REPO_URL:-https://github.com/itincknell/Reverse-Wiktionary.git}"
APP_DIR="${APP_DIR:-/opt/reverse-wiktionary/app}"
REF="${REF:-main}"

if ! command -v git >/dev/null 2>&1; then
  apt-get update
  apt-get install -y git
fi

mkdir -p "$(dirname "$APP_DIR")"

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --prune origin
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

git -C "$APP_DIR" checkout "$REF"
git -C "$APP_DIR" pull --ff-only origin "$REF"
git -C "$APP_DIR" rev-parse HEAD
