# 03 — SharePoint Target Tree (What `_AI_MEMORY/` Will Look Like)

This is the canonical “AI Brain” structure we will create/populate.

**Important:** This does **not** replace your operational libraries (SERVICE/PRICEBOOK/etc.).  
It is the AI-friendly layer.

---

## A) Two truths we keep (no-delete / contradiction-safe)

### 1) Observed export snapshot (what exists in the export right now)
Your audit shows content primarily in `SERVICE/`, `PRICEBOOK/`, and `INTERNAL/`, while `_AI_MEMORY/` is mostly scaffold.

We keep that as “Observed”.

### 2) Target AI Brain layout (what we will build)
We create the AI brain under `_AI_MEMORY/` without deleting any operational content.

---

## B) Target `_AI_MEMORY/` layout

```
_AI_MEMORY/
  Customers/
    <CUSTOMER_ID>/
      customer_profile.sanitized.json
      customer_summary.md
      notes/
        notes.jsonl                    # append-only
      jobs/
        <JOB_ID>/
          job_profile.json
          job_summary.md
          documents_index.json         # pointers to operational docs
          warranties_serials.json
      links/
        external_links.json            # OneDrive/sharepoint links referenced in docs
      relationships.json               # doc ↔ customer/job/service edges

  Pricebook/
    services.jsonl                     # NO cost/margin
    materials.jsonl                    # NO cost/margin
    equipment.jsonl                    # NO cost/margin
    pricebook_summary.md

  Ops/
    Approvals/
      approvals_index.jsonl
    Runbooks/
      runbooks_index.jsonl
    ChangeLogs/
      change_logs.jsonl
    TechnicianReports/
      daily_reports_index.jsonl

  Indexes/
    customer_index.jsonl
    pricebook_index.jsonl
    ops_index.jsonl
    nav_index.jsonl

  Internal/
    routing/
      email_routing_rules.json
      vendor_mapping.json
      customer_lookup_index.hashed.json     # hashes only (no raw emails/phones)
    manifests/
      run_manifest_<timestamp>.json
      file_manifest_<timestamp>.json
    governance/
      pii_policy.md
      sensitive_fields_policy.md
```

---

## C) How this coexists with your operational folders

- **Operational truth (human work):** `SERVICE/`, `PRICEBOOK/`, `ACCOUNTING/`, etc.
- **AI brain layer (safe):** `_AI_MEMORY/` (masked, costless)

AI answers come from `_AI_MEMORY/` unless you explicitly approve deeper access.

---

## D) Interface Layer Components to inventory + tie-in (no execution)

These are treated as “documented assets” and referenced in the AI brain (not run from here):

- **Teams Bot** (posts/reads in channels like #AI-Updates, #Approval-Queue)
- **CAPP (Command App)** — operator UI for approvals/commands
- **Phoenix AI Command Orchestrator** — routes requests and calls tools
- **Mail Courier** — email ingestion + routing (draft-only rules)
- **Approval Workflow** — safety net + checkpoint gating
- **Morning Report System** — daily briefings to Teams/OneNote
- **Pricebook Sync** — vendor feed ingestion (cost stays local)
- **Technician Daily Reports** — field intelligence intake
- **Security & Monitoring** — watchdog + anomaly alerts
- **Whisper intake** — voice transcription → customer intake drafts

The doc `docs/08_PLAYBOOK_PARTS_INDEX.md` maps these to Parts 1–19.
