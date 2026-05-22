# Repository Layout

This repository contains the online serving and deployment code for Reverse
Wiktionary. Offline parsing, embedding generation, taxonomy construction, and
Qdrant snapshot creation live in
[Reverse-Wiktionary-Offline](https://github.com/itincknell/Reverse-Wiktionary-Offline).

Test coverage and validation harnesses live in
[Reverse-Wiktionary-Test-Suite](https://github.com/itincknell/Reverse-Wiktionary-Test-Suite).
Any local `tests/` directory in this repo is staging-only and ignored by git.

## Layout

```text
src/web/          FastAPI app, templates, static assets, session state.
src/search/       Query encoding, API schemas, Qdrant filters, search client.
src/common/       Small runtime constants/helpers shared by web/search code.
deploy/web/       Docker Compose, web Dockerfile, Nginx config.
deploy/compose/   Local Qdrant Compose helper.
scripts/web/      Local/prod serving operations, image archives, smoke checks,
                  benchmarks.
scripts/azure/    Azure VM bootstrap and remote web smoke entrypoints.
scripts/qdrant/   Serving-side Qdrant verification/tuning helpers.
docs/             Serving architecture, artifact contracts, runbooks.
```

## Boundary

This repo consumes deployable artifacts produced by the offline repo:

```text
indexes/<run_id>/...
indexes/latest.json
processed/<run_id>/language_taxonomy.json
processed/<run_id>/serving_metadata.json
processed/latest.json
```

It does not parse Wiktionary dumps, generate embeddings, or create production
Qdrant snapshots.
