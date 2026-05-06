# Reverse Wiktionary -- Design Document

## Overview

Reverse Wiktionary is an end-to-end semantic lexical search system that maps
natural-language descriptions to likely words using Wiktionary as a corpus.

The project is designed to demonstrate practical systems engineering around a
semantic retrieval workload: large-scale preprocessing, embedding generation,
vector indexing, artifact management, scripted cloud deployment, and a public
web service with acceptable latency and sustainable hosting cost.

The current design intentionally separates expensive offline batch computation
from cheap long-running serving.

```text
Offline pipeline:
Wiktionary JSONL
    -> normalized JSONL shards
    -> sentence embeddings
    -> Qdrant collection
    -> Qdrant snapshot / deployable artifacts
    -> Azure Blob Storage

Online service:
Azure VM
    -> Docker Compose
    -> Qdrant + FastAPI + web UI + reverse proxy
    -> public IP / domain
```

---

## Goals

### Product Goals

- Allow users to enter a natural-language clue or description and retrieve
  semantically related words.
- Support metadata-aware filtering, especially by language and part of speech.
- Provide a simple public web UI suitable for a portfolio/LinkedIn demo.
- Keep the system inexpensive enough to host during a multi-month job search.

### Engineering Goals

- Build a reproducible, cloud-backed semantic search pipeline.
- Use Azure Blob Storage as the durable artifact layer.
- Use ephemeral compute for expensive embedding/indexing work.
- Use a low-cost long-running VM for public serving.
- Treat Qdrant snapshots as deployable stateful artifacts.
- Keep the architecture understandable, scriptable, and debuggable.

---

## High-Level Architecture

```text
Wiktionary JSONL Dump
    |
    v
Local / Batch VM Preprocessing
    |
    v
Normalized JSONL Shards + Manifest
    |
    v
Embedding Generator
    |
    v
Qdrant Vector Collection
    |
    v
Qdrant Snapshot + Artifacts
    |
    v
Azure Blob Storage
    |
    v
Serving VM
    |
    +--> Qdrant Container
    +--> FastAPI / HTMX Web App
    +--> Caddy or Nginx Reverse Proxy
    |
    v
Public IP / Domain
```

---

## Current Data Scale

After preprocessing, the current normalized dataset contains approximately:

```text
3,835,659 normalized rows
912 MB of cleaned JSONL
78 JSONL shards
```

Rows have variable-length `embedding_text`. Some entries are very short, while
some have long descriptive glosses. The embedding pipeline must therefore handle
batching, truncation policy, and outlier lengths explicitly.

---

## Stage 1: Data Ingestion

### Input

The primary input is a Wiktionary-derived JSONL dump. Each line is a JSON object
representing a Wiktionary entry, typically including:

```json
{
  "lang": "English",
  "word": "dictionary",
  "pos": "noun",
  "senses": [...]
}
```

### Artifact Strategy

Raw data is stored in Azure Blob Storage after initial acquisition. Local copies
are considered ephemeral development artifacts.

Suggested Blob layout:

```text
raw/wiktionary/<dump_version>/wiktionary.jsonl
processed/<run_id>/normalized/shard_00000.jsonl
processed/<run_id>/manifest.json
indexes/<run_id>/qdrant_snapshot/
releases/<release_id>/
```

### Design Decision

The raw Wiktionary dump should be downloaded once, then uploaded to Blob Storage
so later VM runs do not repeatedly download from the original source.

---

## Stage 2: Preprocessing Pipeline

### Purpose

The preprocessing stage converts raw Wiktionary records into compact,
embedding-ready rows. It also removes low-value lexical artifacts such as
inflection-only entries and spelling variants.

### Input Contract

Each input line is a JSON object. The parser currently expects:

```json
{
  "lang": "str",
  "word": "str",
  "pos": "str",
  "senses": "list",
  "head_templates": "optional"
}
```

### Output Contract

