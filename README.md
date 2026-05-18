# Reverse Wiktionary

Reverse Wiktionary is a semantic lexical search app. This repository contains
the online serving layer: FastAPI, Qdrant query integration, Redis-backed UI
state, Docker/Nginx deployment files, and Azure beta deployment scripts.

Offline artifact production lives in:

```text
github.com/itincknell/Reverse-Wiktionary-Offline
```

## Execution Boundary

```text
offline repo:
  Wiktionary/Kaikki dump
  -> normalized rows
  -> embeddings
  -> Qdrant collection
  -> payload indexes and quantization
  -> deployable Qdrant snapshot + taxonomy artifacts

this repo:
  deployable snapshot + taxonomy artifacts
  -> serving VM
  -> Qdrant + Redis + FastAPI + Nginx
  -> public search UI/API
```

## Current Serving Baseline

```text
collection_name: reverse_wiktionary_v2
current model: sentence-transformers/distiluse-base-multilingual-cased-v2
current vector_size: 512
indexed points: 3,869,247
filtered retrieval: Qdrant ACORN
compression: scalar int8 quantization, original vectors on disk
```

This v2 artifact shape is intended to fit a smaller, cheaper serving VM than
the original 768-dimensional collection.

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
