# Web Serving Design

The web service serves natural-language reverse dictionary queries against the
production Qdrant collection built by the offline indexing pipeline.

## Architecture

```text
Azure Blob Qdrant snapshot
  -> serving VM restore
  -> Qdrant container
  -> FastAPI search/web service
  -> Nginx reverse proxy
  -> public UI and stable API
```

The serving stack does not own preprocessing, embedding generation, or index
construction. It restores or connects to an existing collection and serves
ranked lexical results.

## Locked Decisions

```text
reverse proxy: Nginx
server model: multiple sync FastAPI workers
model placement: one SentenceTransformer model copy per worker
session state: Redis with TTL
result navigation: Load more button
language list: fetched from Qdrant once at startup
payload indexes: created offline before serving deployment
production storage: stable host paths under /mnt/reverse-wiktionary
API stability: public stable v1 API
```

The query layer is replicated inside each FastAPI worker. There is no central
query queue. Each worker owns its model instance, Qdrant client, Redis client,
and search service objects.

## Source Layout

```text
src/search/        Qdrant query client and search orchestration.
src/web/           FastAPI app, request models, templates, static assets.
deploy/web/        Web Dockerfile, compose files, Nginx config.
scripts/web/       Restore, deploy, health check, and smoke-test scripts.
scripts/qdrant/    Payload-index creation and verification scripts.
```

`src/search/` owns Qdrant read/query behavior. `src/embeddings/` owns
preprocessing, embedding generation, and index construction.

## Stable API

```text
POST /api/v1/search
```

Request:

```json
{
  "query": "a book listing words and their meanings",
  "langs": [],
  "pos": [],
  "limit": 25,
  "offset": 0
}
```

Response:

```json
{
  "query": "a book listing words and their meanings",
  "filters": {
    "langs": [],
    "pos": []
  },
  "limit": 25,
  "offset": 0,
  "has_more": true,
  "timing_ms": {
    "embedding": 12.4,
    "qdrant": 31.8,
    "total": 47.2
  },
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

Validation:

```text
query: required, trimmed, bounded string
langs: optional list; empty means all languages
pos: optional list; empty means all POS
limit: default 25, max 100
offset: default 0, non-negative
```

Filter semantics:

```text
multiple languages: OR
multiple POS values: OR
language filter AND POS filter
no deduplication
no grouping
no reranking
```

## Web Routes

```text
GET  /
POST /ui/search
POST /ui/search/more
GET  /health
```

`/ui/*` routes are implementation routes for the HTMX/Jinja UI. The stable
programmatic contract is `/api/v1/search`.

## Query Path

```text
request
  -> validate query/limit/offset/filters
  -> encode query text
  -> build Qdrant filter
  -> search Qdrant
  -> normalize response payloads
  -> return JSON or render HTML partial
```

The web service uses the same embedding model family as the offline pipeline:

```text
sentence-transformers/all-mpnet-base-v2
```

## UI

UI stack:

```text
FastAPI
Jinja2
HTMX
plain CSS
```

UI behavior:

```text
default languages: all
default POS: all
initial page: no results
search execution: explicit Search button only
pagination: Load more button
gloss display: first three glosses, show-more toggle for the rest
expansion display: hidden by default, toggle when present
```

Result cards show:

```text
word
language
part of speech
glosses
expansion
```

Scores are included in the API response and hidden in the normal UI.

The language selector is a custom searchable multi-select populated from the
Qdrant startup language cache. The POS selector uses the shared vocabulary from
`src/common/lexical_schema.py`.

## Session State

Redis stores per-client UI state across multiple FastAPI workers.

```text
key: rw:session:<session_uuid>
ttl: 86400 seconds
```

Stored fields:

```text
selected_langs
selected_pos
latest_query
limit
next_offset
created_at_utc
updated_at_utc
```

Result bodies are not stored in Redis. "Load more" reruns the latest
query/filter state with the next offset.

## Deployment

Serving target:

```text
single Azure Linux VM
Docker Compose
Qdrant container
Redis container
FastAPI/web container
Nginx reverse proxy
managed disk for Qdrant storage
```

Initial FastAPI worker count:

```text
2 sync workers
```

Worker count is a hardware and memory tuning decision because each worker loads
its own model copy.

Production host paths:

```text
/opt/reverse-wiktionary/app
/mnt/reverse-wiktionary/qdrant/storage
/mnt/reverse-wiktionary/redis/data
/mnt/reverse-wiktionary/logs
/mnt/reverse-wiktionary/snapshots
```

Production Qdrant storage must not live under the application repository.

## Restore Flow

```text
read indexes/latest.json
download indexes/<run_id>/manifest.json
download snapshot from indexes/<run_id>/snapshots/
restore Qdrant collection
verify lang and pos payload indexes
start web service
verify /health
```

Serving snapshots should be prepared offline with payload indexes on:

```text
lang: keyword
pos: keyword
```

## Health Checks

`GET /health` reports:

```json
{
  "status": "ok",
  "qdrant": "ok",
  "redis": "ok",
  "collection": "reverse_wiktionary_v1",
  "model": "loaded",
  "vector_size": 768,
  "available_langs": 0,
  "available_pos": 9
}
```

The endpoint returns non-200 when Qdrant, Redis, model loading, or the
collection check fails.

## Metrics

Per-search logs:

```text
query_length
langs_count
pos_count
limit
offset
embedding_ms
qdrant_ms
total_ms
result_count
has_more
```

Do not log full query text by default.

## Implementation TODO

```text
1. Shared lexical constants.
2. Offline payload-index scripts.
3. Serving-ready snapshot flow.
4. src/search core.
5. Stable POST /api/v1/search.
6. Redis-backed web session state.
7. GET /health.
8. Jinja/HTMX UI.
9. Load-more pagination.
10. Production Compose with Nginx, web, Redis, and Qdrant.
```

## Deferred Work

- Rate limiting.
- Result caching.
- Query expansion or reranking.
- Automatic infinite scroll.
- Load testing dashboard.
