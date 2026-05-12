# Offline Embedding Run Records

Commit one Markdown file per cloud embedding run after reviewing the Blob logs
and manifests.

Run records are human-readable summaries. The machine-readable source of truth
remains in Blob Storage:

```text
logs/<cloud_run_id>/status.json
logs/<cloud_run_id>/remote_embedding_job.log
embeddings/<embedding_run_id>/manifest.json
indexes/<embedding_run_id>/manifest.json
```
