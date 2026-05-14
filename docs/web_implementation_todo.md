# Web Implementation TODO

This is the locked implementation plan for the serving phase.

## Decisions

```text
reverse proxy: Nginx
server model: multiple sync FastAPI workers
model placement: one SentenceTransformer model copy per worker
session state: Redis with TTL
pagination: Load more button
language source: fetch from Qdrant at startup
payload indexes: create offline before serving deployment
storage: stable host paths under /mnt/reverse-wiktionary
API: stable public /api/v1/search
```

## Offline Preparation

1. Shared lexical constants
   - Keep allowed POS values in `src/common/lexical_schema.py`.
   - Import the shared vocabulary from preprocessing and serving code.

2. Processed serving metadata
   - Preprocessing writes `serving_metadata.json` into each processed run.
   - Metadata includes language values and POS counts.
   - Blob upload includes this artifact with the processed run.

3. Payload index scripts
   - `scripts/qdrant/create_payload_indexes.sh`
   - `scripts/qdrant/check_payload_indexes.sh`
   - Required indexes:
     - `lang: keyword`
     - `pos: keyword`

4. Serving-ready snapshot
   - Restore the production Qdrant snapshot.
   - Create and verify payload indexes.
   - Create a new snapshot after payload indexes exist.
   - Upload the serving-ready snapshot and manifest to Blob Storage.

## Search Package

Status: initial implementation added.

1. Add `src/search/schemas.py`
   - Stable API request/response models.
   - Result model with `word`, `lang`, `pos`, `score`, `glosses`, and
     optional `expansion`.

2. Add `src/search/encoder.py`
   - Load `sentence-transformers/all-mpnet-base-v2`.
   - Load once per worker process.
   - Expose query encoding and model readiness.

3. Add `src/search/filters.py`
   - Empty language list means all languages.
   - Empty POS list means all POS.
   - OR within language values.
   - OR within POS values.
   - AND across filter fields.

4. Add `src/search/qdrant_search.py`
   - Own Qdrant client operations.
   - Verify collection existence.
   - Fetch available languages at startup.
   - Execute vector search with `limit` and `offset`.
   - Normalize Qdrant hits into stable result objects.

5. Add `src/search/service.py`
   - Own orchestration and timing metrics.
   - Routes call this service rather than calling Qdrant or the model directly.

## Web Package

Status: initial implementation added.

1. Add `src/web/config.py`
   - Environment-driven settings:
     - `COLLECTION_NAME`
     - `MODEL_NAME`
     - `QDRANT_URL`
     - `REDIS_URL`
     - `DEFAULT_LIMIT`
     - `MAX_LIMIT`
     - `SESSION_TTL_SECONDS`

2. Add `src/web/state.py`
   - Redis key: `rw:session:<session_uuid>`.
   - TTL: `86400` seconds.
   - Store selected filters, latest query, limit, and next offset.
   - Do not store full result bodies.

3. Add `src/web/app.py`
   - Startup:
     - load model in each worker
     - connect to Qdrant
     - verify collection
     - fetch language list from Qdrant
     - connect to Redis
   - Routes:
     - `GET /health`
     - `POST /api/v1/search`
     - `GET /`
     - `POST /ui/search`
     - `POST /ui/search/more`

4. Add templates and static assets
   - `src/web/templates/base.html`
   - `src/web/templates/index.html`
   - `src/web/templates/partials/results.html`
   - `src/web/templates/partials/result_card.html`
   - `src/web/templates/partials/filters.html`
   - `src/web/static/style.css`

## API Contract

`POST /api/v1/search` request:

```json
{
  "query": "a word for remembering the past fondly",
  "langs": [],
  "pos": [],
  "limit": 25,
  "offset": 0
}
```

Response includes:

```text
query
filters
limit
offset
has_more
timing_ms
results
```

Validation:

```text
query: required, trimmed, bounded string
langs: optional list; empty means all
pos: optional list; empty means all
limit: default 25, max 100
offset: default 0, non-negative
```

## UI Behavior

```text
default languages: all
default POS: all
initial page: no results
search execution: explicit Search button only
pagination: Load more button
score visibility: hidden in UI, present in API
```

Result cards:

```text
word
language
part of speech
first three glosses
show-more glosses toggle
expansion toggle when present
```

## Deployment

Status: initial Docker/Nginx scaffolding added. Snapshot restore and domain TLS
configuration remain future work.

Production services:

```text
nginx
web
qdrant
redis
```

Production host paths:

```text
/opt/reverse-wiktionary/app
/mnt/reverse-wiktionary/qdrant/storage
/mnt/reverse-wiktionary/redis/data
/mnt/reverse-wiktionary/logs
/mnt/reverse-wiktionary/snapshots
```

Production Qdrant storage must never live under the app repository.

## Smoke Tests

Status: local health and API smoke scripts added.

Add scripts:

```text
scripts/web/prepare_prod_dirs.sh
scripts/web/deploy_prod.sh
scripts/web/start_local_stack.sh
scripts/web/stop_local_stack.sh
scripts/web/smoke_health.sh
scripts/web/smoke_api_search.sh
scripts/web/status.sh
scripts/web/logs.sh
scripts/web/restart.sh
scripts/web/disk_usage.sh
```

Minimum acceptance:

```text
/health returns ok
/api/v1/search returns results
language and POS filters work
Load more returns the next page
payload indexes are verified
```
