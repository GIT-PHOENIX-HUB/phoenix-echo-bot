# 02 — Exactly What Will Be Created / Moved (Full Rundown)

This is the “no surprises” list.

---

## A) What we read (inputs)

### 1) Your SharePoint export (local)
- Entire folder tree (all files, all subfolders)
- We **do not modify** the export folder. We only read it.

### 2) Your JSON config files (local)
Expected (based on your repo/docs):
- `builders.json`
- `commercial.json`
- `residential.json`
- `customer_lookup_index.json`  *(PII-heavy; stays local)*
- `email_routing_rules.json`

---

## B) What we create locally (always)

### 1) Tables (analysis-ready)
Location: `work/runs/<run>/tables/`

Core:
- `sites.csv`
- `libraries_lists.csv`
- `fields.csv` *(spec-derived if list schema not present in export)*
- `perms.csv` *(usually empty/unknown in a file export; filled if present)*
- `documents.csv` *(includes extracted text)*
- `pages.csv` *(if pages exist in export)*
- `nav_links.csv`
- `file_hashes.csv`

AI Brain entity tables:
- `entities_customers.csv`
- `customer_jobs.csv`
- `customer_notes.csv`
- `warranties_serials.csv`
- `contacts.csv`
- `vendor_contacts.csv`
- `receipts_invoices.csv`
- `builder_files_index.csv`
- `relationships.csv`

### 2) Markdown reports
Location: `work/runs/<run>/markdown/`
- `data_quality.md` (duplicates, missing IDs, PII hits, contradictions)
- `security_snapshot.md` (recommended lock zones based on content + your perms matrix)
- `doc_summaries.md` (optional; can be huge)
- `upload_preview.md` (exact tree of what will be uploaded)

### 3) Manifests and logs
Location: `work/runs/<run>/manifests/` and `/logs/`
- `run_manifest.json` (counts, hashes, errors, timestamp)
- `file_manifest.json` (every file path + sha256)
- `errors.log`, `inventory.log`, `extract.log`, etc.

---

## C) What we create for upload (sanitized bundle)

Location: `work/runs/<run>/upload_bundle/`

This is a literal mirror of what SharePoint will receive under `_AI_MEMORY/`.

Rules:
- PII masked (email/phone/address) by default.
- Cost/margin removed by default.
- Everything is append-only where possible (notes logs are `.jsonl`/`.ndjson`).

---

## D) What we create in SharePoint (only after CP-006 approval)

Target: `PhoenixOps` site → `Documents` drive → `/_AI_MEMORY/`

We will:
1. Create missing folders in `_AI_MEMORY/` (idempotent).
2. Upload new/changed files from the sanitized bundle.
3. Write a run manifest so every upload is auditable and repeatable.

We will NOT:
- delete anything
- overwrite without keeping a previous version copy (versioned filenames by default)

---

## E) What stays local only (never uploaded)

- Raw `customer_lookup_index.json` (contains email/phone mappings)
- Unmasked PII extracts (full emails, phones, addresses)
- Any cost/margin columns or vendor cost files
- Any “raw email bodies” if you choose to pull them (only summaries can be uploaded)

---

## F) What is optional (depends on your decision)

- Uploading RAG indexes to SharePoint (`_AI_MEMORY/Indexes/`)
- Writing/upserting JSON into Cosmos DB containers (customers/jobs/interactions/etc.)
  - Your docs describe containers and `/partitionKey` usage.
