#!/usr/bin/env bash

set -euo pipefail

INPUT="data/raw/wiktionary.jsonl"
OUTDIR="data/processed/normalized_test"
MANIFEST="data/processed/manifest_test.json"
LIMIT=50000
SHARD_SIZE=5000

rm -rf "$OUTDIR"
rm -f "$MANIFEST"
mkdir -p "$OUTDIR"

python ./src/embeddings/parse_wiktionary.py \
  --input "$INPUT" \
  --output-dir "$OUTDIR" \
  --manifest "$MANIFEST" \
  --limit "$LIMIT" \
  --shard-size "$SHARD_SIZE"

echo "=== Manifest Summary ==="
jq '{
  records_processed,
  rows_written,
  num_shards,
  shard_size,
  expansion_ratio: (.rows_written / .records_processed)
}' "$MANIFEST"

echo "=== Shards ==="
ls -lh "$OUTDIR"

echo "=== Rows Per Shard ==="
jq -r '.shards[] | "\(.path): \(.rows) rows"' "$MANIFEST"

echo "=== Sample Output ==="
head -n 5 "$OUTDIR"/shard_00000.jsonl | jq . || true