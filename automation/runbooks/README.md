# Phoenix Automation Runbooks

## MorningReport

Path: `automation/runbooks/MorningReport.ps1`

### Purpose
- Generates weekday 7:00 AM intelligence briefing
- Delivers summary to Teams `#AI-Updates`
- Sends full HTML email report to leadership recipients
- Emits a text summary into runbook logs

### Required Automation Variables
- `VaultName`
- `TenantId`
- `TeamsWebhook_AIUpdates`
- `TeamsWebhook_UrgentAlerts`

### Required Key Vault Secrets
- `SERVICETITAN-TENANT-ID`
- `SERVICETITAN-CORE-CLIENT-ID`
- `SERVICETITAN-CORE-SECRET`
- `SERVICETITAN-CORE-APP-KEY`
- `GRAPH-CLIENT-ID`
- `GRAPH-CLIENT-SECRET`

### Schedule (Azure CLI)
```bash
az automation schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --name "MorningReport-Weekdays-7AM" \
  --frequency "Week" \
  --interval 1 \
  --start-time "2025-12-16T07:00:00-07:00" \
  --time-zone "America/Denver" \
  --description "Phoenix AI Morning Report - Weekdays 7 AM Mountain"

az automation job-schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --runbook-name "MorningReport" \
  --schedule-name "MorningReport-Weekdays-7AM"
```

## WeeklyReport

Path: `automation/runbooks/WeeklyReport.ps1`

### Purpose
- Generates weekly intelligence rollup (financials, conversion, AR/estimate aging, tech leaderboard)
- Creates text, HTML, and Teams card report variants
- Delivers to Teams and email (or skips delivery in `DryRun`)

### Parameters
- `ReportWeekEnding` (optional): explicit week-ending date (`yyyy-MM-dd`)
- `DryRun` (optional): generate report without external delivery

### Required Automation Variables
- `VaultName`
- `TenantId`
- `CourierAppId`
- `TeamsWebhook_AIUpdates` (optional but recommended)

### Required Key Vault Secrets
- `SERVICETITAN-TENANT-ID`
- `SERVICETITAN-CORE-CLIENT-ID`
- `SERVICETITAN-CORE-SECRET`
- `SERVICETITAN-CORE-APP-KEY`
- `PhoenixMailCourierSecret`

### Example
```powershell
./WeeklyReport.ps1 -DryRun
./WeeklyReport.ps1 -ReportWeekEnding "2026-02-22"
```

### Schedule (Azure CLI)
```bash
az automation schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --name "WeeklyReport-Mondays-7AM" \
  --frequency "Week" \
  --interval 1 \
  --week-days "Monday" \
  --start-time "2026-03-02T07:00:00-07:00" \
  --time-zone "America/Denver" \
  --description "Phoenix AI Weekly Report - Mondays 7 AM Mountain"

az automation job-schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --runbook-name "WeeklyReport" \
  --schedule-name "WeeklyReport-Mondays-7AM"
```

## TechnicianDailyReports

Path: `automation/runbooks/TechnicianDailyReports.ps1`

### Purpose
- Generates technician-level daily performance reports and team rollups
- Tracks jobs, revenue, utilization, efficiency variance, callback rate, and overtime risk
- Supports multi-mode execution: `daily`, `single`, `team`, `weekly`
- Delivers management reports by email/Teams and stores history in Cosmos DB (if configured)

### Parameters
- `Mode` (optional): `daily` (default), `weekly`, `single`, `team`
- `TechnicianId` (required for `single`)
- `ReportDate` (optional): explicit report date

### Required Automation Variables
- `VaultName`
- `TenantId`
- `CourierAppId`
- `TeamsWebhook_AIUpdates` (optional)

### Required Key Vault Secrets
- `SERVICETITAN-TENANT-ID`
- `SERVICETITAN-CORE-CLIENT-ID`
- `SERVICETITAN-CORE-SECRET`
- `SERVICETITAN-CORE-APP-KEY`
- `PhoenixMailCourierSecret`
- `COSMOS-DB-KEY` (optional; enables storage)

### Example
```powershell
./TechnicianDailyReports.ps1
./TechnicianDailyReports.ps1 -Mode single -TechnicianId "12345" -ReportDate "2026-02-26"
./TechnicianDailyReports.ps1 -Mode team -ReportDate "2026-02-26"
```

### Schedule (Azure CLI)
```bash
az automation schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --name "TechnicianDailyReports-6PM" \
  --frequency "Week" \
  --interval 1 \
  --week-days "Monday" "Tuesday" "Wednesday" "Thursday" "Friday" \
  --start-time "2026-03-02T18:00:00-07:00" \
  --time-zone "America/Denver" \
  --description "Phoenix AI Technician Daily Reports - Weekdays 6 PM Mountain"

az automation job-schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --runbook-name "TechnicianDailyReports" \
  --schedule-name "TechnicianDailyReports-6PM"
```

