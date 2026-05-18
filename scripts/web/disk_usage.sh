#!/usr/bin/env bash
set -euo pipefail

ROOT="${REVERSE_WIKTIONARY_DATA_ROOT:-/opt/reverse-wiktionary/data}"

df -h "$ROOT"
du -h -d 2 "$ROOT" 2>/dev/null | sort -h
