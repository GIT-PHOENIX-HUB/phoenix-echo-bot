<#
.SYNOPSIS
    Phoenix AI Weekly Report Generator
.DESCRIPTION
    Generates comprehensive weekly intelligence rollup from Phoenix AI data sources.
    Aggregates weekly performance, identifies trends, and provides strategic insights.
.NOTES
    Runtime: PS72-Courier (PowerShell 7.2)
    Author: Phoenix Electric AI Team
    Version: 1.1.0

    SCHEDULE: Mondays 7:00 AM Mountain Time
#>

#Requires -Modules Az.Accounts, Az.KeyVault

[CmdletBinding()]
param(
    [string]$ReportWeekEnding,
    [switch]$DryRun = $false
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ============================================================================
# SECTION 1: CONFIGURATION
# ============================================================================

function Resolve-WeekEndingDate {
    param([string]$InputDate)

    if (-not [string]::IsNullOrWhiteSpace($InputDate)) {
        try {
            return [DateTime]::Parse($InputDate).Date
        }
        catch {
            throw "Invalid ReportWeekEnding date format: $InputDate"
        }
    }

    # Default for Monday 7 AM schedule: report prior full day/week ending yesterday.
    return (Get-Date).Date.AddDays(-1)
}

function Get-SafeRatio {
    param(
        [double]$Numerator,
        [double]$Denominator,
        [double]$Default = 0
    )

    if ($Denominator -le 0) {
        return $Default
    }

    return [math]::Round(($Numerator / $Denominator), 3)
}

$script:ReportDate = Resolve-WeekEndingDate -InputDate $ReportWeekEnding
$script:WeekEndDate = $script:ReportDate
$script:WeekStartDate = $script:ReportDate.AddDays(-6)
$script:ReportDateString = $script:ReportDate.ToString('yyyy-MM-dd')
$script:WeekStartString = $script:WeekStartDate.ToString('yyyy-MM-dd')
$script:ExecutionLog = @()
$script:TextReport = ''

$script:EmailRecipients = @(
    'shane@phoenixelectric.life',
    'smowbray@phoenixelectric.life'
)

$script:WeeklyTargets = @{
    Revenue = 25000
    JobsCompleted = 30
    EstimateConversion = 0.35
    CollectionRate = 0.90
    TechUtilization = 0.75
}

# ============================================================================
# SECTION 2: LOGGING
# ============================================================================

function Write-Log {
    param(
        [ValidateSet('INFO', 'WARN', 'ERROR', 'DEBUG')]
        [string]$Level = 'INFO',
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [string]$Agent = 'WEEKLY_REPORT'
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $script:ExecutionLog += [ordered]@{
        Timestamp = $timestamp
        Level = $Level
        Agent = $Agent
        Message = $Message
    }

    Write-Output "[$timestamp] $Level [$Agent]: $Message"
}

# ============================================================================
# SECTION 3: AUTHENTICATION (REST-based)
# ============================================================================

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
    $headers = @{
        Authorization = "Bearer $AccessToken"
        'Content-Type' = 'application/json'
    }

    $response = Invoke-RestMethod -Uri $secretUri -Headers $headers -Method Get -TimeoutSec 30
    return $response.value
}

function Get-ServiceTitanToken {
    param(
        [Parameter(Mandatory = $true)][string]$ClientId,
        [Parameter(Mandatory = $true)][string]$ClientSecret
    )

    $tokenUri = 'https://auth.servicetitan.io/connect/token'
    $bodyString = "grant_type=client_credentials&client_id=$([uri]::EscapeDataString($ClientId.Trim()))&client_secret=$([uri]::EscapeDataString($ClientSecret.Trim()))"

    $response = Invoke-RestMethod -Uri $tokenUri -Method Post -Body $bodyString -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 30
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

# ============================================================================
# SECTION 4: SERVICETITAN DATA COLLECTION
# ============================================================================

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
        $queryString = '?' + ($queryParts -join '&')
    }

    $uri = "https://api.servicetitan.io$fullEndpoint$queryString"

    $headers = @{
        Authorization = "Bearer $AccessToken"
        'ST-App-Key' = $AppKey
        'Content-Type' = 'application/json'
    }

    try {
        $response = Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -TimeoutSec 60
        return @{ Success = $true; Data = $response }
    }
    catch {
        Write-Log -Level 'ERROR' -Message "ServiceTitan API failed: $($_.Exception.Message)" -Agent 'ST'
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Get-WeeklyCompletedJobs {
    param([hashtable]$Creds)

    Write-Log -Level 'INFO' -Message 'Fetching completed jobs for the week...'

    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/jpm/v2/tenant/{tenant}/jobs' `
        -QueryParams @{
            completedOnOrAfter = "$($script:WeekStartString)T00:00:00Z"
            completedOnOrBefore = "$($script:ReportDateString)T23:59:59Z"
            pageSize = '500'
        } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    if ($result.Success) {
        $jobs = @($result.Data.data)
        Write-Log -Level 'INFO' -Message "Found $($jobs.Count) completed jobs this week"
        return $jobs
    }

    return @()
}

function Get-WeeklyEstimates {
    param([hashtable]$Creds)

    Write-Log -Level 'INFO' -Message 'Fetching estimates for the week...'

    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/sales/v2/tenant/{tenant}/estimates' `
        -QueryParams @{
            createdOnOrAfter = "$($script:WeekStartString)T00:00:00Z"
            createdOnOrBefore = "$($script:ReportDateString)T23:59:59Z"
            pageSize = '200'
        } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    if ($result.Success) {
        $estimates = @($result.Data.data)
        Write-Log -Level 'INFO' -Message "Found $($estimates.Count) estimates this week"
        return $estimates
    }

    return @()
}

function Get-WeeklyInvoices {
    param([hashtable]$Creds)

    Write-Log -Level 'INFO' -Message 'Fetching invoices for the week...'

    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/accounting/v2/tenant/{tenant}/invoices' `
        -QueryParams @{
            createdOnOrAfter = "$($script:WeekStartString)T00:00:00Z"
            createdOnOrBefore = "$($script:ReportDateString)T23:59:59Z"
            pageSize = '500'
        } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    if ($result.Success) {
        $invoices = @($result.Data.data)
        Write-Log -Level 'INFO' -Message "Found $($invoices.Count) invoices this week"
        return $invoices
    }

    return @()
}

function Get-WeeklyPayments {
    param([hashtable]$Creds)

    Write-Log -Level 'INFO' -Message 'Fetching payments for the week...'

    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/accounting/v2/tenant/{tenant}/payments' `
        -QueryParams @{
            createdOnOrAfter = "$($script:WeekStartString)T00:00:00Z"
            createdOnOrBefore = "$($script:ReportDateString)T23:59:59Z"
            pageSize = '500'
        } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    if ($result.Success) {
        $payments = @($result.Data.data)
        Write-Log -Level 'INFO' -Message "Found $($payments.Count) payments this week"
        return $payments
    }

    return @()
}

function Get-TechnicianStats {
    param([array]$Jobs)

    Write-Log -Level 'INFO' -Message 'Calculating technician statistics...'

    $techStats = @{}

    foreach ($job in $Jobs) {
        $techId = $job.technicianId
        if (-not $techId) { continue }

        if (-not $techStats.ContainsKey($techId)) {
            $techStats[$techId] = @{
                TechnicianId = $techId
                TechnicianName = $job.technicianName
                JobsCompleted = 0
                Revenue = 0
                TotalHours = 0
            }
        }

        $techStats[$techId].JobsCompleted++
        if ($job.total) { $techStats[$techId].Revenue += $job.total }
        if ($job.duration) { $techStats[$techId].TotalHours += ($job.duration / 60) }
    }

    return @($techStats.Values | Sort-Object Revenue -Descending)
}

function Get-OpenEstimatesAging {
    param([hashtable]$Creds)

    Write-Log -Level 'INFO' -Message 'Fetching open estimates aging...'

    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/sales/v2/tenant/{tenant}/estimates' `
        -QueryParams @{ status = 'Open'; pageSize = '200' } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    $aging = @{
        Under3Days = @()
        Days3to7 = @()
        Days7to14 = @()
        Over14Days = @()
    }

    if (-not $result.Success) {
        return $aging
    }

    foreach ($est in @($result.Data.data)) {
        if (-not $est.createdOn) { continue }

        $age = ($script:ReportDate - [DateTime]::Parse($est.createdOn)).Days
        $item = @{
            Id = $est.id
            CustomerName = $est.name
            Amount = $est.total
            DaysOld = $age
        }

        if ($age -lt 3) {
            $aging.Under3Days += $item
        }
        elseif ($age -lt 7) {
            $aging.Days3to7 += $item
        }
        elseif ($age -lt 14) {
            $aging.Days7to14 += $item
        }
        else {
            $aging.Over14Days += $item
        }
    }

    return $aging
}

function Get-OverdueInvoicesAging {
    param([hashtable]$Creds)

    Write-Log -Level 'INFO' -Message 'Fetching overdue invoices aging...'

    $result = Invoke-ServiceTitanAPI `
        -Endpoint '/accounting/v2/tenant/{tenant}/invoices' `
        -QueryParams @{ status = 'Unpaid'; pageSize = '200' } `
        -AccessToken $Creds.STToken `
        -AppKey $Creds.STAppKey `
        -TenantId $Creds.TenantId

    $aging = @{
        Current = @()
        Days1to30 = @()
        Days31to60 = @()
        Days61to90 = @()
        Over90Days = @()
    }

    if (-not $result.Success) {
        return $aging
    }

    foreach ($inv in @($result.Data.data)) {
        $ageBase = if ($inv.dueDate) { $inv.dueDate } elseif ($inv.createdOn) { $inv.createdOn } else { $null }
        if (-not $ageBase) { continue }

        $age = ($script:ReportDate - [DateTime]::Parse($ageBase)).Days
        $item = @{
            Id = $inv.id
            CustomerName = $inv.customerName
            Amount = $inv.total
            DaysOld = $age
        }

        if ($age -le 0) {
            $aging.Current += $item
        }
        elseif ($age -le 30) {
            $aging.Days1to30 += $item
        }
        elseif ($age -le 60) {
            $aging.Days31to60 += $item
        }
        elseif ($age -le 90) {
            $aging.Days61to90 += $item
        }
        else {
            $aging.Over90Days += $item
        }
    }

    return $aging
}

# ============================================================================
# SECTION 5: WEEKLY METRICS CALCULATION
# ============================================================================

function Calculate-WeeklyMetrics {
    param(
        [array]$Jobs,
        [array]$Estimates,
        [array]$Invoices,
        [array]$Payments
    )

    Write-Log -Level 'INFO' -Message 'Calculating weekly metrics...'

    $totalRevenue = ($Jobs | Where-Object { $_.total } | Measure-Object -Property total -Sum).Sum
    if (-not $totalRevenue) { $totalRevenue = 0 }

    $jobsCompleted = $Jobs.Count
    $avgJobValue = if ($jobsCompleted -gt 0) { [math]::Round(($totalRevenue / $jobsCompleted), 2) } else { 0 }

    $estimatesCreated = $Estimates.Count
    $estimatesTotalValue = ($Estimates | Where-Object { $_.total } | Measure-Object -Property total -Sum).Sum
    if (-not $estimatesTotalValue) { $estimatesTotalValue = 0 }

    $estimatesSold = ($Estimates | Where-Object { $_.status -eq 'Sold' }).Count
    $conversionRate = if ($estimatesCreated -gt 0) { [math]::Round(($estimatesSold / $estimatesCreated), 3) } else { 0 }

    $invoicedAmount = ($Invoices | Where-Object { $_.total } | Measure-Object -Property total -Sum).Sum
    if (-not $invoicedAmount) { $invoicedAmount = 0 }

    $collectedAmount = ($Payments | Where-Object { $_.amount } | Measure-Object -Property amount -Sum).Sum
    if (-not $collectedAmount) { $collectedAmount = 0 }

    $collectionRate = if ($invoicedAmount -gt 0) { [math]::Round(($collectedAmount / $invoicedAmount), 3) } else { 1.0 }

    $dailyRevenue = [ordered]@{}
    for ($i = 0; $i -le 6; $i++) {
        $day = $script:WeekStartDate.AddDays($i)
        $dayString = $day.ToString('yyyy-MM-dd')
        $dayName = $day.ToString('ddd', [System.Globalization.CultureInfo]::InvariantCulture)

        $dayJobs = $Jobs | Where-Object {
            $_.completedOn -and [DateTime]::Parse($_.completedOn).Date -eq $day.Date
        }

        $dayRevenue = ($dayJobs | Where-Object { $_.total } | Measure-Object -Property total -Sum).Sum
        if (-not $dayRevenue) { $dayRevenue = 0 }

        $dailyRevenue[$dayName] = @{
            Date = $dayString
            Jobs = $dayJobs.Count
            Revenue = $dayRevenue
        }
    }

    return @{
        TotalRevenue = $totalRevenue
        JobsCompleted = $jobsCompleted
        AverageJobValue = $avgJobValue

        EstimatesCreated = $estimatesCreated
        EstimatesTotalValue = $estimatesTotalValue
        EstimatesSold = $estimatesSold
        ConversionRate = $conversionRate

        InvoicedAmount = $invoicedAmount
        CollectedAmount = $collectedAmount
        CollectionRate = $collectionRate

        DailyBreakdown = $dailyRevenue

        RevenueVsTarget = Get-SafeRatio -Numerator $totalRevenue -Denominator $script:WeeklyTargets.Revenue
        JobsVsTarget = Get-SafeRatio -Numerator $jobsCompleted -Denominator $script:WeeklyTargets.JobsCompleted
        ConversionVsTarget = Get-SafeRatio -Numerator $conversionRate -Denominator $script:WeeklyTargets.EstimateConversion
        CollectionVsTarget = Get-SafeRatio -Numerator $collectionRate -Denominator $script:WeeklyTargets.CollectionRate
    }
}

# ============================================================================
# SECTION 6: AI INSIGHTS ENGINE
# ============================================================================

function Get-WeeklyInsights {
    param(
        [hashtable]$Metrics,
        [hashtable]$EstimateAging,
        [hashtable]$InvoiceAging,
        [array]$TechStats
    )

    Write-Log -Level 'INFO' -Message 'Generating AI insights...'

    $insights = @()
    $priority = 1

    if ($Metrics.RevenueVsTarget -lt 0.8) {
        $insights += @{
            Priority = $priority++
            Type = 'REVENUE_WARNING'
            Severity = 'high'
            Message = "Weekly revenue at $([math]::Round($Metrics.RevenueVsTarget * 100))% of target (`$$('{0:N0}' -f $Metrics.TotalRevenue) vs `$$('{0:N0}' -f $script:WeeklyTargets.Revenue))"
            Recommendation = 'Focus on closing open estimates and scheduling more jobs'
        }
    }
    elseif ($Metrics.RevenueVsTarget -ge 1.0) {
        $insights += @{
            Priority = $priority++
            Type = 'REVENUE_SUCCESS'
            Severity = 'positive'
            Message = "Weekly revenue exceeded target by $([math]::Round(($Metrics.RevenueVsTarget - 1) * 100))%!"
            Recommendation = 'Great week! Document what drove success and replicate'
        }
    }

    if ($Metrics.ConversionRate -lt 0.25) {
        $insights += @{
            Priority = $priority++
            Type = 'LOW_CONVERSION'
            Severity = 'high'
            Message = "Estimate conversion rate low at $([math]::Round($Metrics.ConversionRate * 100))%"
            Recommendation = 'Review estimate follow-up process and pricing strategy'
        }
    }

    $oldEstimatesCount = @($EstimateAging.Over14Days).Count
    $oldEstimatesValue = (@($EstimateAging.Over14Days) | Measure-Object -Property Amount -Sum).Sum
    if (-not $oldEstimatesValue) { $oldEstimatesValue = 0 }

    if ($oldEstimatesCount -gt 0) {
        $insights += @{
            Priority = $priority++
            Type = 'STALE_ESTIMATES'
            Severity = 'medium'
            Message = "$oldEstimatesCount estimates over 14 days old totaling `$$('{0:N0}' -f $oldEstimatesValue)"
            Recommendation = 'Prioritize follow-up calls this week or close as lost'
        }
    }

    if ($Metrics.CollectionRate -lt 0.8) {
        $outstanding = $Metrics.InvoicedAmount - $Metrics.CollectedAmount
        $insights += @{
            Priority = $priority++
            Type = 'COLLECTION_LAG'
            Severity = 'medium'
            Message = "Collection rate at $([math]::Round($Metrics.CollectionRate * 100))% - `$$('{0:N0}' -f $outstanding) outstanding"
            Recommendation = 'Review aging invoices and follow up on 30+ day accounts'
        }
    }

    $severeOverdue = @($InvoiceAging.Over90Days).Count
    $severeOverdueValue = (@($InvoiceAging.Over90Days) | Measure-Object -Property Amount -Sum).Sum
    if (-not $severeOverdueValue) { $severeOverdueValue = 0 }

    if ($severeOverdue -gt 0) {
        $insights += @{
            Priority = $priority++
            Type = 'CRITICAL_AR'
            Severity = 'high'
            Message = "$severeOverdue invoices over 90 days totaling `$$('{0:N0}' -f $severeOverdueValue)"
            Recommendation = 'Consider collection action or write-off review'
        }
    }

    if (@($TechStats).Count -gt 0) {
        $topTech = $TechStats[0]
        $insights += @{
            Priority = $priority++
            Type = 'TOP_PERFORMER'
            Severity = 'positive'
            Message = "Top performer: $($topTech.TechnicianName) with $($topTech.JobsCompleted) jobs and `$$('{0:N0}' -f $topTech.Revenue) revenue"
            Recommendation = 'Recognize achievement and share best practices'
        }
    }

    $orderedDays = @('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')
    $dailyValues = @()
    foreach ($day in $orderedDays) {
        if ($Metrics.DailyBreakdown.ContainsKey($day)) {
            $dailyValues += [double]$Metrics.DailyBreakdown[$day].Revenue
        }
    }

    if ($dailyValues.Count -ge 6) {
        $firstHalf = ($dailyValues[0..2] | Measure-Object -Sum).Sum
        $secondHalf = ($dailyValues[3..($dailyValues.Count - 1)] | Measure-Object -Sum).Sum

        if ($secondHalf -gt ($firstHalf * 1.2)) {
            $insights += @{
                Priority = $priority++
                Type = 'POSITIVE_TREND'
                Severity = 'positive'
                Message = 'Strong finish to the week - second half revenue 20%+ higher'
                Recommendation = 'Momentum is building - maintain pace'
            }
        }
        elseif ($firstHalf -gt ($secondHalf * 1.3)) {
            $insights += @{
                Priority = $priority++
                Type = 'DECLINING_TREND'
                Severity = 'medium'
                Message = 'Revenue dropped in second half of week'
                Recommendation = 'Review scheduling and ensure adequate job pipeline'
            }
        }
    }

    Write-Log -Level 'INFO' -Message "Generated $($insights.Count) insights"
    return $insights
}