Each output line is one normalized row grouped at the raw
`(lang, word, pos)` level:

```json
{
  "lang": "English",
  "word": "dictionary",
  "pos": "noun",
  "glosses": [
    "A reference work listing words or names from one or more languages..."
  ],
  "embedding_text": "A reference work listing words or names from one or more languages...",
  "expansion": "optional pronunciation/headword expansion"
}
```

### Current Grouping Rule

The parser outputs at most one row per raw record. Within that record, all usable
sense glosses are aggregated before deduplication.

```text
raw record -> gather all usable sense glosses -> dedupe glosses -> one row
```

This is a deliberate change from earlier drafts. The system is no longer using
one row per sense. The current row unit is closer to:

```text
language + word + part of speech + aggregated semantic glosses
```

### Why Not One Row Per Sense?

Initial experiments showed that many Wiktionary senses contain repeated parent
glosses or very small fragments. For reverse search, a richer POS-level digest is
often a better embedding target than many tiny, repetitive sense-level vectors.

### Embedding Text Decision

The embedding text is currently only the joined gloss text:

```python
embedding_text = " ".join(cleaned_glosses)
```

The embedding text intentionally does not include the word, language, or part of
speech. Those fields are retained as metadata.

Rationale:

- Short glosses can be dominated by unrelated metadata if formatted as
  `"word (pos, lang): gloss"`.
- The retrieval vector should represent the meaning, not the spelling or
  language label.
- `lang`, `word`, and `pos` are better handled as Qdrant payload metadata and
  UI presentation fields.

### Gloss Cleaning

Gloss cleaning performs:

- whitespace normalization
- filtering of non-string gloss values
- removal of empty glosses
- order-preserving deduplication

Unicode is preserved throughout the pipeline using UTF-8 and
`ensure_ascii=False`.

### Sense Filtering

The parser suppresses non-semantic or low-value senses using structural keys and
tags.

Filtered sense keys:

```python
SKIP_SENSE_KEYS = {
    "form_of",
    "alt_of",
}
```

Filtered tags:

```python
SKIP_TAGS = {
    "form-of",
    "alt-of",
    "alternative",
    "abbreviation",
    "acronym",
    "initialism",
    "contraction",
    "clipping",
    "misspelling",
    "obsolete",
    "archaic",
}
```

This removes entries such as:

```text
plural of X
alternative spelling of X
abbreviation of X
```

### POS Filtering

The parser keeps only parts of speech that are likely to be useful in a reverse
dictionary application.

Current allowlist:

```python
ALLOWED_POS = {
    "noun",
    "verb",
    "adj",
    "adv",
    "name",
    "proper noun",
    "phrase",
    "proverb",
    "idiom",
}
```

### Category Handling

Wiktionary category labels such as `en:Books`, `en:Group theory`, and
`en:Computing` are not currently used as suppression rules. They often represent
topical or domain-specific meanings, including useful technical meanings.

Future versions may preserve topical categories as metadata for filtering or
reranking, but they are not currently used to decide whether a sense is kept.

### Head Template / Expansion Metadata

Some languages, including Japanese and Arabic, contain useful pronunciation,
headword, romanization, or morphology data in `head_templates`.

The current parser stores a lightweight extracted field:

```json
{
  "expansion": "optional string extracted from head_templates"
}
```

The extraction is intentionally conservative. For now, `head_templates` is not
used in the embedding text. It is preserved as presentation or future parsing
metadata.

### Sharding

The parser writes deterministic JSONL shards:

```text
normalized/
  shard_00000.jsonl
  shard_00001.jsonl
  ...
```

A manifest records run metadata:

```json
{
  "run_id": "20260506T120000Z",
  "schema_version": "v4",
  "records_processed": 50000,
  "rows_written": 23588,
  "shard_size": 5000,
  "num_shards": 5,
  "shards": [
    {
      "shard_id": 0,
      "path": "normalized/shard_00000.jsonl",
      "status": "complete",
      "rows": 5000
    }
  ]
}
```

