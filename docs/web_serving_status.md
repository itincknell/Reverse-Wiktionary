# Web Serving Status

This file tracks the serving phase. Architecture details live in
`docs/design_web_serving.md`.

## Decisions

```text
repository role: online serving/deployment only
offline producer: github.com/itincknell/Reverse-Wiktionary-Offline
reverse proxy: Nginx
web server: FastAPI/Uvicorn
session state: Redis with TTL
pagination: Load more button
language source: Qdrant facet at startup, taxonomy artifact when available
payload indexes: lang and pos keyword indexes in the serving snapshot
filtered retrieval: Qdrant ACORN, max_selectivity=1.0
serving memory: scalar int8 quantization with original vectors on disk
storage root: /opt/reverse-wiktionary/data
API: stable public /api/v1/search
public edge: Cloudflare Tunnel in front of Nginx
```

## Implemented

- Search package under `src/search/` for request models, filter construction,
  query encoding, Qdrant search, and timing.
- Web package under `src/web/` for FastAPI routes, Redis session state, Jinja
  templates, static assets, and health checks.
- Runtime taxonomy loader for offline-produced taxonomy artifacts.
- Docker/Nginx/Redis/Qdrant serving scaffolding under `deploy/web/`.
- Web smoke and benchmark scripts under `scripts/web/` and `scripts/azure/`.
- Nginx production config with request body limit, proxy timeouts, security
  headers, and modest per-IP request limiting.
- Production Compose config with Docker-internal Qdrant/Redis/FastAPI,
  localhost-only Nginx, and optional Cloudflare Tunnel profile.

## Current Retrieval Policy

```text
no filters: hnsw_ef configurable, beta default 64
language or POS filters: hnsw_ef + ACORN max_selectivity=1.0
diagnostic override: SEARCH_EXACT_FILTERED=true
serving collection: scalar int8 quantization, original vectors on disk
```

Live evaluation showed that ACORN restored filtered-search quality without
application-side post-filtering. Scalar int8 quantization preserved manual
retrieval quality while reducing Qdrant memory enough to test 8 GiB hosts.

## Current Sizing Direction

Preferred low-cost beta target:

```text
region: northcentralus
vm: Standard_B2as_v2
cpu: 2 burstable vCPU
ram: 8 GiB
disk: 64 GiB Standard SSD OS disk
data disk: none
estimated cost: about $60/mo
```

The next offline artifact set is expected to use 512-dimensional embeddings and
scalar int8 quantization before snapshotting.

## Operational Checks

```text
/health returns ok
/api/v1/search returns results
language and POS filters return expected subsets
Load more returns the next page
Qdrant reports payload indexes for lang and pos
benchmark artifacts upload to logs/web_smoke/<run_id>/
Redis and Qdrant are bound to localhost/internal Docker networking only
Public web access uses Cloudflare Tunnel; Azure does not need inbound 80/443
```
