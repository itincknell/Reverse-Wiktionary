# Data Contracts

This project stores pipeline artifacts as immutable timestamped runs. A run ID
uses UTC timestamp format:

```text
YYYYMMDDTHHMMSSZ
```

Consumers should prefer manifests over directory inspection whenever possible.
Consumers should also ignore unknown JSON fields so schemas can grow without
breaking older scripts.

## Local Artifact Layout

Local development uses real directories plus a `latest` symlink:

```text
data/raw/<run_id>/
data/raw/latest -> <run_id>

data/processed/<run_id>/
data/processed/latest -> <run_id>

data/embeddings/<run_id>/
data/embeddings/latest -> <run_id>

data/indexes/<run_id>/
```

The local `latest` symlink is an ergonomic pointer for scripts that run on a
single filesystem. It is not uploaded to Blob Storage.

## Blob Artifact Layout

Azure Blob Storage uses immutable run prefixes plus small JSON pointer blobs:

```text
raw/<run_id>/
raw/latest.json

processed/<run_id>/
processed/latest.json

embeddings/<run_id>/

code/<run_id>/

indexes/<run_id>/
indexes/latest.json
```

Blob Storage does not support filesystem symlinks. The `latest.json` pointer
files provide equivalent behavior without duplicating large shard or snapshot
files.

## Latest Pointer Schema

Current schema: `v1`

Example:

```json
{
  "stage": "processed",
  "run_id": "20260511T183000Z",
  "prefix": "processed/20260511T183000Z",
  "manifest_path": "processed/20260511T183000Z/manifest.json",
  "updated_at_utc": "2026-05-11T18:45:00Z"
}
```

Fields:

- `stage`: Artifact stage. Expected values include `raw`, `processed`, and `indexes`.
- `run_id`: Timestamped run identifier.
- `prefix`: Blob prefix containing the immutable run artifacts.
- `manifest_path`: Blob path to the run manifest or metadata file.
- `updated_at_utc`: UTC timestamp when this pointer was written.

## Raw Run

Producer: `scripts/download_wiktionary_dump.sh`

Local layout:

```text
data/raw/<run_id>/
  raw-wiktextract-data.jsonl.gz
  wiktionary.jsonl
  metadata.json
```

Blob layout:

```text
raw/<run_id>/
  raw-wiktextract-data.jsonl.gz
  wiktionary.jsonl
  metadata.json

raw/latest.json
```

`metadata.json` fields:

- `source_url`: Source URL for the downloaded dump.
- `updated_at_utc`: UTC timestamp when local metadata was written.
- `compressed_path`: Local path to the compressed dump.
- `uncompressed_path`: Local path to the decompressed JSONL dump.
- `compressed_size_bytes`: Compressed file size.
- `uncompressed_size_bytes`: Decompressed file size.

## Processed Rows

Producer: `src/embeddings/parse_wiktionary.py`

Consumers:

- `src/embeddings/generate_embeddings.py`
- `src/embeddings/utils/shard_reader.py`

Current row schema: `v4`

Each line in `shard_*.jsonl` is one JSON object.

Required fields:

- `lang`: Source language as a string.
- `word`: Dictionary headword as a string.
- `pos`: Part of speech as a string.
- `glosses`: Ordered list of cleaned gloss strings.
- `embedding_text`: String sent to the embedding model.

Optional fields:

- `expansion`: Display text from Wiktionary head templates when available.

Compatibility rules:

- Consumers must ignore unknown fields.
- Producers should bump `SCHEMA_VERSION` before removing or renaming fields.
- `embedding_text` is the model input contract; presentation fields should not
  be reconstructed by consumers.

## Preprocessing Manifest

Producer: `src/embeddings/parse_wiktionary.py`

Path:

```text
data/processed/<run_id>/manifest.json
processed/<run_id>/manifest.json
```

Important fields:

- `run_id`: Processed run identifier.
- `created_at_utc`: Manifest creation time.
- `schema_version`: Processed row schema version.
- `input_path`: Local input path used by the run.
- `output_dir`: Local output directory.
- `shard_size`: Maximum rows per shard.
- `num_shards`: Number of shard files written.
- `records_processed`: Raw JSONL records read.
- `rows_written`: Normalized rows emitted.
- `skipped_bad_json`: Malformed JSON lines skipped.
- `skipped_non_object`: Non-object JSON values skipped.
- `skipped_empty_lines`: Empty input lines skipped.
- `shards`: Per-shard metadata.

## Embedding Manifest

Producer: `src/embeddings/generate_embeddings.py`

Path:

```text
data/embeddings/<run_id>/manifest.json
embeddings/<run_id>/manifest.json
```

Important fields:

- `run_id`: Embedding run identifier.
- `stage`: `embedding`.
- `processed_run_id`: Processed input run identifier.
- `processed_dir`: Local processed input path.
- `model`: Embedding model name and vector size.
- `qdrant`: Qdrant URL and collection name.
- `config`: Batch size, queue size, point ID stride, distance metric.
- `metrics`: Rows, batches, and shards completed.
- `shards`: Per-shard completion records.

Resume behavior depends on the manifest's completed shard list. When changing
model, processed input, collection, or point ID stride, use a new embedding run.

## Qdrant Snapshot Manifest

Producer: `scripts/store_qdrant_snapshot.sh`

Path:

```text
data/indexes/<run_id>/manifest.json
indexes/<run_id>/manifest.json
```

Important fields:

- `run_id`: Snapshot run identifier.
- `stage`: `qdrant_snapshot`.
- `created_at_utc`: Manifest creation time.
- `qdrant_url`: Qdrant HTTP endpoint used to create the snapshot.
- `collection_name`: Qdrant collection snapshotted.
- `blob_prefix`: Blob prefix used when uploaded.
- `snapshot_path`: Local snapshot path.
- `snapshot_size_bytes`: Downloaded snapshot size.

## Azure VM Job Contract

Launcher: `scripts/run_embeddings_on_azure_vm.sh`

Remote job: `scripts/azure/run_embedding_job_remote.sh`

The first version assumes the VM already exists and has:

- Azure CLI authenticated with access to the storage account.
- Docker and Docker Compose available.
- `jq` available.
- Python dependencies installed for this project.

The launcher uploads a lightweight repository archive to:

```text
code/<run_id>/repo.tar.gz
```

The VM job downloads and extracts that archive into `/opt/reverse-wiktionary`,
or a custom path passed with `--vm-repo-dir`.

By default, the VM job reads `processed/latest.json`, downloads that processed
run, and fails if processed input is missing. This keeps the embedding stage
reproducible and prevents surprise multi-GB downloads.

Optional fallback flags:

- `--prepare-processed-if-missing`: If processed input is missing, download
  `raw/latest.json`, preprocess the raw dump, upload the new processed run, and
  continue embedding.
- `--allow-raw-download`: If raw input is also missing from Blob Storage,
  download the Kaikki dump, upload it to `raw/<run_id>/`, preprocess it, upload
  the new processed run, and continue embedding.

After processed input is ready, the VM job generates embeddings, snapshots
Qdrant, uploads `indexes/<run_id>/`, and updates `indexes/latest.json`.
