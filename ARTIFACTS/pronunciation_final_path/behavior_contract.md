# Pronunciation and Layout Behavior Contract

This file is the active guardrail for the pronunciation final path. Do not
advance to image build, VM patch, or final deployment while any required item
below is open or unverified in `issue_tracker.tsv`.

## Pronunciation Card Priority

Required result-card behavior:

1. If an eSpeak/meSpeak automatic pronunciation card is available, show only
   that card/button for pronunciation playback.
2. If no eSpeak/meSpeak card is available and a Wikimedia recording exists,
   show the existing recording playback button.
3. If neither eSpeak/meSpeak playback nor a recording exists, show IPA text
   only when present and show no speaker/play button.

Current implementation status:

- Result metadata can identify parseable IPA via `auto_pronunciation`.
- Template priority currently suppresses recording buttons when
  `auto_pronunciation` exists.
- Recording fallback remains lazy and cache-backed through `/api/audio-cache`.
- Automatic pronunciation currently fetches phoneme JSON only; it does not yet
  synthesize or play audio. This is not sufficient for final behavior.

## Required Lazy eSpeak/meSpeak Runtime Path

The final automatic pronunciation click path must:

1. Lazy-load the eSpeak/meSpeak browser library from FastAPI, cacheable by
   Nginx/browser.
2. Lazy-load only the individual voice/language JSON required by the clicked
   card, also served from FastAPI and cacheable by Nginx/browser.
3. Fetch or reuse the IPA-to-meSpeak phoneme payload for the clicked IPA.
4. Use the loaded library, voice JSON, and phoneme payload to play audible
   automatic pronunciation.
5. Keep the existing Wikimedia recording path unchanged for recording-only
   results.

Do not treat `/api/ipa-pronunciation` phoneme JSON alone as complete eSpeak
playback.

## Required Runtime Asset Staging

The eSpeak/meSpeak browser library and required voice/language JSON assets must
be staged inside the tracked serving repo so the compressed Docker image carries
them to the VM with this patch.

Required asset behavior:

1. Do not rely on the ignored `ipa-to-mespeak/` research subrepo at runtime.
2. Stage only the runtime assets needed for browser playback and supported
   voices.
3. Place assets under a tracked path included in the Docker build context.
4. Add tests or build checks proving the assets are present in the serving image
   path used by FastAPI.
5. FastAPI routes must serve these staged assets with cache headers suitable
   for Nginx/browser caching.

## Layout Requirements

Required layout behavior:

1. Desktop-only language List/Tree toggle.
2. Toggle is a text/link style control.
3. Tree is the default display.
4. Flat list is sorted by row count descending.
5. Flat list hides languages under 100 rows.
6. Search dropdown behavior remains tree-based on desktop and mobile.
7. List/Tree toggle must not affect language-search dropdown behavior.
8. Mobile language search dropdown height is increased.
9. Clearing the search box with the built-in search-field clear control must
   dismiss the language-search dropdown.
10. IPA display text bottom-aligns with the word on result cards.

## Advancement Gates

- No compressed image build until the eSpeak/meSpeak runtime path is either
  implemented and tested or explicitly removed from the release scope by user
  decision.
- No VM patch until payload availability is verified for the target collection
  and local/static tests pass.
- No tracker item may be marked resolved unless the acceptance note names the
  file/test/evidence that supports the status.

## Deployment Due Diligence Gates

Before deployment:

1. Staged eSpeak/meSpeak assets must be versioned with app code and included in
   the Docker context.
2. Browser automatic-pronunciation click path must produce audible playback,
   not only phoneme JSON.
3. Cache headers must be verified for runtime assets, voice JSON,
   IPA-pronunciation payloads, and existing Wikimedia recording cache.
4. New runtime assets should be served locally by FastAPI/Nginx; do not add a
   runtime dependency on public CDNs for automatic pronunciation playback.
5. Target processed/index artifacts must be verified to contain pronunciation
   payload fields before UI claims are made against the VM.
6. Unsupported IPA, missing native extension, and missing assets must fall back
   cleanly to recording-only or IPA-only rendering without empty controls.
7. Local preview collection and/or remote smoke path must be verified before
   image promotion.
8. App version, user-agent defaults, Docker image tag, and VM env values must be
   consistent.
9. Compressed image manifest must be checked for tag, platform, git commit,
   size, and sha256 before upload/load.
10. Deployment order is commit, build archive from commit, upload archive and
    manifest, VM git pull, download/load image, set env, restart with no build,
    then health/search/pronunciation smoke checks.
