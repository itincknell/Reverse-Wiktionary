# Web Serving Status

This file tracks the serving phase. Architecture details live in
`docs/design_web_serving.md`.

## Serving Baseline

```text
repository role: online serving/deployment only
offline producer: https://github.com/itincknell/Reverse-Wiktionary-Offline
reverse proxy: Nginx
web server: FastAPI/Uvicorn
session state: Redis with TTL
pagination: Load more button
language source: taxonomy artifact when staged, Qdrant facet fallback
payload indexes: lang and pos keyword indexes in the serving snapshot
pronunciation fields: optional IPA and Wikimedia audio URLs in v6 payloads
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
- Optional pronunciation display fields in search results, with lazy recording
  playback through a validated FastAPI endpoint and Nginx-managed cache.
- Native IPA-to-meSpeak parsing for supported IPA strings, exposed as a
  cacheable phoneme payload endpoint.

## Retrieval Policy

```text
no filters: hnsw_ef configurable, beta default 512
language or POS filters: hnsw_ef + ACORN max_selectivity=1.0
diagnostic override: SEARCH_EXACT_FILTERED=true
serving collection: scalar int8 quantization, original vectors on disk
```

Live evaluation selected ACORN for filtered retrieval quality. Scalar int8
quantization preserved manual retrieval quality while reducing Qdrant memory
enough to test 8 GiB hosts.

## Sizing Direction

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

The current v3 offline artifact set uses 768-dimensional embeddings and scalar
int8 quantization before snapshotting. This is the quality target for beta
serving.

The checked-in local preview fixture is `reverse_wiktionary_test`, a compact
384-dimensional collection. Local compose and direct-uvicorn scripts default to
the matching MiniLM encoder for that fixture; production defaults remain on the
mpnet artifact set.

Current Compose files use `qdrant/qdrant:latest`. During the serving review,
local Docker reported Qdrant 1.17.1 and the Azure beta VM reported Qdrant
1.18.0. Pin or centralize the Qdrant image only if this drift becomes
operationally relevant.

## Operational Checks

```text
/health returns ok
/api/v1/search returns results
language and POS filters return expected subsets
Load more returns the next page
Qdrant reports payload indexes for lang and pos
benchmark artifacts upload to logs/web_smoke/<run_id>/
recording audio is not requested until a user clicks playback
IPA-to-meSpeak phoneme payloads are requested only when a user clicks automatic
  pronunciation
meSpeak runtime/config/voice assets are lazy-loaded from local app routes and
  cached by the browser/Nginx path
audio-cache accepts only Wikimedia upload URLs
Qdrant, Redis, and FastAPI remain private to Docker/internal networking
Nginx binds to localhost on the VM
Public web access uses Cloudflare Tunnel; Azure does not need inbound 80/443
```

Browser-side meSpeak synthesis is implemented for supported automatic
pronunciation rows using staged local runtime assets.