# ============================================================================
# SECTION 7: REPORT BUILDERS
# ============================================================================

function Build-WeeklyTextReport {
    param([hashtable]$Data)

    $weekRange = "$($script:WeekStartDate.ToString('MMM d')) - $($script:WeekEndDate.ToString('MMM d, yyyy'))"

    $report = @"
===================================================================
  PHOENIX AI WEEKLY REPORT
  $weekRange
===================================================================

EXECUTIVE SUMMARY
-------------------------------------------------------------------
  Total Revenue:        `$$('{0:N0}' -f $Data.Metrics.TotalRevenue) ($([math]::Round($Data.Metrics.RevenueVsTarget * 100))% of target)
  Jobs Completed:       $($Data.Metrics.JobsCompleted)
  Average Job Value:    `$$('{0:N0}' -f $Data.Metrics.AverageJobValue)
  Estimate Conversion:  $([math]::Round($Data.Metrics.ConversionRate * 100))%
  Collection Rate:      $([math]::Round($Data.Metrics.CollectionRate * 100))%

DAILY BREAKDOWN
-------------------------------------------------------------------
"@

    foreach ($day in @('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')) {
        if ($Data.Metrics.DailyBreakdown.ContainsKey($day)) {
            $d = $Data.Metrics.DailyBreakdown[$day]
            $report += "  $day`: $($d.Jobs) jobs | `$$('{0:N0}' -f $d.Revenue)`n"
        }
    }

    $report += @"

AI INSIGHTS
-------------------------------------------------------------------
"@

    $insightNum = 1
    $riskInsights = @($Data.Insights | Where-Object { $_.Severity -ne 'positive' } | Select-Object -First 5)
    if ($riskInsights.Count -eq 0) {
        $report += "  1. [+] No critical risks detected this week.`n"
    }
    else {
        foreach ($insight in $riskInsights) {
            $severityIcon = switch ($insight.Severity) {
                'high' { '[!]' }
                'medium' { '[*]' }
                default { '[-]' }
            }
            $report += "  $insightNum. $severityIcon $($insight.Message)`n"
            $report += "     > $($insight.Recommendation)`n"
            $insightNum++
        }
    }

    $report += @"

WINS THIS WEEK
-------------------------------------------------------------------
"@

    $wins = @($Data.Insights | Where-Object { $_.Severity -eq 'positive' })
    if ($wins.Count -eq 0) {
        $report += "  [+] No positive flags captured this week.`n"
    }
    else {
        foreach ($win in $wins) {
            $report += "  [+] $($win.Message)`n"
        }
    }

    $report += @"

TECHNICIAN LEADERBOARD
-------------------------------------------------------------------
"@

    $rank = 1
    foreach ($tech in @($Data.TechStats | Select-Object -First 5)) {
        $report += "  $rank. $($tech.TechnicianName): $($tech.JobsCompleted) jobs | `$$('{0:N0}' -f $tech.Revenue)`n"
        $rank++
    }

    $report += @"

OPEN ESTIMATES AGING
-------------------------------------------------------------------
  Under 3 days:   $(@($Data.EstimateAging.Under3Days).Count) estimates
  3-7 days:       $(@($Data.EstimateAging.Days3to7).Count) estimates
  7-14 days:      $(@($Data.EstimateAging.Days7to14).Count) estimates
  Over 14 days:   $(@($Data.EstimateAging.Over14Days).Count) estimates [ACTION NEEDED]

AR AGING
-------------------------------------------------------------------
  Current:        $(@($Data.InvoiceAging.Current).Count) invoices
  1-30 days:      $(@($Data.InvoiceAging.Days1to30).Count) invoices
  31-60 days:     $(@($Data.InvoiceAging.Days31to60).Count) invoices
  61-90 days:     $(@($Data.InvoiceAging.Days61to90).Count) invoices
  Over 90 days:   $(@($Data.InvoiceAging.Over90Days).Count) invoices [CRITICAL]

===================================================================
  Report generated by Phoenix AI Core at $(Get-Date -Format 'h:mm tt')
  Have a great week!
===================================================================
"@

    return $report
}

