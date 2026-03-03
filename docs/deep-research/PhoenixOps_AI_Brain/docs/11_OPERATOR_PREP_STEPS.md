# Operator Prep Steps (What YOU Do Before Running Anything)

This is the straight checklist to get the data ready.

---

## 1) Freeze a snapshot (no surprises)
- Export the SharePoint site (or whichever scope you decided) to a local folder.
- Make a copy and mark it **READ-ONLY**.
- Do NOT edit files inside the export snapshot.

Result: one stable snapshot we can hash and re-run.

---

## 2) Collect the config JSONs
Put these in one folder:
- `builders.json`
- `commercial.json`
- `residential.json`
- `customer_lookup_index.json`  *(PII — local only)*
- `email_routing_rules.json`

If you have newer/older versions, keep both and name them:
- `residential_2025-12-18.json`
- `residential_2026-01-31.json`
The pipeline will ingest both and log conflicts.

---

## 3) Decide your PII posture (default is strict)
- Default: `_AI_MEMORY` gets masked PII + hashed lookup indexes.
- If you want the AI brain to see full contact details, that’s an explicit override (not default).

You can run strict now and loosen later. That’s safer.

---

## 4) Decide your financial posture
- Default: cost/margin stripped from upload.
- Recommended: strip **totalSpend/revenue** from upload too unless you want it searchable.

---

## 5) Install prereqs
- Install Python deps using `tools/powershell/Install-Prereqs.ps1`
- Confirm `python --version` and `pwsh --version`

---

## 6) Run with checkpoints
Start with local-only build:
```powershell
pwsh ./tools/powershell/Run-Phoenix-FullBuild.ps1 `
  -ExportPath "$HOME/PhoenixAI/inputs/sharepoint_export" `
  -ConfigPath "$HOME/PhoenixAI/inputs/config" `
  -WorkRoot "$HOME/PhoenixAI/work/runs/20260131_full_run" `
  -SiteUrl "https://TENANT.sharepoint.com/sites/PhoenixOps"
```

When you’re ready to upload, run again with:
- `-UploadToSharePoint`
…and approve CP-006.

---

## 7) What you hand me after the run
If you want me to “digest and spit out” the final AI brain set, you hand me:
- the run folder: `work/runs/<run>/`
- especially:
  - `tables/`
  - `markdown/`
  - `upload_bundle/`
  - `manifests/`

That’s everything needed to load into the MCP brain.
