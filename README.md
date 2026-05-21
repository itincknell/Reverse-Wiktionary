# Reverse Wiktionary

Reverse Wiktionary is a semantic lexical search app. This repository contains
the online serving layer: FastAPI, Qdrant query integration, Redis-backed UI
state, Docker/Nginx deployment files, and Azure beta deployment scripts.

Offline artifact production lives in
[Reverse-Wiktionary-Offline](https://github.com/itincknell/Reverse-Wiktionary-Offline).

Test coverage and validation harnesses live in
[Reverse-Wiktionary-Test-Suite](https://github.com/itincknell/Reverse-Wiktionary-Test-Suite).

## Execution Boundary

```text
Reverse-Wiktionary-Offline
  Wiktionary/Kaikki dump
    -> normalized lexical rows
    -> sentence-transformer embeddings
    -> indexed and quantized Qdrant collection
    -> deployable artifacts

artifact handoff
  Qdrant snapshot
  taxonomy files
  manifest metadata

Reverse-Wiktionary
  deploy artifacts to serving VM
    -> Qdrant restores the search index
    -> FastAPI serves search and templates
    -> Redis stores lightweight UI state
    -> Nginx fronts the beta web service
```

## Current Serving Baseline

```text
collection_name: reverse_wiktionary_v3
current model: sentence-transformers/all-mpnet-base-v2
current vector_size: 768
indexed points: 3,869,247
filtered retrieval: Qdrant ACORN
compression: scalar int8 quantization, original vectors on disk
```

This v3 artifact restores the 768-dimensional embedding model after the
512-dimensional beta artifact did not meet filtered retrieval quality
requirements.

## Design Documents

- [Web Serving Design](docs/design_web_serving.md)
- [Serving Artifact Contracts](docs/data_contracts.md)
- [Azure Runbook](docs/azure_runbook.md)
- [Repository Layout](docs/repo_layout.md)
- [Web Serving Status](docs/web_serving_status.md)

## Principles

- Treat Qdrant snapshots as the deployable contract.
- Keep serving independent from offline indexing.
- Keep Qdrant and Redis private to the VM/container network.
- Prefer explicit manifests and smoke tests over implicit state.
- Benchmark before changing VM size or retrieval settings.