## Process-Customers

Path: `automation/runbooks/Process-Customers.ps1`

### Purpose
- Ingest ServiceTitan CSV/XLSX customer export
- Deduplicate customer rows (multiple jobs per customer)
- Categorize into `BUILDER` and `RESIDENTIAL`
- Generate customer and SharePoint-folder manifests

### Outputs
- `customers_unique_YYYY-MM-DD.json`
- `customers_unique_YYYY-MM-DD.csv`
- `builders_YYYY-MM-DD.csv`
- `residential_YYYY-MM-DD.csv`
- `sharepoint_folder_structure_YYYY-MM-DD.json`
- `process_summary_YYYY-MM-DD.json`

### Example
```powershell
./Process-Customers.ps1 -InputFile "/path/to/servicetitan-export.csv" -OutputPath "/path/to/output"
```

## Phoenix-SharePoint-Theme

Path: `automation/runbooks/Phoenix-SharePoint-Theme.ps1`

### Purpose
- Register/update Phoenix Electric branding palette in SharePoint tenant themes
- Optionally apply the theme to a target SharePoint site

### Parameters
- `AdminUrl` (required): `https://<tenant>-admin.sharepoint.com`
- `SiteUrl` (optional): site to immediately apply the theme
- `ThemeName` (optional): defaults to `PhoenixElectric`

### Example
```powershell
./Phoenix-SharePoint-Theme.ps1 -AdminUrl "https://phoenixelectric-admin.sharepoint.com" -SiteUrl "https://phoenixelectric.sharepoint.com/sites/PhoenixElectric"
```

## Courier-SharePoint-Filing

Path: `automation/runbooks/Courier-SharePoint-Filing.ps1`

### Purpose
- Reads ProcessEmails output JSON
- Routes records to SharePoint based on category/vendor/customer lookup
- Enforces 3-consecutive-failure stop guard

### Inputs
- `EmailDataJson` (required): JSON payload from ProcessEmails
- `WhatIf` (optional): simulate folder/file writes

### Required Automation Variables
- `TenantId`
- `SharePointSiteId`
- `SharePointDriveId`
- `CustomerLookupSharePointPath` (optional, default set in script)
- `EmailArchiveRootPath` (optional, default set in script)

### Example
```powershell
./Courier-SharePoint-Filing.ps1 -EmailDataJson $jsonPayload -WhatIf
```

## Receipt-Extractor

Path: `automation/runbooks/Receipt-Extractor.ps1`

### Purpose
- Parse receipt-email JSON exported by upstream mailbox scrapers
- Identify vendor, PO/invoice references, and currency amounts
- Extract electrical material keywords for pricebook candidate review
- Produce JSON/CSV outputs for accounting + pricing workflows

### Inputs
- `ReceiptsFile` (optional): path to receipt JSON input file
- `OutputPath` (optional): output folder (default set in script)

### Outputs
- `receipts_processed_YYYY-MM-DD.json`
- `receipts_by_vendor_YYYY-MM-DD.json`
- `receipts_summary_YYYY-MM-DD.csv`
- `receipts_needs_review_YYYY-MM-DD.csv` (only if needed)
- `pricebook_candidates_YYYY-MM-DD.json`
- `extraction_summary_YYYY-MM-DD.json`

### Example
```powershell
./Receipt-Extractor.ps1 -ReceiptsFile "/path/to/receipts_2025-12-16.json" -OutputPath "/path/to/output"
```

## SecuritySentinel

Path: `automation/runbooks/SecuritySentinel.ps1`

### Purpose
- Runs continuous security monitoring for Phoenix AI operations
- Detects auth/API/write/secret/system anomalies and emits alerts
- Stores events and alerts in Cosmos DB when configured
- Supports daily security summary and detailed audit generation

### Parameters
- `Mode` (optional): `monitor` (default), `audit`, `report`, `alert`
- `LookbackMinutes` (optional): monitor lookback window (default `15`)
- `AlertId` (required for `alert` mode)

### Required Automation Variables
- `VaultName`
- `TenantId`
- `CourierAppId`
- `TeamsWebhook_AIUpdates` (optional)
- `TeamsWebhook_UrgentAlerts` (optional)

### Required Key Vault Secrets
- `PhoenixMailCourierSecret`
- `COSMOS-DB-KEY` (optional; enables Cosmos event/alert storage and audit/report modes)

### Example
```powershell
./SecuritySentinel.ps1
./SecuritySentinel.ps1 -Mode audit
./SecuritySentinel.ps1 -Mode report
./SecuritySentinel.ps1 -Mode alert -AlertId "alert_20260226_230000_ab12cd34"
```

