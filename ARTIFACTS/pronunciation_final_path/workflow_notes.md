# Pronunciation Final Path Workflow Notes

These notes rebuild the current outer-repo state before implementation,
testing, image build, or VM hot patch work. They are shorthand operating notes,
not final docs.

## Current Stage

- Stage: pronunciation final path planning.
- Status: open tracker created; no implementation jobs launched.
- Do not start image build, Docker deploy, Azure Run Command, restore, or other
  long-running/critical jobs until the open tracker rows that gate them are
  resolved.

## Product Policy To Implement

- If a result has both parseable IPA and a voice recording, enable only the IPA
  auto-pronunciation path.
- If a result has a recording but no parseable IPA / no eSpeak card, use the
  existing recording playback path as the alternate path.
- Do not eagerly generate or load eSpeak pronunciations during normal result
  rendering.
- eSpeak pronunciation should be lazy: click-triggered, cacheable by the web
  path/browser, and reusable after first load.
- The lazy path must load the eSpeak/meSpeak library and the individual
  language JSON needed by the clicked card from FastAPI routes that Nginx and
  the browser can cache.
- The eSpeak/meSpeak library and required voice/language JSON assets must be
  staged inside the tracked serving repo and included in the compressed Docker
  image. Runtime must not depend on ignored local subrepos.
- Additional language JSON/resources for eSpeak should also lazy-load only when
  required by a pronunciation click.
- Fetching IPA-to-meSpeak phoneme JSON is necessary but not sufficient. The
  automatic pronunciation card is not complete until it plays audible
  eSpeak/meSpeak output.
- If no automatic card and no recording are available, render IPA text only and
  no speaker button.

## Known Compatibility Gap

The exported local package currently contains:

```text
src/ipa_to_mespeak/_native.cpython-314-darwin.so
```

The production Docker image currently starts from:

```text
deploy/web/Dockerfile -> python:3.10-slim
```

Therefore the current exported native extension is not production-compatible.
Production integration needs a Linux/Python-compatible build path inside the
image or a matching wheel/artifact.

TODO: resolve this before FastAPI integration or image shipping. Preferred
candidate is a Docker builder stage that builds the `ipa_to_mespeak` wheel with
the same Python version and Linux target as the final serving image, then
installs that wheel into the runtime image. Do not rely on the local Darwin
`.so` for production.

Open decision: either keep `python:3.10-slim` and prove the extension supports
Python 3.10 with matching package metadata, or move the serving image to a
Python version supported by `ipa-to-mespeak`.

## Compressed Image Handoff Workflow

Source references:

- `docs/azure_runbook.md`
- `scripts/web/build_web_image_archive.sh`
- `scripts/web/download_web_image_archive.sh`
- `scripts/web/load_web_image_archive.sh`
- `scripts/web/deploy_prod.sh`
- `deploy/web/.env.example`

Intended shape:

```bash
scripts/web/build_web_image_archive.sh \
  --tag "$(git rev-parse --short=12 HEAD)" \
  --upload \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER"
```

On the VM:

```bash
cd /opt/reverse-wiktionary/app

scripts/web/download_web_image_archive.sh \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER" \
  --tag "<git_sha>"

scripts/web/load_web_image_archive.sh \
  --archive "/opt/reverse-wiktionary/data/restore/reverse-wiktionary-web-<git_sha>.tar.gz"
```

Then deploy with:

```text
WEB_IMAGE=reverse-wiktionary-web:<git_sha>
WEB_SKIP_BUILD=true
```

Reminder: build script writes a manifest with image ref, archive name, size,
sha256, git commit, and creation time. Download script verifies archive name and
sha256 before load.

Due diligence before upload/load:

- build from the exact committed revision intended for deployment;
- verify manifest image tag, platform, git commit, archive size, and sha256;
- verify VM env uses `WEB_IMAGE=<new-tag>` and `WEB_SKIP_BUILD=true`;
- do not let deploy/restart rebuild on the VM.

## VM Hot Patch / No Public IP Workflow

Source reference:

- `docs/azure_runbook.md`

Current policy:

- Public traffic enters through Cloudflare Tunnel.
- Qdrant, Redis, FastAPI are private.
- Nginx binds on VM localhost.
- No public IP or SSH path is required for normal beta operation.
- Azure Run Command is the operator inspection/hot-patch route.

Patch/update command shape from runbook:

```bash
az vm run-command invoke \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --command-id RunShellScript \
  --scripts 'cd /opt/reverse-wiktionary/app && git pull --ff-only origin main && ./scripts/web/restart.sh'
```

If using compressed image handoff, update the VM env first so restart/deploy uses
the loaded image and `WEB_SKIP_BUILD=true`.

## Restore / Payload Schema Workflow

Source references:

- `docs/data_contracts.md`
- `scripts/web/restore_qdrant_from_blob.sh`

Pronunciation payload fields are optional v6 search payload fields:

