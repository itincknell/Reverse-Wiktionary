#!/usr/bin/env bash
set -euo pipefail

# Reset VM-local serving state before a clean deployment test.

DATA_ROOT="${REVERSE_WIKTIONARY_DATA_ROOT:-/opt/reverse-wiktionary/data}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/web/compose.prod.yml}"
ENV_FILE="${ENV_FILE:-deploy/web/.env}"
REMOVE_IMAGES="false"
YES="false"

usage() {
  cat <<'USAGE'
Usage:
  scripts/web/reset_prod_state.sh --yes [options]

Options:
  --data-root PATH
      Serving data root. Defaults to /opt/reverse-wiktionary/data.
  --compose-file PATH
      Compose file to stop before deleting local state.
      Defaults to deploy/web/compose.prod.yml.
  --env-file PATH
      Compose env file. Defaults to deploy/web/.env.
  --remove-images
      Remove local reverse-wiktionary-web images after stopping containers.
  --yes
      Required confirmation flag.

Deletes restored Qdrant state, Redis state, snapshots, restore staging files,
processed metadata, and runtime logs. It leaves the Git checkout in place.
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
    --data-root)
      require_value "$@"
      DATA_ROOT="$2"
      shift 2
      ;;
    --compose-file)
      require_value "$@"
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --env-file)
      require_value "$@"
      ENV_FILE="$2"
      shift 2
      ;;
    --remove-images)
      REMOVE_IMAGES="true"
      shift
      ;;
    --yes)
      YES="true"
      shift
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

if [ "$YES" != "true" ]; then
  echo "--yes is required" >&2
  usage >&2
  exit 1
fi

composeArgs=(-f "$COMPOSE_FILE")
if [ -f "$ENV_FILE" ]; then
  composeArgs=(--env-file "$ENV_FILE" "${composeArgs[@]}")
fi

if command -v docker >/dev/null 2>&1; then
  docker compose "${composeArgs[@]}" down --remove-orphans || true
fi

rm -rf \
  "$DATA_ROOT/qdrant/storage" \
  "$DATA_ROOT/redis/data" \
  "$DATA_ROOT/snapshots" \
  "$DATA_ROOT/restore" \
  "$DATA_ROOT/processed/latest" \
  "$DATA_ROOT/logs"

mkdir -p \
  "$DATA_ROOT/qdrant/storage" \
  "$DATA_ROOT/redis/data" \
  "$DATA_ROOT/snapshots" \
  "$DATA_ROOT/restore" \
  "$DATA_ROOT/processed/latest" \
  "$DATA_ROOT/logs/nginx"

if [ "$REMOVE_IMAGES" = "true" ] && command -v docker >/dev/null 2>&1; then
  docker image ls --format '{{.Repository}}:{{.Tag}}' \
    | awk '/^reverse-wiktionary-web:/ {print}' \
    | while IFS= read -r image; do
        [ -n "$image" ] && docker image rm "$image"
      done
fi

echo "reset complete: $DATA_ROOT"
