# 01 — Execution Runbook (Full Implementation, Checkpointed)

This is the **step-by-step** for going from your **local SharePoint export + JSON configs** to a fully populated **PhoenixOps /_AI_MEMORY** AI brain, ready for MCP ingestion.

Everything is manual-start, checkpointed, and **no-delete**.

---

## What you do vs what the scripts do

### You do (operator actions)
1. Put the export in a known folder (copy it — don’t work off the only copy).
2. Put your config JSON files in `inputs/config/`.
3. Run one command to start the orchestrator.
4. Review summaries at each checkpoint and approve to continue.
5. After upload, verify SharePoint folder tree + counts.

### The scripts do (automation actions)
- Inventory and hash every file (dedupe-safe).
- Extract text from docs (docx/pdf/xlsx/pptx/md/txt/html).
- Build normalized tables (customers, jobs, invoices/receipts, warranties/serials, etc.).
- Run PII scan + tag results (PII never deleted).
- Produce a sanitized **upload bundle** (PII masked; cost/margin removed).
- Upload bundle into `PhoenixOps/_AI_MEMORY/...` using Graph.
- Produce manifests + logs for audit/repeatability.

---

## Prereqs (local machine)

### Required
- PowerShell 7.2+
- Python 3.11+
- Azure CLI (recommended, for Key Vault secret pulls)
- Internet access to Microsoft 365 tenant (for Graph upload only)

### Python dependencies
Install from `tools/python/requirements.txt`.

---

## Local working directory layout (recommended)

Create:
```
~/PhoenixAI/
  inputs/
    sharepoint_export/        # your export snapshot (copy)
    config/                   # builders.json, residential.json, etc
  work/
    runs/
      20260131_full_run/      # this run’s outputs (tables, logs, bundle)
```

---

# CHECKPOINT MAP (hard stops)

## CP-000 — Preflight (no SharePoint writes)
**Purpose:** confirm inputs exist, dependencies installed, output folder created.

**Runs:**
- `tools/powershell/Run-Phoenix-FullBuild.ps1` (preflight only)

**Creates locally:**
- `work/runs/<run>/logs/preflight.log`

**Approval needed to proceed:** Yes (press Enter)

---

## CP-001 — Inventory + SHA256 Hashing (no SharePoint writes)
**Purpose:** list everything, compute hashes, find duplicates, confirm nothing is missing.

**Runs:**
- `tools/python/phoenix_extract_export.py --mode inventory`

**Creates locally:**
- `tables/file_hashes.csv`
- `tables/documents_inventory.csv`
- `logs/inventory.log`
- `manifests/run_manifest.json` (partial)

**You review:**
- total file count
- total size
- duplicates list (if any)

**Approval needed:** YES

---

## CP-002 — Content Extraction (no SharePoint writes)
**Purpose:** extract text + tables from files.

**Runs:**
- `tools/python/phoenix_extract_export.py --mode extract`

**Creates locally:**
- `tables/documents.csv` (includes extracted text)
- `tables/pages.csv` (if any)
- `tables/nav_links.csv`

**You review:**
- extraction error list (PDFs with no text, etc.)
- top folders by document count

**Approval needed:** YES

---

## CP-003 — Entity Build (Customers/Jobs/Notes/Warranties) (no SharePoint writes)
**Purpose:** create the “AI Brain tables” from JSON + folder-derived evidence.

**Runs:**
- `tools/python/phoenix_extract_export.py --mode entities`

**Creates locally:**
- `tables/entities_customers.csv`
- `tables/customer_jobs.csv`
- `tables/customer_notes.csv`
- `tables/warranties_serials.csv`
- `tables/receipts_invoices.csv`
- `tables/builder_files_index.csv`
- `tables/relationships.csv`

**You review:**
- customer count vs expected (we keep conflicts, we do not discard)
- jobs count
- notes/warranty coverage

**Approval needed:** YES

---

## CP-004 — PII Scan + Sensitive Field Detection (no SharePoint writes)
**Purpose:** identify what MUST be masked before cloud upload.

**Runs:**
- `tools/python/phoenix_pii_scan.py`

**Creates locally:**
- `tables/pii_findings.csv`
- `markdown/data_quality.md`

**You review:**
- PII totals (emails/phones/addresses)
- any SSN/payment-token hits (should be near-zero)
- any permission artifacts (if present in export)

**Approval needed:** YES

---

## CP-005 — Build Upload Bundle (still no SharePoint writes)
**Purpose:** create the exact folder tree and JSON that *will* be uploaded.

**Runs:**
- `tools/python/phoenix_mask_upload_bundle.py`

**Creates locally:**
- `upload_bundle/`  ← this mirrors what SharePoint will receive
- `markdown/upload_preview.md` (tree + file counts)

**You review (CRITICAL):**
- the exact `_AI_MEMORY/` folder structure preview
- sample customer profile (masked)
- confirm cost/margin is removed

**Approval needed:** YES

---

## CP-006 — Upload to SharePoint `PhoenixOps/_AI_MEMORY` (FIRST CLOUD WRITE)
**Purpose:** create folders + upload sanitized outputs.

**Runs:**
- `tools/python/phoenix_upload_sharepoint.py`

**Creates in SharePoint:**
- folders and files described in `docs/03_SHAREPOINT_TARGET_TREE.md`
- manifests in `_AI_MEMORY/Internal/manifests/`

**Approval required (hard gate):**
You must type:
`APPROVE_UPLOAD_CP006`
or the script exits.

---

## CP-007 — Post-upload verification (read-only Graph)
**Purpose:** verify counts + spot-check file presence.

**Runs:**
- `tools/python/phoenix_upload_sharepoint.py --verify`

**Creates locally:**
- `logs/post_upload_verify.log`
- updates to `manifests/run_manifest.json`

**You review:**
- uploaded file count equals bundle file count
- random spot-check of customer folders

---

## CP-008 — MCP ingestion prep (optional, local + your MCP runner)
**Purpose:** generate RAG chunk files and indexes for MCP tools.

**Runs:**
- `tools/python/phoenix_build_rag_chunks.py`

**Creates locally:**
- `rag/customer_index.jsonl`
- `rag/ops_index.jsonl`
- `rag/pricebook_index.jsonl`
- `rag/nav_index.jsonl`

**Upload rules:**
- These can be uploaded to SharePoint under `_AI_MEMORY/Indexes/` if you want
- OR keep local and load directly into your MCP store

---

# One-command start

From the package root:
```powershell
pwsh ./tools/powershell/Run-Phoenix-FullBuild.ps1 `
  -ExportPath "$HOME/PhoenixAI/inputs/sharepoint_export" `
  -ConfigPath "$HOME/PhoenixAI/inputs/config" `
  -WorkRoot "$HOME/PhoenixAI/work/runs/20260131_full_run" `
  -SitePath "/sites/PhoenixOps" `
  -DriveName "Documents"
```

That script will stop at every checkpoint.