function Build-WeeklyHtmlReport {
    param([hashtable]$Data)

    $weekRange = "$($script:WeekStartDate.ToString('MMM d')) - $($script:WeekEndDate.ToString('MMM d, yyyy'))"

    $revenueColor = if ($Data.Metrics.RevenueVsTarget -ge 1.0) { '#27ae60' } elseif ($Data.Metrics.RevenueVsTarget -ge 0.8) { '#f39c12' } else { '#e74c3c' }
    $conversionColor = if ($Data.Metrics.ConversionRate -ge 0.35) { '#27ae60' } elseif ($Data.Metrics.ConversionRate -ge 0.25) { '#f39c12' } else { '#e74c3c' }
    $collectionColor = if ($Data.Metrics.CollectionRate -ge 0.90) { '#27ae60' } elseif ($Data.Metrics.CollectionRate -ge 0.80) { '#f39c12' } else { '#e74c3c' }

    $html = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 750px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #1a5276, #2980b9); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 26px; }
        .header .date { opacity: 0.9; margin-top: 5px; font-size: 16px; }
        .content { padding: 25px; }
        .section { margin-bottom: 30px; }
        .section h2 { color: #1a5276; font-size: 18px; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 2px solid #2980b9; }
        .metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        .metric-card { background: #f8f9fa; border-radius: 6px; padding: 20px; text-align: center; border-left: 4px solid #2980b9; }
        .metric-value { font-size: 32px; font-weight: bold; color: #1a5276; }
        .metric-label { font-size: 12px; color: #7f8c8d; text-transform: uppercase; margin-top: 5px; }
        .metric-target { font-size: 11px; color: #95a5a6; margin-top: 3px; }
        .insight { padding: 15px; margin-bottom: 12px; border-radius: 6px; border-left: 4px solid; }
        .insight.high { background: #fdf2f2; border-left-color: #e74c3c; }
        .insight.medium { background: #fef9e7; border-left-color: #f39c12; }
        .insight.positive { background: #eafaf1; border-left-color: #27ae60; }
        .insight-title { font-weight: bold; margin-bottom: 5px; }
        .insight-action { font-size: 13px; color: #7f8c8d; font-style: italic; }
        .tech-table { width: 100%; border-collapse: collapse; }
        .tech-table th { background: #1a5276; color: white; padding: 12px; text-align: left; }
        .tech-table td { padding: 12px; border-bottom: 1px solid #eee; }
        .tech-table tr:hover { background: #f8f9fa; }
        .rank-badge { display: inline-block; width: 24px; height: 24px; border-radius: 50%; background: #2980b9; color: white; text-align: center; line-height: 24px; font-size: 12px; font-weight: bold; }
        .rank-badge.gold { background: #f1c40f; color: #333; }
        .rank-badge.silver { background: #95a5a6; }
        .rank-badge.bronze { background: #cd6133; }
        .aging-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
        .aging-card { background: #f8f9fa; border-radius: 6px; padding: 15px; }
        .aging-card h3 { margin: 0 0 15px 0; font-size: 14px; color: #1a5276; }
        .aging-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .aging-item:last-child { border-bottom: none; }
        .aging-critical { color: #e74c3c; font-weight: bold; }
        .daily-chart { display: flex; align-items: flex-end; justify-content: space-between; height: 120px; padding: 10px 0; }
        .daily-bar { flex: 1; margin: 0 5px; background: linear-gradient(to top, #2980b9, #3498db); border-radius: 4px 4px 0 0; position: relative; min-height: 20px; }
        .daily-bar span { position: absolute; bottom: -25px; left: 50%; transform: translateX(-50%); font-size: 11px; color: #7f8c8d; }
        .daily-bar .value { position: absolute; top: -20px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: bold; color: #1a5276; }
        .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #7f8c8d; border-radius: 0 0 8px 8px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Phoenix AI Weekly Report</h1>
            <div class="date">$weekRange</div>
        </div>

        <div class="content">
            <div class="section">
                <h2>Executive Summary</h2>
                <div class="metrics-grid">
                    <div class="metric-card" style="border-left-color: $revenueColor;">
                        <div class="metric-value" style="color: $revenueColor;">`$$('{0:N0}' -f $Data.Metrics.TotalRevenue)</div>
                        <div class="metric-label">Total Revenue</div>
                        <div class="metric-target">$([math]::Round($Data.Metrics.RevenueVsTarget * 100))% of `$$('{0:N0}' -f $script:WeeklyTargets.Revenue) target</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">$($Data.Metrics.JobsCompleted)</div>
                        <div class="metric-label">Jobs Completed</div>
                        <div class="metric-target">Avg `$$('{0:N0}' -f $Data.Metrics.AverageJobValue) per job</div>
                    </div>
                    <div class="metric-card" style="border-left-color: $conversionColor;">
                        <div class="metric-value" style="color: $conversionColor;">$([math]::Round($Data.Metrics.ConversionRate * 100))%</div>
                        <div class="metric-label">Estimate Conversion</div>
                        <div class="metric-target">$($Data.Metrics.EstimatesSold) of $($Data.Metrics.EstimatesCreated) sold</div>
                    </div>
                    <div class="metric-card" style="border-left-color: $collectionColor;">
                        <div class="metric-value" style="color: $collectionColor;">$([math]::Round($Data.Metrics.CollectionRate * 100))%</div>
                        <div class="metric-label">Collection Rate</div>
                        <div class="metric-target">`$$('{0:N0}' -f $Data.Metrics.CollectedAmount) collected</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">$($Data.Metrics.EstimatesCreated)</div>
                        <div class="metric-label">Estimates Created</div>
                        <div class="metric-target">`$$('{0:N0}' -f $Data.Metrics.EstimatesTotalValue) pipeline</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">`$$('{0:N0}' -f $Data.Metrics.InvoicedAmount)</div>
                        <div class="metric-label">Invoiced</div>
                        <div class="metric-target">This week</div>
                    </div>
                </div>
            </div>

            <div class="section">
                <h2>Daily Revenue</h2>
                <div class="daily-chart">
"@

    $maxRevenue = (@($Data.Metrics.DailyBreakdown.Values | ForEach-Object { $_.Revenue }) | Measure-Object -Maximum).Maximum
    if (-not $maxRevenue -or $maxRevenue -eq 0) { $maxRevenue = 1 }

    foreach ($day in @('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')) {
        if ($Data.Metrics.DailyBreakdown.ContainsKey($day)) {
            $d = $Data.Metrics.DailyBreakdown[$day]
            $height = [math]::Max(20, [math]::Round(($d.Revenue / $maxRevenue) * 100))
            $html += @"
                    <div class="daily-bar" style="height: ${height}px;">
                        <span class="value">`$$('{0:N0}' -f $d.Revenue)</span>
                        <span>$day</span>
                    </div>
"@
        }
    }

    $html += @"
                </div>
            </div>

            <div class="section">
                <h2>AI Insights & Recommendations</h2>
"@

    foreach ($insight in @($Data.Insights | Select-Object -First 6)) {
        $html += @"
                <div class="insight $($insight.Severity)">
                    <div class="insight-title">$($insight.Message)</div>
                    <div class="insight-action">$($insight.Recommendation)</div>
                </div>
"@
    }

    $html += @"
            </div>

            <div class="section">
                <h2>Technician Leaderboard</h2>
                <table class="tech-table">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Technician</th>
                            <th>Jobs</th>
                            <th>Revenue</th>
                        </tr>
                    </thead>
                    <tbody>
"@

    $rank = 1
    foreach ($tech in @($Data.TechStats | Select-Object -First 5)) {
        $badgeClass = switch ($rank) { 1 { 'gold' } 2 { 'silver' } 3 { 'bronze' } default { '' } }
        $html += @"
                        <tr>
                            <td><span class="rank-badge $badgeClass">$rank</span></td>
                            <td>$($tech.TechnicianName)</td>
                            <td>$($tech.JobsCompleted)</td>
                            <td>`$$('{0:N0}' -f $tech.Revenue)</td>
                        </tr>
"@
        $rank++
    }

    $html += @"
                    </tbody>
                </table>
            </div>

            <div class="section">
                <h2>Pipeline & AR Aging</h2>
                <div class="aging-grid">
                    <div class="aging-card">
                        <h3>Open Estimates</h3>
                        <div class="aging-item">
                            <span>Under 3 days</span>
                            <span>$(@($Data.EstimateAging.Under3Days).Count)</span>
                        </div>
                        <div class="aging-item">
                            <span>3-7 days</span>
                            <span>$(@($Data.EstimateAging.Days3to7).Count)</span>
                        </div>
                        <div class="aging-item">
                            <span>7-14 days</span>
                            <span>$(@($Data.EstimateAging.Days7to14).Count)</span>
                        </div>
                        <div class="aging-item aging-critical">
                            <span>Over 14 days</span>
                            <span>$(@($Data.EstimateAging.Over14Days).Count)</span>
                        </div>
                    </div>
                    <div class="aging-card">
                        <h3>Accounts Receivable</h3>
                        <div class="aging-item">
                            <span>Current</span>
                            <span>$(@($Data.InvoiceAging.Current).Count)</span>
                        </div>
                        <div class="aging-item">
                            <span>1-30 days</span>
                            <span>$(@($Data.InvoiceAging.Days1to30).Count)</span>
                        </div>
                        <div class="aging-item">
                            <span>31-60 days</span>
                            <span>$(@($Data.InvoiceAging.Days31to60).Count)</span>
                        </div>
                        <div class="aging-item">
                            <span>61-90 days</span>
                            <span>$(@($Data.InvoiceAging.Days61to90).Count)</span>
                        </div>
                        <div class="aging-item aging-critical">
                            <span>Over 90 days</span>
                            <span>$(@($Data.InvoiceAging.Over90Days).Count)</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="footer">
            Report generated by Phoenix AI Core at $(Get-Date -Format 'h:mm tt')<br>
            Have a great week!
        </div>
    </div>
</body>
</html>
"@

    return $html
}

function Build-WeeklyTeamsCard {
    param([hashtable]$Data)

    $weekRange = "$($script:WeekStartDate.ToString('MMM d')) - $($script:WeekEndDate.ToString('MMM d'))"
    $themeColor = if ($Data.Metrics.RevenueVsTarget -ge 1.0) { '27AE60' } elseif ($Data.Metrics.RevenueVsTarget -ge 0.8) { 'F39C12' } else { 'E74C3C' }

    $card = @{
        '@type' = 'MessageCard'
        '@context' = 'http://schema.org/extensions'
        themeColor = $themeColor
        summary = "Weekly Report: `$$('{0:N0}' -f $Data.Metrics.TotalRevenue)"
        sections = @(
            @{
                activityTitle = 'Phoenix AI Weekly Report'
                activitySubtitle = $weekRange
                facts = @(
                    @{ name = 'Total Revenue'; value = "`$$('{0:N0}' -f $Data.Metrics.TotalRevenue) ($([math]::Round($Data.Metrics.RevenueVsTarget * 100))%)" },
                    @{ name = 'Jobs Completed'; value = "$($Data.Metrics.JobsCompleted)" },
                    @{ name = 'Avg Job Value'; value = "`$$('{0:N0}' -f $Data.Metrics.AverageJobValue)" },
                    @{ name = 'Estimate Conversion'; value = "$([math]::Round($Data.Metrics.ConversionRate * 100))%" },
                    @{ name = 'Collection Rate'; value = "$([math]::Round($Data.Metrics.CollectionRate * 100))%" }
                )
                markdown = $true
            }
        )
    }

    $topInsight = @($Data.Insights | Where-Object { $_.Severity -ne 'positive' } | Select-Object -First 1)
    if ($topInsight.Count -gt 0) {
        $card.sections += @{
            activityTitle = 'Top Priority'
            text = "$($topInsight[0].Message)`n`n_$($topInsight[0].Recommendation)_"
        }
    }

    if (@($Data.TechStats).Count -gt 0) {
        $top = $Data.TechStats[0]
        $card.sections += @{
            activityTitle = 'Top Performer'
            text = "$($top.TechnicianName): $($top.JobsCompleted) jobs, `$$('{0:N0}' -f $top.Revenue)"
        }
    }

    return ($card | ConvertTo-Json -Depth 15)
}

# ============================================================================
# SECTION 8: DELIVERY FUNCTIONS
# ============================================================================

function Send-TeamsReport {
    param(
        [Parameter(Mandatory = $true)][string]$WebhookUrl,
        [Parameter(Mandatory = $true)][string]$CardJson
    )

    Write-Log -Level 'INFO' -Message 'Posting to Teams...'

    try {
        Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $CardJson -ContentType 'application/json' -TimeoutSec 30 | Out-Null
        Write-Log -Level 'INFO' -Message 'Teams post successful'
        return @{ Success = $true }
    }
    catch {
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

    Write-Log -Level 'INFO' -Message "Sending email report to $($ToRecipients.Count) recipients..."

    $uri = "https://graph.microsoft.com/v1.0/users/$FromMailbox/sendMail"
    $headers = @{
        Authorization = "Bearer $AccessToken"
        'Content-Type' = 'application/json'
    }

    $toRecipientsArray = $ToRecipients | ForEach-Object {
        @{ emailAddress = @{ address = $_ } }
    }

    $emailBody = @{
        message = @{
            subject = $Subject
            body = @{
                contentType = 'HTML'
                content = $HtmlBody
            }
            toRecipients = $toRecipientsArray
        }
        saveToSentItems = $true
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $emailBody -TimeoutSec 60 | Out-Null
        Write-Log -Level 'INFO' -Message 'Email sent successfully'
        return @{ Success = $true }
    }
    catch {
        Write-Log -Level 'ERROR' -Message "Email send failed: $($_.Exception.Message)"
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# ============================================================================
# SECTION 9: MAIN EXECUTION
# ============================================================================

Write-Log -Level 'INFO' -Message '==================================================================='
Write-Log -Level 'INFO' -Message 'Phoenix AI Weekly Report Generator starting...'
Write-Log -Level 'INFO' -Message "Week: $($script:WeekStartDate.ToString('MMM d')) - $($script:WeekEndDate.ToString('MMM d, yyyy'))"
Write-Log -Level 'INFO' -Message "DryRun: $DryRun"
Write-Log -Level 'INFO' -Message '==================================================================='

$teamsResult = $null
$emailResult = $null

try {
    Write-Log -Level 'INFO' -Message 'Step 1: Loading credentials from Key Vault...'

    $kvToken = Get-ManagedIdentityToken -Resource 'https://vault.azure.net'
    $vaultName = (Get-AutomationVariable -Name 'VaultName').Trim()

    $credentials = @{
        TenantId = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'SERVICETITAN-TENANT-ID' -AccessToken $kvToken
        STClientId = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'SERVICETITAN-CORE-CLIENT-ID' -AccessToken $kvToken
        STClientSecret = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'SERVICETITAN-CORE-SECRET' -AccessToken $kvToken
        STAppKey = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'SERVICETITAN-CORE-APP-KEY' -AccessToken $kvToken
        M365TenantId = (Get-AutomationVariable -Name 'TenantId').Trim()
        GraphClientId = (Get-AutomationVariable -Name 'CourierAppId').Trim()
        GraphClientSecret = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName 'PhoenixMailCourierSecret' -AccessToken $kvToken
    }

    Write-Log -Level 'INFO' -Message 'Credentials loaded successfully'

    Write-Log -Level 'INFO' -Message 'Step 2: Authenticating to APIs...'

    $credentials.STToken = Get-ServiceTitanToken -ClientId $credentials.STClientId -ClientSecret $credentials.STClientSecret
    $credentials.GraphToken = Get-GraphToken -TenantId $credentials.M365TenantId -ClientId $credentials.GraphClientId -ClientSecret $credentials.GraphClientSecret

    $credentials.STClientSecret = $null
    $credentials.GraphClientSecret = $null

    Write-Log -Level 'INFO' -Message 'API authentication successful'

    Write-Log -Level 'INFO' -Message 'Step 3: Collecting weekly data...'

    $jobs = Get-WeeklyCompletedJobs -Creds $credentials
    $estimates = Get-WeeklyEstimates -Creds $credentials
    $invoices = Get-WeeklyInvoices -Creds $credentials
    $payments = Get-WeeklyPayments -Creds $credentials
    $techStats = Get-TechnicianStats -Jobs $jobs
    $estimateAging = Get-OpenEstimatesAging -Creds $credentials
    $invoiceAging = Get-OverdueInvoicesAging -Creds $credentials

    Write-Log -Level 'INFO' -Message 'Data collection complete'

    Write-Log -Level 'INFO' -Message 'Step 4: Calculating metrics...'
    $metrics = Calculate-WeeklyMetrics -Jobs $jobs -Estimates $estimates -Invoices $invoices -Payments $payments

    Write-Log -Level 'INFO' -Message 'Step 5: Generating AI insights...'
    $insights = Get-WeeklyInsights -Metrics $metrics -EstimateAging $estimateAging -InvoiceAging $invoiceAging -TechStats $techStats

    $reportData = @{
        Metrics = $metrics
        Insights = $insights
        TechStats = $techStats
        EstimateAging = $estimateAging
        InvoiceAging = $invoiceAging
        WeekStart = $script:WeekStartString
        WeekEnd = $script:ReportDateString
    }

    Write-Log -Level 'INFO' -Message 'Step 6: Building reports...'

    $script:TextReport = Build-WeeklyTextReport -Data $reportData
    $htmlReport = Build-WeeklyHtmlReport -Data $reportData
    $teamsCard = Build-WeeklyTeamsCard -Data $reportData

    Write-Log -Level 'INFO' -Message 'Step 7: Delivering reports...'

    if (-not $DryRun) {
        try {
            $teamsWebhook = (Get-AutomationVariable -Name 'TeamsWebhook_AIUpdates').Trim()
            if ($teamsWebhook) {
                $teamsResult = Send-TeamsReport -WebhookUrl $teamsWebhook -CardJson $teamsCard
            }
            else {
                Write-Log -Level 'WARN' -Message 'Teams webhook variable empty: TeamsWebhook_AIUpdates'
            }
        }
        catch {
            Write-Log -Level 'WARN' -Message "Teams webhook not configured: $($_.Exception.Message)"
        }

        $emailResult = Send-EmailReport `
            -AccessToken $credentials.GraphToken `
            -FromMailbox 'ai@phoenixelectric.life' `
            -ToRecipients $script:EmailRecipients `
            -Subject "Phoenix AI Weekly Report - $($script:WeekStartDate.ToString('MMM d')) to $($script:WeekEndDate.ToString('MMM d, yyyy'))" `
            -HtmlBody $htmlReport
    }
    else {
        Write-Log -Level 'INFO' -Message 'DryRun mode - skipping delivery'
    }

    Write-Log -Level 'INFO' -Message '==================================================================='
    Write-Log -Level 'INFO' -Message 'Weekly Report generation complete!'
    Write-Log -Level 'INFO' -Message '==================================================================='

    $result = @{
        Status = 'Success'
        WeekStart = $script:WeekStartString
        WeekEnd = $script:ReportDateString
        GeneratedAt = (Get-Date -Format 'o')
        Metrics = @{
            TotalRevenue = $metrics.TotalRevenue
            JobsCompleted = $metrics.JobsCompleted
            EstimateConversion = $metrics.ConversionRate
            CollectionRate = $metrics.CollectionRate
        }
        Insights = $insights.Count
        Delivery = @{
            Teams = if ($teamsResult) { $teamsResult.Success } else { $false }
            Email = if ($emailResult) { $emailResult.Success } else { $false }
        }
        DryRun = $DryRun.IsPresent
    }
}
catch {
    Write-Log -Level 'ERROR' -Message "Weekly Report generation failed: $($_.Exception.Message)"

    $result = @{
        Status = 'Failed'
        Error = $_.Exception.Message
        WeekEnd = $script:ReportDateString
    }
}

$jsonOutput = $result | ConvertTo-Json -Depth 10 -Compress
Write-Output '---JSON_OUTPUT_START---'
Write-Output $jsonOutput
Write-Output '---JSON_OUTPUT_END---'

Write-Output ''
Write-Output '==================================================================='
Write-Output 'TEXT REPORT OUTPUT'
Write-Output '==================================================================='
if ([string]::IsNullOrWhiteSpace($script:TextReport)) {
    Write-Output 'No text report generated.'
}
else {
    Write-Output $script:TextReport
}
