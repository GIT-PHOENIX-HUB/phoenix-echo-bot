# Artifact ↔ Playbook Mapping (So Nothing Floats Without a Source)

| Artifact | What it is | Playbook Part |
|---|---|---|
| `email_routing_rules.json` | classification + filing rules | Part 1 |
| `customer_lookup_index.json` | email/phone → customer folder mapping (PII) | Part 1 / Part 2 |
| `FileEmailsToSharePoint.ps1` | files processed email metadata into SharePoint | Part 1 |
| `Phoenix_Mail_Courier_Orchestrator.ps1` | orchestrates email processing + summaries | Part 1 / Part 5 |
| `Create-SharePointFolders.ps1` | builds global folder scaffold | Part 2 |
| `Create-CustomerFolders.ps1` | builds per-customer folder trees | Part 7 |
| `teamsonenotecosmos.ps1` | Teams + OneNote + Cosmos integration | Part 3 |
| `PhoenixAiCommand.ps1` | “brain” command orchestrator | Part 4 |
| `morningreport.ps1` | daily briefing | Part 5 |
| `approvalworkflow.ps1` | approvals + safety gating | Part 6 |
| `estimatefollowup.ps1` | estimate follow-up | Part 8 |
| `InvoiceCollection.ps1` | collections pipeline | Part 9 |
| `pricebooksync.ps1` | pricebook updates | Part 10 |
| `TechnicianDailyReports.ps1` | field reporting | Part 11 |
| `SecurityMonitoring.ps1` | security/monitoring | Part 12 |
| `Part 14 Deployment Checklist` | how to deploy safely | Part 14 |
| `Part 16 CAPP` | command app UI | Part 16 |
| `Part 17 MCP Tools` | tool surface + connectors | Part 17 |
| `Part 18 Governance` | memory policy, PII rules | Part 18 |
| `_AI_MEMORY/` structure in this package | AI-safe knowledge layer | Parts 17–18 |

This plan keeps the old-school rule: every system component has a place and a paper trail.
