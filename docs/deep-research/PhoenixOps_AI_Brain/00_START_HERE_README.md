# Phoenix Ops AI Brain — Full Implementation Package (LOCAL → SharePoint + MCP)

This zip is **execution-ready** (scripts + schemas + checklists), but **nothing runs by itself**.
It is built for **manual, checkpointed execution** from your **local machine**.

## Non-negotiables (your rules baked in)
- **No delete / no discard.** We only create new outputs and upload *new* files unless you explicitly tell us to archive/replace.
- **Checkpoint gating.** Every stage stops and asks you to approve before it continues.
- **PII stays local.** Anything that goes to SharePoint/_AI_MEMORY is **masked** (emails/phones/addresses) unless you override.
- **Cost/margin stays local.** Any cost/margin fields are stripped from the upload bundle.

## What you can do with this package
1) Inventory and hash the SharePoint export (local)
2) Extract full text + structured entities (local)
3) Generate MCP-ready, sanitized JSON bundles (local)
4) Upload the sanitized bundle to **PhoenixOps** → `/_AI_MEMORY/` (Graph)
5) Build RAG indexes + relationship edges for your MCP tools (local + optional Cosmos)

## Package contents
- `docs/` — step-by-step runbook + what will be created + folder trees + checkpoint sheets
- `schemas/` — data model + customer/job template (NC/Service/Remodel/Generator columns included even if empty)
- `tools/python/` — local extract → PII scan → sanitize → chunk → manifest
- `tools/powershell/` — a single orchestrator script that runs the pipeline with checkpoints
- `samples/` — sample JSON outputs (safe fake data)

## Start here
Open: `docs/01_EXECUTION_RUNBOOK.md`

---
Generated: 2026-01-31
