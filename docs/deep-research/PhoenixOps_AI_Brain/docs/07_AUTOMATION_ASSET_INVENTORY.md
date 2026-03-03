# Automation Assets Inventory (PowerShell / Shell / Skills)

These are treated as **documented assets**: we inventory them, note purpose, but **do not execute** unless you choose.

---

## A) Azure Automation Runbooks (PowerShell 7.2)

From your runbook inventory doc (pulled 2026-01-19):
- `ProcessEmails.ps1` — Email categorization & routing (Part 1)
- `morningreport.ps1` — Daily intelligence briefing (Part 5)
- `approvalworkflow.ps1` — Approval gates / safety net (Part 6)
- `customerfoldercreation.ps1` — Auto-create customer folders (Part 7)
- `estimatefollowup.ps1` — Estimate follow-up (Part 8)
- `InvoiceCollection.ps1` — Invoice collection (Part 9)
- `pricebooksync.ps1` — Vendor price sync (Part 10)
- `TechnicianDailyReports.ps1` — Field reports (Part 11)
- `SecurityMonitoring.ps1` — Security watchdog (Part 12)
- `PhoenixAiCommand.ps1` — Command orchestrator (Part 4 / Part 16)
- `teamsonenotecosmos.ps1` — Teams/OneNote/Cosmos integration (Part 3)
- `WeeklyAIReport.ps1` — Weekly summaries (Part 5)
- `MaintenanceCleanup.ps1` — Maintenance tasks (Part 15)

**Rule:** These are not executed from this package. This package builds the AI brain content and the upload bundle.

---

## B) SharePoint setup scripts (PnP / Graph)

The Graph readiness report calls out these scripts and what’s safe locally:
- `SharePoint-Backup.ps1` — read-only backup to local
- `SharePoint-CreateStructure.ps1` — creates thousands of folders (reversible but not trivial)
- `SharePoint-Rollback.ps1` — rollback of created folders (high risk; recycle bin)
- `Phoenix-SharePoint-Theme.ps1` — theme branding

**Rule:** For your “no surprises” requirement, anything that writes to SharePoint is behind checkpoint CP-006.

---

## C) Courier filing pipeline assets
- `FileEmailsToSharePoint.ps1`
- `Phoenix_Mail_Courier_Orchestrator.ps1`
- `email_routing_rules.json`
- `customer_lookup_index.json`

**PII rule impact:**
- `customer_lookup_index.json` contains emails/phones → local-only.
- Cloud uses `customer_lookup_index.hashed.json` (hash-only) if you want automated filing without storing raw PII in SharePoint.

---

## D) Skills / Tools
- `ElectricalGuru` — NEC consultation + MCP architecture references
- `Whisper` — audio transcription intake pipeline (`whisper_watch.sh`, LaunchAgent plist)

---

## E) Interface layer
- Teams bot (channels: #AI-Updates, #Approval-Queue)
- CAPP (Command App UI)
- OneNote daily log integration

All of these are referenced in the AI brain index so MCP can cite their docs.
