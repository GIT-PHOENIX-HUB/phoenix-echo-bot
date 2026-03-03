# VERSION 5 REVISED to Playbook 1-15 Alignment

Analysis date: 2025-12-31
Purpose: map `VERSION_FIVE_REVISED` (6 consolidated Function Apps) to the existing 1-15 playbook.
Key insight: the playbook references agent/runbook units; V5R maps those to function-app deployment units while preserving business logic.

## Executive Summary

- Compatibility: 95%+
- Functional behavior is preserved
- Main delta is deployment architecture (runbooks -> function apps)

### Preserved (100%)
- 5-category email classification
- 7-subfolder customer folder model
- 4-stage estimate follow-up (3/7/14/21)
- 5-stage invoice collection (7/14/21/30/45)
- 4-tier markup (45/35/25/20)
- Approval workflow + risk levels
- Morning report at 7:00 AM
- All 13 Cosmos containers
- Golden rules (approval gating, archive-first, audit trail)

### Architecture Change

| Playbook | V5 Revised |
|---|---|
| 10 Azure Automation runbooks | 6 Azure Function Apps |
| Automation schedules | Timer triggers |
| PowerShell 7.2 (Automation) | PowerShell 7.2 (Functions) |
| Consumption-first cost profile | Premium + Consumption mix |
| Cold starts 10-30s | Premium path under 1s |

## Function App Topology

| App | Tier | Primary Scope |
|---|---|---|
| fa-phoenix-coordination | Premium EP1 | orchestration, approvals, routing |
| fa-phoenix-communications | Premium EP1 | email/Teams/OneNote |
| fa-phoenix-operations | Premium EP1 | ServiceTitan + SharePoint + morning report |
| fa-phoenix-financial | Consumption | estimates, collections, pricebook |
| fa-phoenix-support | Consumption | support/knowledge/policy functions |
| fa-phoenix-monitoring | Consumption | security, health, maintenance timers |

## Part-by-Part Alignment

| Part | Status | Notes |
|---|---|---|
| Part 1 | aligned | email classification and draft-approval flow preserved |
| Part 2 | aligned | customer folder + 7 subfolders preserved |
| Part 3 | aligned | Teams/OneNote/Cosmos integrations preserved |
| Part 4 | mapped | runbook schedules mapped to function timers |
| Part 5 | aligned | morning report channels preserved |
| Part 6 | enhanced | amount-based risk tiering and timeout behavior documented |
| Part 7 | aligned | auto-folder creation preserved |
| Part 8 | aligned | 4-stage estimate follow-up preserved |
| Part 9 | aligned | 5-stage invoice collection preserved |
| Part 10 | aligned | markup and pricebook sync preserved |
| Part 11 | aligned | daily technician reporting preserved |
| Part 12 | enhanced | OpenTelemetry, App Insights, circuit breaker additions |
| Part 13 | aligned | interface architecture remains compatible |
| Part 14 | update_required | deployment docs must move to function-app model |
| Part 15 | update_required | maintenance/cost model must be updated |

## Schedule Mapping (Legacy -> Function)

| Legacy Schedule | Revised Mapping |
|---|---|
| ProcessEmails | fa-phoenix-communications / Process-Email |
| MorningReport | fa-phoenix-operations / Generate-MorningReport |
| EstimateFollowUp | fa-phoenix-financial / Process-EstimateFollowUp |
| InvoiceCollection | fa-phoenix-financial / Process-InvoiceCollection |
| CustomerFolderSync | fa-phoenix-operations / Sync-CustomerFolders |
| PricebookSync | fa-phoenix-financial / Sync-Pricebook |
| TechDailyReports | fa-phoenix-monitoring / Generate-TechReports |
| SecurityMonitor | fa-phoenix-monitoring / Scan-Security |
| DailySecurityReport | fa-phoenix-monitoring / Generate-SecurityReport |
| MaintenanceCleanup | fa-phoenix-monitoring / Run-Cleanup |

## Timer CRON Mapping (Azure Functions NCRONTAB)

| Schedule | CRON |
|---|---|
| ProcessEmails (5 min) | `0 */5 * * * *` |
| MorningReport (7 AM weekdays) | `0 0 7 * * 1-5` |
| EstimateFollowUp (9 AM weekdays) | `0 0 9 * * 1-5` |
| InvoiceCollection (10 AM weekdays) | `0 0 10 * * 1-5` |
| CustomerFolderSync (11 AM weekdays) | `0 0 11 * * 1-5` |
| PricebookSync (2 AM daily) | `0 0 2 * * *` |
| TechDailyReports (6 PM weekdays) | `0 0 18 * * 1-5` |
| SecurityMonitor (15 min) | `0 */15 * * * *` |
| DailySecurityReport (11 PM daily) | `0 0 23 * * *` |
| MaintenanceCleanup (3 AM daily) | `0 0 3 * * *` |

## Agent to Function App Mapping

| Legacy Agent | Revised App |
|---|---|
| Phoenix Command Orchestrator | fa-phoenix-coordination |
| Approval Gateway | fa-phoenix-coordination |
| Phoenix Courier | fa-phoenix-communications |
| ServiceTitan Director | fa-phoenix-operations |
| SharePoint Director | fa-phoenix-operations |
| Quote Generator | fa-phoenix-financial |
| Finance Analyst | fa-phoenix-financial |
| Schedule Coordinator | fa-phoenix-financial |
| Marketing Agent | fa-phoenix-support |
| Knowledge Builder | fa-phoenix-support |
| Security Sentinel | fa-phoenix-support |
| Health Monitor | fa-phoenix-monitoring |
| Audit Logger | fa-phoenix-monitoring |

## Cosmos Containers (Preserved)

- customers, jobs, interactions, aiLearnings, voiceProfiles
- approvals, estimate_tracking, invoice_tracking
- pricebook, rexel_pricing
- tech_daily, security_events, security_alerts

## Key Vault Secrets (Preserved)

- COSMOS-DB-KEY
- GRAPH-CLIENT-ID
- GRAPH-CLIENT-SECRET
- ST-CLIENT-ID
- ST-CLIENT-SECRET
- TEAMS-WEBHOOK-URL
- REXEL-API-KEY
- ANTHROPIC-API-KEY

## Golden Rules (Preserved)

- Never auto-send external email
- Never delete operational data (archive-first)
- Approval gate on write operations
- Full audit logging
- 3-failure rule / circuit breaker escalation

## Playbook Sections Requiring Updates

High priority:
- Part 14 deployment checklist -> function app deployment model
- Part 15 maintenance and cost guidance -> revised operating profile

Medium priority:
- Part 4 schedule references -> timer CRON format
- Part 6 approval docs -> amount-based tiering behavior

Low priority:
- Part 12 observability details -> OpenTelemetry/App Insights/circuit breaker

## Cost Analysis

| Component | Legacy | Revised |
|---|---|---|
| Azure Automation | $35-75 | replaced |
| Function Apps (Premium) | N/A | $519 |
| Function Apps (Consumption) | N/A | $60-130 |
| Cosmos DB | $25 | $25 |
| Service Bus | N/A | $10 |
| Key Vault | $5 | $5 |
| Application Insights | included | included |
| Total | $65-105 | $687-922 |

## Migration Path

1. Parallel deployment (weeks 1-2)
2. Validation (weeks 3-4)
3. Cutover (weeks 5-6)
4. Cleanup (weeks 7-8)

## Conclusion

V5R is architecturally different but functionally aligned. The primary playbook work is documentation and deployment-command migration for Parts 14-15, with schedule and approval-document refinements for Parts 4 and 6.
