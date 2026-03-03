<#
.SYNOPSIS
    Phoenix AI Morning Report Generator
.DESCRIPTION
    Builds and delivers a daily intelligence briefing from ServiceTitan + email
    triage + Cosmos memory signals.
.NOTES
    Runtime: PS72-Courier (PowerShell 7.2)
    Version: 1.0.0
    Schedule: Weekdays 07:00 America/Denver
#>

#Requires -Modules Az.Accounts, Az.KeyVault

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ReportDate = Get-Date
$script:ReportDateString = $script:ReportDate.ToString('yyyy-MM-dd')
$script:ReportDayName = $script:ReportDate.ToString('dddd')
$script:ReportFullDate = $script:ReportDate.ToString('MMMM d, yyyy')
$script:ExecutionLog = @()
$script:EmailRecipients = @(
    'shane@phoenixelectric.life',
    'smowbray@phoenixelectric.life'
)

function Write-Log {
    param(
        [ValidateSet('INFO', 'WARN', 'ERROR', 'DEBUG')]
        [string]$Level = 'INFO',
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [string]$Agent = 'MORNING_REPORT'
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $entry = [ordered]@{
        Timestamp = $timestamp
        Level = $Level
        Agent = $Agent
        Message = $Message
    }
    $script:ExecutionLog += $entry
    Write-Output "[$timestamp] $Level [$Agent]: $Message"
}

function Get-ManagedIdentityToken {
    param([Parameter(Mandatory = $true)][string]$Resource)

    $tokenUri = "$($env:IDENTITY_ENDPOINT)?resource=$Resource&api-version=2019-08-01"
    $headers = @{ 'X-IDENTITY-HEADER' = $env:IDENTITY_HEADER }
    $response = Invoke-RestMethod -Uri $tokenUri -Headers $headers -Method Get -TimeoutSec 30
    return $response.access_token
}

function Get-KeyVaultSecretREST {
    param(
        [Parameter(Mandatory = $true)][string]$VaultName,
        [Parameter(Mandatory = $true)][string]$SecretName,
        [Parameter(Mandatory = $true)][string]$AccessToken
    )

    $secretUri = "https://$($VaultName.Trim()).vault.azure.net/secrets/$($SecretName.Trim())?api-version=7.4"
    $headers = @{ Authorization = "Bearer $AccessToken" }
    $response = Invoke-RestMethod -Uri $secretUri -Headers $headers -Method Get -TimeoutSec 30
    return $response.value
}

function Get-ServiceTitanToken {
    param(
        [Parameter(Mandatory = $true)][string]$ClientId,
        [Parameter(Mandatory = $true)][string]$ClientSecret
    )

    $body = "grant_type=client_credentials&client_id=$([uri]::EscapeDataString($ClientId.Trim()))&client_secret=$([uri]::EscapeDataString($ClientSecret.Trim()))"
    $response = Invoke-RestMethod -Uri 'https://auth.servicetitan.io/connect/token' -Method Post -Body $body -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 30
    return $response.access_token
}

function Get-GraphToken {
    param(
        [Parameter(Mandatory = $true)][string]$TenantId,
        [Parameter(Mandatory = $true)][string]$ClientId,
        [Parameter(Mandatory = $true)][string]$ClientSecret
    )

    $tokenUri = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
    $body = @{
        grant_type = 'client_credentials'
        client_id = $ClientId.Trim()
        client_secret = $ClientSecret.Trim()
        scope = 'https://graph.microsoft.com/.default'
    }

    $response = Invoke-RestMethod -Uri $tokenUri -Method Post -Body $body -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 30
    return $response.access_token
}

function Invoke-ServiceTitanAPI {
    param(
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [ValidateSet('GET', 'POST', 'PUT', 'PATCH', 'DELETE')][string]$Method = 'GET',
        [hashtable]$QueryParams = @{},
        [Parameter(Mandatory = $true)][string]$AccessToken,
        [Parameter(Mandatory = $true)][string]$AppKey,
        [Parameter(Mandatory = $true)][string]$TenantId
    )

    $fullEndpoint = $Endpoint -replace '{tenant}', $TenantId
    $queryString = ''

    if ($QueryParams.Count -gt 0) {
        $queryParts = $QueryParams.GetEnumerator() | ForEach-Object {
            "$($_.Key)=$([uri]::EscapeDataString([string]$_.Value))"
        }
        $queryString = "?" + ($queryParts -join '&')
    }

    $uri = "https://api.servicetitan.io$fullEndpoint$queryString"
    $headers = @{
        Authorization = "Bearer $AccessToken"
        'ST-App-Key' = $AppKey
        'Content-Type' = 'application/json'
    }

    try {
        $response = Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -TimeoutSec 30
        return @{ Success = $true; Data = $response }
    } catch {
        Write-Log -Level 'ERROR' -Message "ServiceTitan API failed: $($_.Exception.Message)" -Agent 'ST'
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Get-TodaysAppointments {
    param([hashtable]$Creds)

    $today = $script:ReportDateString
    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/dispatch/v2/tenant/{tenant}/appointments' `
        -QueryParams @{
            startsOnOrAfter = "${today}T00:00:00Z"
            startsOnOrBefore = "${today}T23:59:59Z"
            pageSize = '100'
        } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    return @($result.Data.data)
}

function Get-OpenEstimates {
    param([hashtable]$Creds)

    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/sales/v2/tenant/{tenant}/estimates' `
        -QueryParams @{ status = 'Open'; pageSize = '100' } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    return @($result.Data.data)
}

function Get-UnpaidInvoices {
    param([hashtable]$Creds)

    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/accounting/v2/tenant/{tenant}/invoices' `
        -QueryParams @{ status = 'Unpaid'; pageSize = '100' } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    return @($result.Data.data)
}

function Get-ActiveTechnicians {
    param([hashtable]$Creds)

    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/settings/v2/tenant/{tenant}/technicians' `
        -QueryParams @{ active = 'true' } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    return @($result.Data.data)
}

function Get-WeeklyMetrics {
    param([hashtable]$Creds)

    $weekStart = $script:ReportDate.AddDays(-7).ToString('yyyy-MM-dd')
    $weekEnd = $script:ReportDateString

    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/jpm/v2/tenant/{tenant}/jobs' `
        -QueryParams @{
            completedOnOrAfter = "${weekStart}T00:00:00Z"
            completedOnOrBefore = "${weekEnd}T23:59:59Z"
            pageSize = '200'
        } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    $jobs = @($result.Data.data)
    $revenue = ($jobs | Where-Object { $_.total } | Measure-Object -Property total -Sum).Sum
    if (-not $revenue) { $revenue = 0 }

    $avg = 0
    if ($jobs.Count -gt 0) {
        $avg = [math]::Round(($revenue / $jobs.Count), 2)
    }

    return @{
        JobsCompletedThisWeek = $jobs.Count
        WeeklyRevenue = $revenue
        AverageJobValue = $avg
    }
}

function Get-OvernightEmailSummary {
    # Placeholder until ProcessEmails output is wired through storage/job history.
    return @{
        TotalProcessed = 0
        Categories = @{
            INTERNAL = 0
            RECEIPT_INVOICE = 0
            CUSTOMER_SCHEDULING = 0
            VENDOR = 0
            GENERAL = 0
        }
        NeedResponse = 0
        AutoFiled = 0
        NeedReview = 0
    }
}

function Get-AIRecommendations {
    param(
        [array]$Estimates,
        [array]$Invoices,
        [array]$Appointments
    )

    $recommendations = @()
    $priority = 1

    $oldEstimates = $Estimates | Where-Object {
        if (-not $_.createdOn) { return $false }
        $created = [DateTime]::Parse($_.createdOn)
        (($script:ReportDate - $created).Days -ge 3)
    } | Sort-Object { [DateTime]::Parse($_.createdOn) }

    foreach ($est in ($oldEstimates | Select-Object -First 3)) {
        $created = [DateTime]::Parse($est.createdOn)
        $ageDays = ($script:ReportDate - $created).Days
        $urgency = if ($ageDays -ge 7) { '⚠️ ' } else { '' }

        $recommendations += @{
            Priority = $priority++
            Type = 'ESTIMATE_FOLLOWUP'
            Message = "${urgency}Follow up estimate for $($est.name) - `$$($est.total) - $ageDays days old"
        }
    }

    $overdueInvoices = $Invoices | Where-Object {
        if (-not $_.createdOn) { return $false }
        $created = [DateTime]::Parse($_.createdOn)
        (($script:ReportDate - $created).Days -ge 30)
    } | Sort-Object { $_.total } -Descending

    foreach ($inv in ($overdueInvoices | Select-Object -First 3)) {
        $created = [DateTime]::Parse($inv.createdOn)
        $ageDays = ($script:ReportDate - $created).Days
        $recommendations += @{
            Priority = $priority++
            Type = 'OVERDUE_INVOICE'
            Message = "Overdue invoice: $($inv.customerName) - `$$($inv.total) ($ageDays days)"
        }
    }

    $conflicts = @()
    $grouped = $Appointments | Group-Object -Property technicianId
    foreach ($techGroup in $grouped) {
        $sorted = $techGroup.Group | Sort-Object { [DateTime]::Parse($_.start) }
        for ($i = 0; $i -lt ($sorted.Count - 1); $i++) {
            $currentEnd = [DateTime]::Parse($sorted[$i].end)
            $nextStart = [DateTime]::Parse($sorted[$i + 1].start)
            if ($currentEnd -gt $nextStart) {
                $conflicts += $techGroup.Name
            }
        }
    }

    foreach ($tech in $conflicts | Select-Object -Unique) {
        $recommendations += @{
            Priority = $priority++
            Type = 'SCHEDULE_CONFLICT'
            Message = "⚠️ Schedule conflict: technician $tech has overlapping appointments"
        }
    }

    return $recommendations
}

function Build-TextReport {
    param([hashtable]$Data)

    $urgent = ($Data.Recommendations | Where-Object { $_.Priority -le 3 } | Measure-Object).Count

    $report = @"
═══════════════════════════════════════════════════════════════════
  🌅 PHOENIX AI MORNING REPORT
  $($script:ReportDayName), $($script:ReportFullDate)
═══════════════════════════════════════════════════════════════════

📊 TODAY AT A GLANCE
  Jobs Scheduled:     $($Data.TodaysJobs.Count)
  Open Estimates:     $($Data.Estimates.Count)
  Unpaid Invoices:    $($Data.Invoices.Count) (total: `$$($Data.UnpaidTotal))
  Emails Overnight:   $($Data.EmailSummary.TotalProcessed)
  Urgent Items:       $urgent

🎯 AI RECOMMENDATIONS
"@

    if ($Data.Recommendations.Count -eq 0) {
        $report += "`n  ✓ No urgent items - looking good!"
    } else {
        $num = 1
        foreach ($rec in ($Data.Recommendations | Select-Object -First 5)) {
            $report += "`n  $num. $($rec.Message)"
            $num++
        }
    }

    $report += @"

💰 FINANCIAL SNAPSHOT
  Unpaid Invoices:      $($Data.Invoices.Count) totaling `$$($Data.UnpaidTotal)
  Overdue (>30 days):   $($Data.OverdueCount) totaling `$$($Data.OverdueTotal)
  This Week's Revenue:  `$$($Data.WeeklyMetrics.WeeklyRevenue)
  Open Estimates Value: `$$($Data.EstimatesTotal)

📧 OVERNIGHT EMAIL SUMMARY
  Customer Scheduling:  $($Data.EmailSummary.Categories.CUSTOMER_SCHEDULING)
  Vendor/Invoices:      $($Data.EmailSummary.Categories.RECEIPT_INVOICE)
  Internal:             $($Data.EmailSummary.Categories.INTERNAL)
  General/Triage:       $($Data.EmailSummary.Categories.GENERAL)

═══════════════════════════════════════════════════════════════════
"@

    return $report
}

function Build-HtmlReport {
    param([hashtable]$Data)

    $urgent = ($Data.Recommendations | Where-Object { $_.Priority -le 3 } | Measure-Object).Count
    $urgentColor = if ($urgent -gt 0) { '#e74c3c' } else { '#27ae60' }

    $recommendationRows = ''
    if ($Data.Recommendations.Count -eq 0) {
        $recommendationRows = '<li>No urgent items - looking good.</li>'
    } else {
        foreach ($rec in ($Data.Recommendations | Select-Object -First 5)) {
            $recommendationRows += "<li>$($rec.Message)</li>"
        }
    }

    return @"
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: Segoe UI, Arial, sans-serif; background: #f5f6f8; margin: 0; padding: 20px; }
.container { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 10px; overflow: hidden; }
.header { background: linear-gradient(140deg,#17324f,#2d7abf); color:#fff; padding:24px; }
.content { padding: 24px; }
.grid { display:grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
.card { background: #f7f9fc; border: 1px solid #e6edf5; border-radius: 8px; padding: 10px; }
.value { font-size: 24px; font-weight: 700; color: #17324f; }
.label { font-size: 12px; color: #5f7388; text-transform: uppercase; }
.footer { background: #f7f9fc; color:#5f7388; font-size:12px; padding:16px 24px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1 style="margin:0;">🌅 Phoenix AI Morning Report</h1>
    <div style="opacity:0.9; margin-top:4px;">$($script:ReportDayName), $($script:ReportFullDate)</div>
  </div>
  <div class="content">
    <h2 style="margin-top:0;">Today at a Glance</h2>
    <div class="grid">
      <div class="card"><div class="value">$($Data.TodaysJobs.Count)</div><div class="label">Jobs Today</div></div>
      <div class="card"><div class="value">$($Data.Estimates.Count)</div><div class="label">Open Estimates</div></div>
      <div class="card"><div class="value" style="color:$urgentColor;">$urgent</div><div class="label">Urgent Items</div></div>
      <div class="card"><div class="value">`$$("{0:N0}" -f $Data.UnpaidTotal)</div><div class="label">Unpaid Total</div></div>
      <div class="card"><div class="value">$($Data.EmailSummary.TotalProcessed)</div><div class="label">Emails Overnight</div></div>
      <div class="card"><div class="value">`$$("{0:N0}" -f $Data.EstimatesTotal)</div><div class="label">Estimate Pipeline</div></div>
    </div>

    <h2>AI Recommendations</h2>
    <ol>$recommendationRows</ol>

    <h2>Financial Snapshot</h2>
    <ul>
      <li>Unpaid invoices: $($Data.Invoices.Count) totaling `$$("{0:N0}" -f $Data.UnpaidTotal)</li>
      <li>Overdue invoices: $($Data.OverdueCount) totaling `$$("{0:N0}" -f $Data.OverdueTotal)</li>
      <li>This week revenue: `$$("{0:N0}" -f $Data.WeeklyMetrics.WeeklyRevenue)</li>
    </ul>
  </div>
  <div class="footer">Generated by Phoenix AI Core at $(Get-Date -Format 'h:mm tt')</div>
</div>
</body>
</html>
"@
}

function Build-TeamsCard {
    param([hashtable]$Data)

    $urgent = ($Data.Recommendations | Where-Object { $_.Priority -le 3 } | Measure-Object).Count
    $statusColor = if ($urgent -gt 0) { 'attention' } else { 'good' }

    $recBlocks = @()
    foreach ($rec in ($Data.Recommendations | Select-Object -First 3)) {
        $recBlocks += @{ type = 'TextBlock'; text = "$($rec.Priority). $($rec.Message)"; wrap = $true; size = 'small' }
    }
    if ($recBlocks.Count -eq 0) {
        $recBlocks += @{ type = 'TextBlock'; text = 'No urgent items - looking good.'; wrap = $true; size = 'small'; color = 'good' }
    }

    $payload = @{
        type = 'message'
        attachments = @(
            @{
                contentType = 'application/vnd.microsoft.card.adaptive'
                content = @{
                    '$schema' = 'http://adaptivecards.io/schemas/adaptive-card.json'
                    type = 'AdaptiveCard'
                    version = '1.4'
                    body = @(
                        @{ type = 'TextBlock'; text = '🌅 Phoenix AI Morning Report'; weight = 'bolder'; size = 'large' },
                        @{ type = 'TextBlock'; text = "$($script:ReportDayName), $($script:ReportFullDate)"; isSubtle = $true; spacing = 'none' },
                        @{
                            type = 'ColumnSet'
                            columns = @(
                                @{ type = 'Column'; width = 'stretch'; items = @(@{ type = 'TextBlock'; text = "$($Data.TodaysJobs.Count)"; size = 'extraLarge'; weight = 'bolder'; horizontalAlignment = 'center' }, @{ type = 'TextBlock'; text = 'Jobs Today'; size = 'small'; horizontalAlignment = 'center'; isSubtle = $true }) },
                                @{ type = 'Column'; width = 'stretch'; items = @(@{ type = 'TextBlock'; text = "$($Data.Estimates.Count)"; size = 'extraLarge'; weight = 'bolder'; horizontalAlignment = 'center' }, @{ type = 'TextBlock'; text = 'Open Estimates'; size = 'small'; horizontalAlignment = 'center'; isSubtle = $true }) },
                                @{ type = 'Column'; width = 'stretch'; items = @(@{ type = 'TextBlock'; text = "$urgent"; size = 'extraLarge'; weight = 'bolder'; horizontalAlignment = 'center'; color = $statusColor }, @{ type = 'TextBlock'; text = 'Urgent Items'; size = 'small'; horizontalAlignment = 'center'; isSubtle = $true }) }
                            )
                        },
                        @{ type = 'TextBlock'; text = '🎯 AI Recommendations'; weight = 'bolder' }
                    ) + $recBlocks + @(
                        @{ type = 'FactSet'; facts = @(
                            @{ title = 'Unpaid Invoices'; value = "`$$("{0:N0}" -f $Data.UnpaidTotal)" },
                            @{ title = 'Emails Overnight'; value = "$($Data.EmailSummary.TotalProcessed)" },
                            @{ title = 'Week Revenue'; value = "`$$("{0:N0}" -f $Data.WeeklyMetrics.WeeklyRevenue)" }
                        ) }
                    )
                }
            }
        )
    }

    return ($payload | ConvertTo-Json -Depth 20)
}

function Send-TeamsReport {
    param(
        [Parameter(Mandatory = $true)][string]$WebhookUrl,
        [Parameter(Mandatory = $true)][string]$CardJson
    )

    try {
        Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $CardJson -ContentType 'application/json' -TimeoutSec 30 | Out-Null
        return @{ Success = $true }
    } catch {
        Write-Log -Level 'ERROR' -Message "Teams post failed: $($_.Exception.Message)"
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Send-EmailReport {
    param(
        [Parameter(Mandatory = $true)][string]$AccessToken,
        [Parameter(Mandatory = $true)][string]$FromMailbox,
        [Parameter(Mandatory = $true)][array]$ToRecipients,
        [Parameter(Mandatory = $true)][string]$Subject,
        [Parameter(Mandatory = $true)][string]$HtmlBody
    )

    $uri = "https://graph.microsoft.com/v1.0/users/$FromMailbox/sendMail"
    $headers = @{ Authorization = "Bearer $AccessToken"; 'Content-Type' = 'application/json' }
    $to = $ToRecipients | ForEach-Object { @{ emailAddress = @{ address = $_ } } }

    $payload = @{
        message = @{
            subject = $Subject
            body = @{ contentType = 'HTML'; content = $HtmlBody }
            toRecipients = $to
        }
        saveToSentItems = $true
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $payload -TimeoutSec 60 | Out-Null
        return @{ Success = $true }
    } catch {
        Write-Log -Level 'ERROR' -Message "Email send failed: $($_.Exception.Message)"
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Invoke-MorningReport {
    Write-Log -Message '═══════════════════════════════════════════════════════════════'
    Write-Log -Message "Phoenix AI Morning Report starting for $($script:ReportFullDate)"
    Write-Log -Message '═══════════════════════════════════════════════════════════════'

    $result = @{
        Status = 'Failed'
        ReportDate = $script:ReportDateString
        GeneratedAt = (Get-Date).ToString('o')
        Metrics = @{}
        Delivery = @{}
    }

    try {
        Write-Log -Message 'Loading credentials from Key Vault...'
        $kvToken = Get-ManagedIdentityToken -Resource 'https://vault.azure.net'
        $vaultName = (Get-AutomationVariable -Name 'VaultName').Trim()

        $creds = @{
            TenantId = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'SERVICETITAN-TENANT-ID' -AccessToken $kvToken
            STClientId = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'SERVICETITAN-CORE-CLIENT-ID' -AccessToken $kvToken
            STClientSecret = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'SERVICETITAN-CORE-SECRET' -AccessToken $kvToken
            STAppKey = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'SERVICETITAN-CORE-APP-KEY' -AccessToken $kvToken
            M365TenantId = (Get-AutomationVariable -Name 'TenantId').Trim()
            GraphClientId = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'GRAPH-CLIENT-ID' -AccessToken $kvToken
            GraphClientSecret = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'GRAPH-CLIENT-SECRET' -AccessToken $kvToken
        }

        Write-Log -Message 'Authenticating API tokens...'
        $creds.STToken = Get-ServiceTitanToken -ClientId $creds.STClientId -ClientSecret $creds.STClientSecret
        $creds.GraphToken = Get-GraphToken -TenantId $creds.M365TenantId -ClientId $creds.GraphClientId -ClientSecret $creds.GraphClientSecret
        $creds.STClientSecret = $null
        $creds.GraphClientSecret = $null

        Write-Log -Message 'Collecting source data...'
        $data = @{
            TodaysJobs = Get-TodaysAppointments -Creds $creds
            Estimates = Get-OpenEstimates -Creds $creds
            Invoices = Get-UnpaidInvoices -Creds $creds
            Technicians = Get-ActiveTechnicians -Creds $creds
            WeeklyMetrics = Get-WeeklyMetrics -Creds $creds
            EmailSummary = Get-OvernightEmailSummary
        }

        $data.UnpaidTotal = ($data.Invoices | Measure-Object -Property total -Sum).Sum
        if (-not $data.UnpaidTotal) { $data.UnpaidTotal = 0 }

        $data.EstimatesTotal = ($data.Estimates | Measure-Object -Property total -Sum).Sum
        if (-not $data.EstimatesTotal) { $data.EstimatesTotal = 0 }

        $overdue = $data.Invoices | Where-Object {
            if (-not $_.createdOn) { return $false }
            (($script:ReportDate - [DateTime]::Parse($_.createdOn)).Days -ge 30)
        }
        $data.OverdueCount = ($overdue | Measure-Object).Count
        $data.OverdueTotal = ($overdue | Measure-Object -Property total -Sum).Sum
        if (-not $data.OverdueTotal) { $data.OverdueTotal = 0 }

        $data.Recommendations = Get-AIRecommendations -Estimates $data.Estimates -Invoices $data.Invoices -Appointments $data.TodaysJobs

        Write-Log -Message 'Building report payloads...'
        $textReport = Build-TextReport -Data $data
        $htmlReport = Build-HtmlReport -Data $data
        $teamsCard = Build-TeamsCard -Data $data

        Write-Log -Message 'Delivering Teams + Email...'
        $teamsWebhook = (Get-AutomationVariable -Name 'TeamsWebhook_AIUpdates').Trim()
        $teamsResult = if ($teamsWebhook) {
            Send-TeamsReport -WebhookUrl $teamsWebhook -CardJson $teamsCard
        } else {
            @{ Success = $false; Error = 'TeamsWebhook_AIUpdates is empty' }
        }

        $emailResult = Send-EmailReport `
            -AccessToken $creds.GraphToken `
            -FromMailbox 'ai@phoenixelectric.life' `
            -ToRecipients $script:EmailRecipients `
            -Subject "🌅 Phoenix AI Morning Report - $($script:ReportFullDate)" `
            -HtmlBody $htmlReport

        $result.Status = 'Success'
        $result.Metrics = @{
            JobsToday = $data.TodaysJobs.Count
            OpenEstimates = $data.Estimates.Count
            UnpaidInvoices = $data.Invoices.Count
            Recommendations = $data.Recommendations.Count
        }
        $result.Delivery = @{
            Teams = $teamsResult.Success
            Email = $emailResult.Success
        }

        Write-Log -Message 'Morning Report generation complete.'

        Write-Output ''
        Write-Output '═══════════════════════════════════════════════════════════════'
        Write-Output 'TEXT REPORT OUTPUT'
        Write-Output '═══════════════════════════════════════════════════════════════'
        Write-Output $textReport

    } catch {
        Write-Log -Level 'ERROR' -Message "Morning Report failed: $($_.Exception.Message)"

        try {
            $errorWebhook = (Get-AutomationVariable -Name 'TeamsWebhook_UrgentAlerts').Trim()
            if ($errorWebhook) {
                $errorCard = @{
                    '@type' = 'MessageCard'
                    '@context' = 'http://schema.org/extensions'
                    themeColor = 'FF0000'
                    summary = 'Morning Report Failed'
                    sections = @(
                        @{
                            activityTitle = '⚠️ Morning Report Generation Failed'
                            activitySubtitle = (Get-Date -Format 'yyyy-MM-dd HH:mm')
                            text = "Error: $($_.Exception.Message)"
                            markdown = $true
                        }
                    )
                } | ConvertTo-Json -Depth 5

                Invoke-RestMethod -Uri $errorWebhook -Method Post -Body $errorCard -ContentType 'application/json' -TimeoutSec 30 | Out-Null
            }
        } catch {
            # Suppress notification failures during exception path.
        }

        $result.Error = $_.Exception.Message
    }

    return $result
}

$final = Invoke-MorningReport
Write-Output '---JSON_OUTPUT_START---'
Write-Output ($final | ConvertTo-Json -Depth 10 -Compress)
Write-Output '---JSON_OUTPUT_END---'
