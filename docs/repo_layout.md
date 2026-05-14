# Repository Layout

Current shape:

```text
src/common/        Shared file, manifest, logging, and run-id helpers.
src/embeddings/    Offline data preparation, embedding, Qdrant indexing code.
scripts/           Local operational scripts.
scripts/azure/     Azure VM bootstrap and remote execution scripts.
scripts/qdrant/    Qdrant index management scripts.
deploy/compose/    Local/runtime service compose files.
docs/              Data contracts and operational runbooks.
runs/              Small committed run records and metadata bundles.
data/              Local generated data; ignored by git.
```

## Web Deployment Additions

Add serving code beside the embedding pipeline:

```text
src/web/           API/server entrypoint, request models, search handlers.
src/search/        Qdrant client/query code shared by API and CLI checks.
deploy/web/        Web app Dockerfile, app service/container deployment files.
scripts/web/       Web deployment and smoke-test scripts.
```

`src/search/` should own Qdrant read/query behavior. `src/embeddings/` should
remain focused on preprocessing, embedding generation, and index construction.

## Defer

- Monorepo-style `apps/` split.
- Moving `scripts/azure/` into `deploy/`.
- Packaging the offline pipeline as a separate installable distribution.
