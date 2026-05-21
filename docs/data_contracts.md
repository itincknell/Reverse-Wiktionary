# Serving Artifact Contracts

This repo consumes immutable artifacts produced by
`github.com/itincknell/Reverse-Wiktionary-Offline`. Blob pointers use small
`latest.json` files instead of symlinks.

## Blob Storage

```text
storage account: configured by deployment environment
container: configured by deployment environment
```

## Latest Pointer

Current schema: `v1`

```json
{
  "stage": "indexes",
  "run_id": "20260513T190800Z",
  "prefix": "indexes/20260513T190800Z",
  "manifest_path": "indexes/20260513T190800Z/manifest.json",
  "updated_at_utc": "2026-05-13T20:53:10Z"
}
```

Consumers read `manifest_path` and ignore unknown fields.

## Qdrant Index Artifact

Blob layout:

```text
indexes/<run_id>/
  manifest.json
  latest.json
  snapshots/<collection snapshot>

indexes/latest.json
```

Expected serving collection:

```text
collection_name: reverse_wiktionary_v3
model: sentence-transformers/all-mpnet-base-v2
vector_size: 768
distance: Cosine
payload indexes: lang, pos
quantization: scalar int8
original vectors: on disk
```

The web service validates collection availability through Qdrant at startup and
uses the restored collection as serving truth.

## Search Payload

Each Qdrant point exposes the fields used by the API/UI:

```json
{
  "word": "petrichor",
  "lang": "English",
  "pos": "noun",
  "glosses": [
    "The distinctive scent which accompanies the first rain after a dry spell."
  ],
  "expansion": null
}
```

Required fields:

- `word`: display headword.
- `lang`: language label used for filtering.
- `pos`: part of speech compatible with `src/common/pos.py`.
- `glosses`: ordered list of display glosses.

Optional fields:

- `expansion`: Wiktionary head-template expansion when available.

URL contract:

- Qdrant payloads do not store full Wiktionary URLs.
- The web/API layer derives result links from `word` and `lang`.
- Spaces become underscores before percent-encoding.
- Unicode is percent-encoded, not transliterated.

Examples:

```text
café / French -> https://en.wiktionary.org/wiki/caf%C3%A9#French
duo / Norwegian Bokmål -> https://en.wiktionary.org/wiki/duo#Norwegian_Bokm%C3%A5l
褂 / Chinese -> https://en.wiktionary.org/wiki/%E8%A4%82#Chinese
```

## Language Taxonomy Artifact

Blob layout:

```text
processed/<run_id>/
  serving_metadata.json
  language_taxonomy.json
  language_taxonomy_unmatched.json
  language_taxonomy_report.json

processed/latest.json
```

The web app downloads `language_taxonomy.json` and `serving_metadata.json` into:

```text
data/processed/latest/
```

`language_taxonomy.json` supplies the browse tree. Qdrant facets remain the
runtime source of truth for which language labels are present in the collection.

Important behavior:

- The visible tree may omit very small or unresolved families.
- `all_languages` includes every language label available for filter search
  and "select all" semantics.
- If the taxonomy artifact is absent, the web app falls back to a flat language
  list from Qdrant facets.

## Web Logs and Benchmarks

Web smoke and benchmark artifacts are uploaded under:

```text
logs/web_smoke/<run_id>/
  benchmark.json
  benchmark_samples.json
  web.log
```

Benchmark samples may include route, status, latency, and timing fields. They
do not include raw user query text in production logs.