```text
ipa
audio_ogg_url
audio_mp3_url
```

Before claiming pronunciation support on the VM, verify the restored collection
actually has these fields in point payloads. `restore_qdrant_from_blob.sh` also
stages:

```text
data/processed/latest/language_taxonomy.json
data/processed/latest/serving_metadata.json
```

If the current deployed snapshot predates pronunciation fields, restore a newer
snapshot rather than patching only web code.

## Local Sandbox / Dummy Collection Preview

Source references:

- `deploy/web/compose.local.yml`
- `scripts/web/start_local_stack.sh`
- `scripts/web/run_local_web.sh`

Local staged collection detected:

```text
data/qdrant/storage/collections/reverse_wiktionary_test
```

Default scripts use `reverse_wiktionary_v3`, so local preview must override:

```bash
COLLECTION_NAME=reverse_wiktionary_test ./scripts/web/start_local_stack.sh
```

or direct uvicorn path with local Qdrant/Redis:

```bash
COLLECTION_NAME=reverse_wiktionary_test ./scripts/web/run_local_web.sh
```

Do not assume local `reverse_wiktionary_v3` exists.

## UI Work Items

- Desktop-only List/Tree toggle for language filters.
- Toggle should be a text/link-style control, not a card.
- Tree remains the current/default display.
- Flat mode should show language list sorted by row count descending.
- Flat mode should hide languages under 100 rows.
- Search dropdown remains a tree on desktop and mobile.
- Increase mobile search dropdown vertical height.
- Bottom-align IPA display with the result word on result cards.

## Tests To Review / Extend Before Critical Jobs

Likely target files:

- `tests/search/test_schemas.py`
- `tests/search/test_qdrant_search.py`
- `tests/web/test_app.py`
- `tests/web/static/test_search_ui.js`
- `tests/web/static/test_language_filters.js`

Expected coverage additions:

- result schema supports optional eSpeak/auto pronunciation metadata once
  integration shape is decided.
- result rendering chooses eSpeak card for parseable IPA, recording-only path
  for recording without eSpeak card, and no empty pronunciation UI otherwise.
- JS lazy-load path handles eSpeak and recording sources without eager loading.
- desktop List/Tree toggle changes desktop filter presentation only.
- mobile search dropdown remains tree and gets increased height.
- extension import/build mismatch is handled explicitly until production build
  path is resolved.

## Missing / Do Not Guess

- Exact production Python version if we decide to build `ipa_to_mespeak` in the
  web image instead of preserving Python 3.10.
- Exact eSpeak/meSpeak asset source paths to vendor into this serving repo for
  the browser library and voice JSON files.
- Exact eSpeak/meSpeak client API needed to synthesize/play the phoneme payload
  after lazy asset load.
- Whether pronunciation auto-generation should be part of stable `/api/v1/search`
  response or UI-only metadata.
- Current VM env values for `WEB_IMAGE`, `WEB_SKIP_BUILD`,
  `COMPOSE_PROFILES`, and Cloudflare token status.
- Whether the currently deployed Qdrant snapshot already has pronunciation
  payload fields.

## Deployment Order Guardrail

Use this order for the final patch:

1. commit code/assets;
2. build compressed image archive from that commit;
3. upload archive and manifest to Blob;
4. update VM repo with `git pull`;
5. download and checksum-verify the archive on the VM;
6. load the image with Docker;
7. set `WEB_IMAGE` to the loaded tag and `WEB_SKIP_BUILD=true`;
8. restart/deploy with no build;
9. run health, search, pronunciation, and cache smoke checks.

## Patch Progress - Pronunciation Runtime Assets and Playback

- Staged meSpeak 2.0.2 browser runtime, config, and canonical voice JSON assets under `src/web/static/vendor/mespeak`.
- Added allowlisted FastAPI pronunciation asset routes and Nginx pronunciation cache paths.
- Added browser lazy-load playback path: runtime script, config JSON, voice JSON, IPA payload, then `meSpeak.speak` with phoneme input.
- Added focused tests for asset routes, IPA-only fallback, auto-playback caching, language search clear, and List/Tree toggle isolation.

## Patch Progress - Image and Local Preview Verification

- Recovered Docker Desktop after BuildKit stalled while host disk was full.
- Removed an ignored uncompressed raw JSONL export and pruned BuildKit cache; volumes were left intact.
- Corrected the web image build to install CPU-only Torch before resolving `sentence-transformers`; the previous unpinned path attempted to pull CUDA packages.
- Built `reverse-wiktionary-web:pronunciation-local` for `linux/amd64`.
- Verified the runtime image contains the staged meSpeak assets, installed `ipa_to_mespeak`, CPU Torch, and a cached default mpnet model; the final image does not contain Rust builder tools.
- Verified the default production model cache loads offline with `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`.
- Verified local preview against `reverse_wiktionary_test` after aligning local defaults to the 384-dimensional MiniLM model used by that staged dummy collection.
