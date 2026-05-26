# Pronunciation Final Path Stage

## Stage

Planning / state rebuild.

## Active Tracker

`ARTIFACTS/pronunciation_final_path/issue_tracker.tsv`

## Behavior Contract

`ARTIFACTS/pronunciation_final_path/behavior_contract.md`

## Workflow Notes

`ARTIFACTS/pronunciation_final_path/workflow_notes.md`

## Current Gating Rule

Do not launch critical jobs until the tracker gates for the relevant job are
resolved:

- Docker image build/upload: resolve deployment and extension compatibility
  blockers that affect image contents.
- VM hot patch: resolve image handoff, VM update path, and payload verification
  blockers.
- UI implementation: follow the pronunciation and layout behavior contract
  exactly; phoneme JSON alone is not complete automatic playback.
- Extension integration: resolve Python/Linux build path and API/schema shape.

## Immediate Next Step

Implement from the tracker in dependency order:

1. stage required eSpeak/meSpeak runtime assets inside the tracked serving repo
   and confirm Docker includes them;
2. complete the eSpeak/meSpeak lazy runtime path from the behavior contract;
3. add/verify tests for card priority, IPA-only state, asset lazy loading,
   clear-search dismissal, and List/Tree isolation;
4. verify asset cache headers, fallback behavior, and local runtime dependency
   boundaries;
5. verify payload availability for the target processed/index artifact;
6. run focused Python and static JS tests;
7. run local preview with `COLLECTION_NAME=reverse_wiktionary_test`;
8. verify compressed image manifest and deployment env consistency;
9. build and ship compressed web image only after tests and preview pass.

## Final Sweep Tasks

Before final tests or commit staging, complete the hygiene rows in the tracker:

1. sweep changed production code comments for prompt artifacts, tutorial tone, and
   irrelevant design-process commentary;
2. sweep docs touched in this pass for stale alternatives and foregone decisions;
3. reconcile tracker rows to concrete resolved, blocked, or deferred states.
