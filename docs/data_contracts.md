# Serving Artifact Contracts

This repo consumes immutable artifacts produced by
[Reverse-Wiktionary-Offline](https://github.com/itincknell/Reverse-Wiktionary-Offline).
Blob pointers use small `latest.json` files instead of symlinks.

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
collection_name: reverse_wiktionary_v5
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

Each Qdrant point exposes the fields used by the API/UI. The current processed
row schema is `v6`:

```json
{
  "word": "petrichor",
  "lang": "English",
  "pos": "noun",
  "glosses": [
    "The distinctive scent which accompanies the first rain after a dry spell."
  ],
  "expansion": null,
  "ipa": "/ˈpɛt.rɪ.kɔːr/",
  "audio_ogg_url": "https://upload.wikimedia.org/wikipedia/commons/example.ogg",
  "audio_mp3_url": "https://upload.wikimedia.org/wikipedia/commons/transcoded/example.ogg/example.ogg.mp3"
}
```

Required fields:

- `word`: display headword.
- `lang`: language label used for filtering.
- `pos`: part of speech compatible with `src/common/pos.py`.
- `glosses`: ordered list of display glosses.

Optional fields:

- `expansion`: Wiktionary head-template expansion when available.
- `ipa`: first non-empty IPA value from the raw Wiktextract `sounds` list.
- `audio_ogg_url`: first non-empty Ogg audio URL from the raw `sounds` list.
- `audio_mp3_url`: first non-empty MP3 audio URL from the raw `sounds` list.

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

Pronunciation audio contract:

- Audio payload fields store source URLs only, not audio bytes.
- The serving app accepts only HTTPS URLs on `upload.wikimedia.org`.
- Browser playback uses the app audio endpoint so Nginx can cache successful
  responses.
- Pronunciation fields are display metadata and are not included in
  `embedding_text`.
- The serving app may derive an `auto_pronunciation` UI field from `ipa` when
  the native IPA-to-meSpeak transducer supports the language and IPA string.
  This derived field is not stored in Qdrant.
- `/api/ipa-pronunciation` returns a cacheable JSON phoneme payload for one
  supported voice and IPA string. It also returns the browser playback voice id.
  It does not return audio bytes.
- `/api/pronunciation-assets/*` serves the local meSpeak runtime, config, and
  allowlisted voice JSON assets used by automatic pronunciation playback.

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

`language_taxonomy.json` supplies the browse tree and the flat language universe
used by the web filters. If the taxonomy artifact is absent, the web app falls
back to a flat language list from Qdrant facets.

Minimal taxonomy shape:

```json
{
  "tree": [
    {
      "family": "Indo-European",
      "rows": 123,
      "branches": [
        {
          "branch": "Germanic",
          "rows": 123,
          "languages": [
            {
              "label": "English",
              "rows": 123,
              "selectable": true
            }
          ]
        }
      ]
    }
  ],
  "all_languages": [
    {
      "label": "English",
      "rows": 123,
      "family": "Indo-European",
      "branch": "Germanic",
      "selectable": true
    }
  ]
}
```

The flat language key may be `all_languages` or `languages`; `all_languages` is
preferred for current artifacts.

Important behavior:

- The visible tree may omit very small or unresolved families.
- Selectable `all_languages` records define the search dropdown, "select all"
  semantics, and submitted language filters.
- Records with `selectable=false` are retained for review/audit artifacts but
  are excluded from browse, search, select-all, and submitted filter behavior.
- Tree-only selectable languages are merged into the flat filter universe.

`serving_metadata.json` supplies lightweight runtime counts for UI filter
availability. The web app currently reads POS availability from either shape:

```json
{
  "pos": [
    {"pos": "noun", "rows": 2141397},
    {"pos": "verb", "rows": 531359}
  ]
}
```

```json
{
  "pos_counts": {
    "noun": 2141397,
    "verb": 531359
  }
}
```

Only positive row counts narrow the visible POS list. If POS metadata is absent
or empty, the UI falls back to the shared POS allowlist.

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
