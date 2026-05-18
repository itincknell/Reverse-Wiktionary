#!/usr/bin/env bash
set -euo pipefail

storageAccount=""
container=""
collectionName="${COLLECTION_NAME:-reverse_wiktionary_v1}"
dataRoot="${REVERSE_WIKTIONARY_DATA_ROOT:-/opt/reverse-wiktionary/data}"
qdrantUrl="${QDRANT_URL:-http://127.0.0.1:6333}"
runId=""
replaceExisting="false"
keepSnapshot="false"
identityLogin="true"

usage() {
  cat <<'USAGE'
Usage:
  scripts/web/restore_qdrant_from_blob.sh \
    --storage-account NAME \
    --container NAME \
    [--collection-name NAME] \
    [--run-id RUN_ID] \
    [--data-root PATH] \
    [--qdrant-url URL] \
    [--replace-existing] \
    [--keep-snapshot] \
    [--skip-identity-login]

Restores a Qdrant collection from the serving snapshot pointed to by
indexes/latest.json, or from indexes/<run_id>/manifest.json when --run-id is
provided. Also stages language_taxonomy.json and serving_metadata.json from
processed/latest.json for the web app.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --storage-account)
      storageAccount="$2"
      shift 2
      ;;
    --container)
      container="$2"
      shift 2
      ;;
    --collection-name)
      collectionName="$2"
      shift 2
      ;;
    --run-id)
      runId="$2"
      shift 2
      ;;
    --data-root)
      dataRoot="$2"
      shift 2
      ;;
    --qdrant-url)
      qdrantUrl="$2"
      shift 2
      ;;
    --replace-existing)
      replaceExisting="true"
      shift
      ;;
    --keep-snapshot)
      keepSnapshot="true"
      shift
      ;;
    --skip-identity-login)
      identityLogin="false"
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

if [ -z "$storageAccount" ] || [ -z "$container" ]; then
  echo "--storage-account and --container are required" >&2
  usage >&2
  exit 1
fi

for command in az jq curl docker; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

if [ "$identityLogin" = "true" ]; then
  az login --identity --output none
fi

export REVERSE_WIKTIONARY_DATA_ROOT="$dataRoot"
./scripts/web/prepare_prod_dirs.sh

composeArgs=(-f deploy/web/compose.prod.yml)
if [ -f deploy/web/.env ]; then
  composeArgs=(--env-file deploy/web/.env "${composeArgs[@]}")
fi

docker compose "${composeArgs[@]}" up -d qdrant

echo "waiting for qdrant..."
for _ in $(seq 1 120); do
  if curl -fsS "$qdrantUrl/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS "$qdrantUrl/healthz" >/dev/null; then
  echo "Qdrant health check failed at $qdrantUrl" >&2
  docker compose "${composeArgs[@]}" logs --tail 100 qdrant
  exit 1
fi

workDir="$dataRoot/restore"
snapshotRoot="$dataRoot/snapshots"
processedDir="data/processed/latest"
mkdir -p "$workDir" "$snapshotRoot" "$processedDir"

if [ -z "$runId" ]; then
  az storage blob download \
    --account-name "$storageAccount" \
    --container-name "$container" \
    --name "indexes/latest.json" \
    --file "$workDir/indexes_latest.json" \
    --auth-mode login \
    --overwrite \
    --output none

  manifestPath="$(jq -r '.manifest_path' "$workDir/indexes_latest.json")"
  runId="$(jq -r '.run_id' "$workDir/indexes_latest.json")"
else
  manifestPath="indexes/$runId/manifest.json"
fi

if [ -z "$runId" ] || [ "$runId" = "null" ]; then
  echo "Could not determine index run id" >&2
  exit 1
fi

az storage blob download \
  --account-name "$storageAccount" \
  --container-name "$container" \
  --name "$manifestPath" \
  --file "$workDir/index_manifest.json" \
  --auth-mode login \
  --overwrite \
  --output none

manifestCollection="$(jq -r '.collection_name // empty' "$workDir/index_manifest.json")"
if [ -n "$manifestCollection" ] && [ "$manifestCollection" != "$collectionName" ]; then
  echo "Manifest collection '$manifestCollection' does not match '$collectionName'" >&2
  exit 1
fi

snapshotPath="$(jq -r '.snapshot_path // empty' "$workDir/index_manifest.json")"
if [ -z "$snapshotPath" ]; then
  echo "Manifest does not contain snapshot_path" >&2
  exit 1
fi

snapshotFile="$(basename "$snapshotPath")"
snapshotBlob="indexes/$runId/snapshots/$snapshotFile"
snapshotDir="$snapshotRoot/$runId"
snapshotHostPath="$snapshotDir/$snapshotFile"
snapshotContainerUri="file:///qdrant/snapshots/$runId/$snapshotFile"

mkdir -p "$snapshotDir"

echo "downloading $snapshotBlob"
az storage blob download \
  --account-name "$storageAccount" \
  --container-name "$container" \
  --name "$snapshotBlob" \
  --file "$snapshotHostPath" \
  --auth-mode login \
  --overwrite

if curl -fsS "$qdrantUrl/collections/$collectionName" >/dev/null 2>&1; then
  if [ "$replaceExisting" != "true" ]; then
    echo "Collection already exists: $collectionName. Use --replace-existing to recover over it." >&2
    exit 1
  fi

  curl -fsS -X DELETE "$qdrantUrl/collections/$collectionName" >/dev/null
  for _ in $(seq 1 120); do
    if ! curl -fsS "$qdrantUrl/collections/$collectionName" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
fi

echo "recovering $collectionName from $snapshotContainerUri"
curl -fsS \
  -X PUT "$qdrantUrl/collections/$collectionName/snapshots/recover?wait=true" \
  -H "Content-Type: application/json" \
  --data "{\"location\":\"$snapshotContainerUri\",\"priority\":\"snapshot\"}" \
  | jq .

for _ in $(seq 1 180); do
  if curl -fsS "$qdrantUrl/collections/$collectionName" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -fsS "$qdrantUrl/collections/$collectionName" \
  | jq '{status: .result.status, points: .result.points_count, indexed: .result.indexed_vectors_count, payload_schema: .result.payload_schema}'

echo "staging processed metadata"
az storage blob download \
  --account-name "$storageAccount" \
  --container-name "$container" \
  --name "processed/latest.json" \
  --file "$workDir/processed_latest.json" \
  --auth-mode login \
  --overwrite \
  --output none

processedRunId="$(jq -r '.run_id' "$workDir/processed_latest.json")"
if [ -z "$processedRunId" ] || [ "$processedRunId" = "null" ]; then
  echo "Could not determine processed run id" >&2
  exit 1
fi

az storage blob download \
  --account-name "$storageAccount" \
  --container-name "$container" \
  --name "processed/$processedRunId/language_taxonomy.json" \
  --file "$processedDir/language_taxonomy.json" \
  --auth-mode login \
  --overwrite \
  --output none

az storage blob download \
  --account-name "$storageAccount" \
  --container-name "$container" \
  --name "processed/$processedRunId/serving_metadata.json" \
  --file "$processedDir/serving_metadata.json" \
  --auth-mode login \
  --overwrite \
  --output none

if [ "$keepSnapshot" != "true" ]; then
  rm -f "$snapshotHostPath"
fi

echo "restore complete"
echo "index run: $runId"
echo "processed run: $processedRunId"
echo "data root: $dataRoot"
