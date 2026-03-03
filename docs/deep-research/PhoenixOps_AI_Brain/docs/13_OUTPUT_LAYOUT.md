# Output Layout (What folders/files get produced)

The plan outputs into a single run folder. You can name it using the date.

Recommended:
```
vault_exports/
  20260131_bulk_extract/
    tables/
    markdown/
    manifests/
    logs/
    rag/
    upload_bundle/
```

This package uses `WorkRoot` as that run folder.

Key files:
- `tables/file_hashes.csv`
- `tables/documents.csv` (full extracted text)
- `tables/entities_customers.csv`
- `tables/customer_jobs.csv` (if present)
- `tables/pii_findings.csv`
- `markdown/data_quality.md`
- `markdown/upload_preview.md`
- `upload_bundle/_AI_MEMORY/...` (what gets uploaded)
- `manifests/run_manifest.json`

Idempotence:
- We can skip unchanged files by comparing SHA256 and modified timestamps.
- Every run emits a manifest so you can delta-run later.