### Dry Run / Byte Count Mode

The preprocessing script supports a byte-count-only mode that processes records,
normalizes rows, and counts the exact UTF-8 JSONL output bytes without writing
shards.

This is useful for estimating:

- final cleaned data size
- Blob Storage footprint
- downstream embedding/indexing scale
- expected Qdrant payload size

The parser also supports progress printing for full-dump runs.

---

## Stage 3: Embedding Generation

### Purpose

The embedding generator reads normalized JSONL shards, batches
`embedding_text`, encodes each batch using a sentence embedding model, and
upserts vectors plus metadata into Qdrant.

### Inputs

```text
processed/<run_id>/normalized/shard_*.jsonl
processed/<run_id>/manifest.json
```

### Outputs

Potential outputs include:

```text
Qdrant collection
Qdrant snapshot
embedding run manifest
optional failed-row log
```

### Model Dimension

The current target is a 768-dimensional sentence embedding model. This is a
practical compromise between semantic quality, vector size, memory pressure, and
serving latency.

Approximate raw vector size for the current dataset:

```text
3,835,659 rows x 768 dims x 4 bytes ≈ 11.8 GB raw vectors
```

Actual Qdrant disk and memory usage will be larger due to HNSW index overhead,
payloads, metadata, and storage layout.

### Compute Strategy

Embedding generation should run on an ephemeral GPU VM if available.

```text
Azure Blob normalized shards
    -> temporary GPU VM
    -> embedding + Qdrant indexing
    -> snapshot export
    -> Azure Blob
    -> delete GPU VM
```

The GPU VM is not part of the long-running service. It is only used for offline
batch work.

### Batching Concerns

The embedding generator should handle:

- variable-length input text
- truncation policy for extreme outliers
- checkpointing by shard
- retry/resume behavior
- progress metrics
- failed-row logging

### Initial Implementation Plan

For V1, a single-process embedding worker is acceptable:

```text
for each normalized shard:
    read rows
    build batches
    encode embedding_text
    upsert vectors + payloads to Qdrant
    mark shard complete
```

This keeps the implementation simple while preserving a clear path to future
parallelization.

---

## Stage 4: Vector Storage: Qdrant

### Collection Design

One Qdrant collection stores all normalized lexical rows. Each vector corresponds
to one normalized row.

Payload fields should include:

```json
{
  "lang": "English",
  "word": "dictionary",
  "pos": "noun",
  "glosses": ["..."],
  "expansion": "optional",
  "source_shard": "optional",
  "schema_version": "v4"
}
```

### Vector Configuration

Current target:

```text
distance: cosine
dimension: 768
```

### Metadata Filtering

The service should support filters on:

```text
lang
pos
```

### Index Size / Performance Considerations

Because the dataset has millions of vectors, Qdrant configuration matters for
serving cost and latency.

Likely options to evaluate:

- scalar quantization
- on-disk vectors
- payload indexes for `lang` and `pos`
- careful selection of HNSW parameters
- limiting default `top_k`
- latency/quality benchmarking before final deployment

### Persistence

Qdrant state should be treated as a deployable artifact.

```text
build collection -> export snapshot -> upload snapshot to Blob Storage
```

The serving VM restores the snapshot and persists Qdrant state to an attached
managed disk.

---

## Stage 5: API Layer

### Framework

The API and web service will use FastAPI.

### Core API Endpoints

#### GET /health

Returns service health.

```json
{
  "status": "ok",
  "qdrant": "ok",
  "model": "loaded"
}
```

#### POST /api/search

Search endpoint for JSON clients.

Input:

```json
{
  "query": "a book listing words and their meanings",
  "top_k": 20,
  "langs": ["English"],
  "pos": ["noun"]
}
```

Output:

```json
{
  "query": "a book listing words and their meanings",
  "results": [
    {
      "word": "dictionary",
      "lang": "English",
      "pos": "noun",
      "score": 0.82,
      "glosses": ["A reference work listing words..."],
      "expansion": null
    }
  ]
}
```

### API Behavior

The server:

1. Validates the request.
2. Encodes the query using the same embedding model family.
3. Translates filters into Qdrant payload filters.
4. Queries Qdrant.
5. Returns ranked results with metadata for display.

### Stateful UI Session Layer

For the web UI, the server may maintain lightweight session state keyed by a
browser session cookie:

```json
{
  "query": "large animal with a trunk",
  "langs": ["English"],
  "pos": ["noun"],
  "last_results": [...]
}
```

---

## Stage 6: Web UI

### Implementation

The UI will be server-rendered using:

```text
FastAPI
Jinja2 templates
HTMX
plain CSS or a lightweight CSS framework
```

This avoids the complexity of a React frontend while still producing a
professional interactive search page.

### Page Layout

The public page should include:

```text
Title / project branding / author name
Search box
Results panel
Language filter panel
Part-of-speech filter panel
Selected filters panel
```

### UI Behavior

HTMX can submit searches and filter changes without full page reloads. The
server returns partial HTML fragments for updated result panels.

Example UI endpoints:

```text
GET  /
POST /ui/search
POST /ui/filters
GET  /api/search
GET  /health
```

### Presentation

Each result should show:

```text
word
language
part of speech
score
ordered gloss list
optional expansion/pronunciation/headword metadata
```

---

## Stage 7: Deployment Architecture

### Long-Running Serving Architecture

The long-running service should use one CPU VM running Docker Compose:

```text
Azure Linux VM
    qdrant container
    fastapi/web container
    caddy or nginx reverse proxy
    persistent managed disk
```

This deployment is simpler and cheaper than a managed vector database or
Kubernetes cluster while still demonstrating realistic systems engineering.

### Public Access

The service can initially be exposed through a public VM IP. A domain name can be
added later for a more professional presentation.

### Reverse Proxy

Use Caddy or Nginx in front of the FastAPI app.

Responsibilities:

- expose port 80 / 443
- reverse proxy to FastAPI
- optional HTTPS automation if a domain is used
- basic request logging

### Docker Compose Services

Expected services:

```text
qdrant
api
reverse-proxy
```

### VM Boot Behavior

The VM should be configured so the service restarts after reboot:

```text
VM boots
    -> systemd starts Docker Compose service
    -> Qdrant loads mounted storage
    -> FastAPI app starts
    -> reverse proxy exposes public service
```

### Persistent Storage

Qdrant storage should live on an attached disk, not inside the container layer.

```text
/mnt/qdrant_storage -> /qdrant/storage
```

The managed disk should be large enough for the full Qdrant collection, HNSW
index, payloads, and future reindexing margin.

---

## Stage 8: Azure Resource Plan

### Durable Artifacts

Use Azure Blob Storage for:

```text
raw Wiktionary dump
normalized JSONL shards
manifests
embedding run artifacts
Qdrant snapshots
release metadata
```

### Ephemeral Batch Compute

Use a temporary GPU VM for:

```text
embedding generation
Qdrant collection build
snapshot export
```

Delete this VM after the batch run.

### Long-Running Serving Compute

Use a CPU VM for:

```text
Qdrant serving
FastAPI web/API service
reverse proxy
```

Target serving VM options:

```text
Minimum:
  4 vCPU
  16 GB RAM
  128--256 GB SSD

Preferred:
  8 vCPU
  32 GB RAM
  256 GB SSD
```

The preferred option should only be used if latency testing justifies the added
monthly cost.

### Cost Strategy

To keep the project sustainable for a six-month public demo:

- do not keep GPU compute online
- avoid managed vector database costs for V1
- run Qdrant and FastAPI on the same CPU VM
- use Blob Storage for cold artifacts
- use a right-sized managed disk
- benchmark latency before moving to larger VM sizes

