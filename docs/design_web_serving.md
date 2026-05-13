# Web Serving Design

The web service will serve natural-language reverse dictionary queries against
the production Qdrant snapshot built by the offline indexing pipeline.

## Architecture

```text
Azure Blob Qdrant snapshot
  -> serving VM restore
  -> Qdrant container
  -> search service
  -> FastAPI web/API service
  -> reverse proxy
  -> public UI
```

## Serving Responsibilities

The serving stack owns:

- restoring the selected Qdrant snapshot
- loading the query embedding model
- validating search requests
- applying language and part-of-speech filters
- querying Qdrant
- returning ranked lexical results
- exposing health and operational checks

The serving stack does not own preprocessing, embedding generation, or index
construction.

## Source Layout

```text
src/search/        Qdrant query client and search orchestration.
src/web/           FastAPI app, request models, templates, static assets.
deploy/web/        Web Dockerfile, compose files, reverse proxy config.
scripts/web/       Restore, deploy, health check, and smoke-test scripts.
```

`src/search/` is independent of `src/embeddings/`. Embedding code writes the
index; search code reads it.

## API Surface

```text
GET  /health
POST /api/search
GET  /
POST /ui/search
POST /ui/filters
```

`POST /api/search` request:

```json
{
  "query": "a book listing words and their meanings",
  "top_k": 20,
  "langs": ["English"],
  "pos": ["noun"]
}
```

Response:

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

## Query Path

```text
request
  -> validate query/top_k/filters
  -> encode query text
  -> build Qdrant filter
  -> search Qdrant
  -> normalize response payloads
  -> render JSON or HTML partial
```

The web API uses the same embedding model family as the offline pipeline:

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

Primary page elements:

```text
search input
language filter
part-of-speech filter
ranked results
result metadata
```

Result fields:

```text
word
language
part of speech
score
glosses
expansion
```

## Deployment

Serving target:

```text
single Azure Linux VM
Docker Compose
Qdrant container
FastAPI/web container
Caddy or Nginx reverse proxy
managed disk for Qdrant storage
```

The serving VM is CPU-only unless latency testing proves otherwise.

Target VM profile:

```text
baseline: 4 vCPU, 16 GB RAM
preferred if needed: 8 vCPU, 32 GB RAM
disk: enough for restored Qdrant storage plus reindexing margin
```

## Restore Flow

```text
read indexes/latest.json
download indexes/<run_id>/manifest.json
download snapshot from indexes/<run_id>/snapshots/
restore Qdrant collection
start web service
verify /health
```

## Health Checks

`GET /health` reports:

```json
{
  "status": "ok",
  "qdrant": "ok",
  "model": "loaded"
}
```

Operational scripts:

```text
restore snapshot
start service
stop service
show logs
health check
disk usage
```

## Metrics

API logs:

```text
query_length
top_k
filters
embedding_ms
qdrant_ms
total_ms
result_count
```

These metrics will drive VM sizing and the final cost/performance writeup.

## Deferred Work

- Domain and HTTPS.
- Rate limiting.
- Result caching.
- Payload indexes for common filters.
- Query expansion or reranking.
- Load testing dashboard.