### Schedule (Azure CLI)
```bash
# Every 15 minutes: monitor mode
az automation schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --name "SecuritySentinel-Every15Min" \
  --frequency "Minute" \
  --interval 15 \
  --start-time "2026-03-01T00:00:00-07:00" \
  --time-zone "America/Denver" \
  --description "Phoenix AI Security Sentinel - 15 minute monitoring"

az automation job-schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --runbook-name "SecuritySentinel" \
  --schedule-name "SecuritySentinel-Every15Min" \
  --parameters Mode=monitor LookbackMinutes=15

# Daily 11 PM: summary report mode
az automation schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --name "SecuritySentinel-Daily-11PM" \
  --frequency "Day" \
  --interval 1 \
  --start-time "2026-03-01T23:00:00-07:00" \
  --time-zone "America/Denver" \
  --description "Phoenix AI Security Sentinel - daily security report"

az automation job-schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --runbook-name "SecuritySentinel" \
  --schedule-name "SecuritySentinel-Daily-11PM" \
  --parameters Mode=report
```

## MaintenanceCleanup

Path: `automation/runbooks/MaintenanceCleanup.ps1`

### Purpose
- Enforces Cosmos retention policies across operations and telemetry containers
- Cleans stale/expired approvals
- Supports light daily cleanup and full weekly maintenance
- Produces audit-only reports with no mutations

### Parameters
- `Mode` (optional): `daily` (default), `weekly`, `audit`, `single`
- `Task` (optional): `all` (default), `approvals`, `security_events`, `security_alerts`, `tech_daily`, `estimate_tracking`, `invoice_tracking`
- `DryRun` (optional): simulate deletions without mutating Cosmos
- `BatchSize` (optional): max query batch size per cleanup query (default `100`)

### Required Automation Variables
- `VaultName`
- `TeamsWebhook_AIUpdates` (optional)

### Required Key Vault Secrets
- `COSMOS-DB-KEY` (required)

### Example
```powershell
./MaintenanceCleanup.ps1
./MaintenanceCleanup.ps1 -Mode daily -DryRun
./MaintenanceCleanup.ps1 -Mode weekly
./MaintenanceCleanup.ps1 -Mode single -Task security_events
./MaintenanceCleanup.ps1 -Mode audit
```

### Schedule (Azure CLI)
```bash
# Daily light cleanup at 2:00 AM Mountain
az automation schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --name "MaintenanceCleanup-Daily-2AM" \
  --frequency "Day" \
  --interval 1 \
  --start-time "2026-03-01T02:00:00-07:00" \
  --time-zone "America/Denver" \
  --description "Phoenix AI Maintenance - daily light cleanup"

az automation job-schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --runbook-name "MaintenanceCleanup" \
  --schedule-name "MaintenanceCleanup-Daily-2AM" \
  --parameters Mode=daily Task=all

# Weekly full maintenance at 3:00 AM Mountain on Sundays
az automation schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --name "MaintenanceCleanup-Weekly-Sun-3AM" \
  --frequency "Week" \
  --interval 1 \
  --week-days "Sunday" \
  --start-time "2026-03-01T03:00:00-07:00" \
  --time-zone "America/Denver" \
  --description "Phoenix AI Maintenance - weekly full cleanup"

az automation job-schedule create \
  --automation-account-name "PhoenixMailCourier" \
  --resource-group "PhoenixAi" \
  --runbook-name "MaintenanceCleanup" \
  --schedule-name "MaintenanceCleanup-Weekly-Sun-3AM" \
  --parameters Mode=weekly Task=all
```

## InvoiceCollection

Path: `automation/runbooks/InvoiceCollection.ps1`

### Purpose
- Tracks unpaid ServiceTitan invoices with staged collection logic
- Creates Graph **drafts only** for payment reminders (no auto-send)
- Applies member grace period, high-value escalation, and service-hold recommendations
- Persists invoice collection tracking in Cosmos `invoice_tracking`
- Produces aging reports and Teams daily summaries

### Parameters
- `Mode` (optional): `process` (default), `report`, `single`, `sync`
- `SingleInvoiceId` (required for `single` mode)

### Required Automation Variables
- `VaultName`
- `TenantId`
- `CourierAppId`
- `TeamsWebhook_AIUpdates` (optional)

### Required Key Vault Secrets
- `SERVICETITAN-TENANT-ID`
- `SERVICETITAN-CORE-CLIENT-ID`
- `SERVICETITAN-CORE-SECRET`
- `SERVICETITAN-CORE-APP-KEY`
- `PhoenixMailCourierSecret`
- `COSMOS-DB-KEY` (optional; enables persistent tracking)

### Example
```powershell
./InvoiceCollection.ps1
./InvoiceCollection.ps1 -Mode report
./InvoiceCollection.ps1 -Mode single -SingleInvoiceId "12345678"
./InvoiceCollection.ps1 -Mode sync
```