### Cost Documentation

The project documentation should include an estimated cost table with:

```text
Blob Storage
Managed Disk
Serving VM
Temporary GPU VM batch cost
Domain name, if used
```

This helps show that the architecture was designed economically rather than
overprovisioned.

---

## Stage 9: Scripted Deployment

### Goal

Deployment should be scriptable from the command line using Azure CLI, shell
scripts, and Docker Compose.

### Proposed Repo Layout

```text
infra/
  create_resource_group.sh
  create_storage.sh
  create_serving_vm.sh
  attach_disk.sh
  bootstrap_vm.sh
  open_ports.sh
  deploy_app.sh
  restore_qdrant_snapshot.sh
  teardown_serving_vm.sh

deploy/
  docker-compose.yml
  Caddyfile
  systemd/
    reverse-wiktionary.service

src/
  embeddings/
    parse_wiktionary.py
    generate_embeddings.py
  app/
    main.py
    search_service.py
    templates/
    static/
```

### Deployment Steps

1. Create or select Azure resource group.
2. Create Blob Storage account/container.
3. Upload raw and processed artifacts.
4. Create serving VM.
5. Attach and mount managed disk.
6. Install Docker and Docker Compose.
7. Clone repository or copy release bundle.
8. Pull Qdrant snapshot from Blob.
9. Restore Qdrant state.
10. Start Docker Compose.
11. Verify `/health`.
12. Point users to public IP or domain.

### Recovery Story

If the VM fails:

```text
create new VM
attach disk or restore snapshot from Blob
start Docker Compose
verify health endpoint
```

This is a strong operational story for a portfolio project.

---

## Stage 10: Monitoring and Operations

### Minimum Monitoring

V1 should include:

- `/health` endpoint
- simple request logging
- Qdrant availability check
- disk usage check
- startup logs
- deployment logs

### Useful Operational Scripts

```text
scripts/check_health.sh
scripts/show_logs.sh
scripts/backup_snapshot.sh
scripts/restart_services.sh
scripts/check_disk_usage.sh
```

### Latency Metrics

The API should eventually log:

```text
query length
top_k
filters used
embedding time
Qdrant search time
total request time
result count
```

These metrics support both debugging and the final cost/performance writeup.

---

## Design Principles

- Keep expensive compute ephemeral.
- Keep long-running serving simple and affordable.
- Store durable artifacts in Blob Storage.
- Treat Qdrant snapshots as deployable state.
- Prefer deterministic, inspectable pipelines over clever orchestration.
- Preserve metadata separately from embedding text.
- Optimize for understandable systems engineering, not maximum architectural complexity.
- Benchmark before scaling up infrastructure.

---

## Known Tradeoffs

### Grouping by Raw Record

The parser groups glosses within one raw record, not globally across all
duplicate `(lang, word, pos)` records. A true global group-by would require a
second aggregation pass or a local database. This is deferred unless duplicates
become a retrieval-quality problem.

### Technical Meanings

Specialized categories such as `en:Group theory` are retained. They may broaden
some embeddings, but they represent real meanings. Removing them would discard
one of Wiktionary's strengths.

### Embedding Text Excludes Word Metadata

This avoids noise in short definitions, but it means the vector itself is based
only on definitions. Word, language, and POS are still available as payload
metadata and display fields.

### Qdrant-on-VM Instead of Managed Vector DB

Running Qdrant on a VM increases operational responsibility but lowers cost and
better supports the systems-engineering goals of the project.

---

## Future Extensions

- Global deduplication/group-by over `(lang, word, pos)`
- Better parsing of `head_templates`
- Language-specific pronunciation display
- Topic/category metadata extraction
- Query expansion
- Reranking model
- Result caching
- Domain name + HTTPS
- API key or rate limiting
- Load testing and latency dashboard
- Alternative embedding model benchmark
- Optional Azure Container Apps deployment for API-only frontend
