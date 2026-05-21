#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: disk_usage.sh

Shows disk usage for the web data root.

Environment:
  REVERSE_WIKTIONARY_DATA_ROOT  Default: /opt/reverse-wiktionary/data
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT="${REVERSE_WIKTIONARY_DATA_ROOT:-/opt/reverse-wiktionary/data}"

df -h "$ROOT"
du -h -d 2 "$ROOT" 2>/dev/null | sort -h
