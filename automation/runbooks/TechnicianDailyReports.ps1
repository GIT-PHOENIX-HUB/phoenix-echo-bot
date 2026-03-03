<#
.SYNOPSIS
    Phoenix AI Technician Daily Reports
.DESCRIPTION
    Generates daily performance reports for all technicians, tracks productivity
    metrics, identifies issues, and delivers insights to management. Includes
    individual tech reports, team summaries, revenue tracking, efficiency alerts,
    and automated email/Teams delivery.

    Key Features:
    - Individual technician daily reports with job details
    - Team summary with rankings and performance badges
    - Revenue vs target tracking
    - Utilization and efficiency metrics
    - Overtime warnings
    - Job efficiency variance alerts
    - HTML email reports + Teams notifications
    - Full history stored in Cosmos DB

    Modes:
    - daily: Full team report with email delivery (default)
    - single: Single technician report
    - team: Team summary only (no email)
    - weekly: Weekly summary report

.NOTES
    Runtime: PS72-Courier (PowerShell 7.2)
    Author: Phoenix Electric AI Team
    Version: 1.1.0
    Source: Part 11 of Phoenix AI Playbook

    RUNS: Daily at 6 PM Mountain (after field work complete)

    Cosmos Container: tech_daily

    Authentication Flow:
    1. Managed Identity -> Key Vault access token
    2. Key Vault -> ServiceTitan & Graph credentials
    3. ServiceTitan -> Technician/Job/Appointment data
    4. Graph -> Email delivery
    5. Cosmos DB -> Report storage
#>

#Requires -Modules Az.Accounts, Az.KeyVault

[CmdletBinding()]
param(
    [ValidateSet("daily", "weekly", "single", "team")]
    [string]$Mode = "daily",

    [string]$TechnicianId = "",

    [string]$ReportDate = ""
)

# ============================================================================
# SECTION 1: CONFIGURATION
# ============================================================================

$script:ReportConfig = @{
    # Working hours
    StandardWorkday = 8.0
    OvertimeThreshold = 40.0

    # Performance thresholds
    TargetUtilization = 0.75          # 75% billable time
    TargetOnTimeArrival = 0.90        # 90% on-time
    TargetFirstTimeFix = 0.95         # 95% first-time fix
    MaxCallbackRate = 0.05            # 5% callback tolerance

    # Efficiency variance alert
    EfficiencyVarianceAlert = 0.25    # Alert if job takes 25%+ longer than estimate

    # Revenue targets (daily per tech)
    DailyRevenueTarget = 1500.00
    WeeklyRevenueTarget = 6500.00

    # Report recipients
    Recipients = @(
        "shane@phoenixelectric.life",
        "jmaier@phoenixelectric.life"
    )

    # Retry configuration
    MaxRetries = 3
    RetryDelayMs = 2000
}

$script:ReportStats = @{
    TechniciansProcessed = 0
    TotalJobs = 0
    TotalRevenue = 0
    TotalHours = 0
    Alerts = @()
    Errors = @()
}

# ============================================================================
# SECTION 2: LOGGING
# ============================================================================

function Write-Log {
    param(
        [ValidateSet("INFO", "WARN", "ERROR", "CRITICAL", "DEBUG")]
        [string]$Level = "INFO",
        [string]$Message,
        [string]$Agent = "TechReports"
    )

    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logLine = "[$timestamp] [$Level] [$Agent] $Message"

    switch ($Level) {
        "WARN" { Write-Warning $logLine }
        default { Write-Output $logLine }
    }
}

# ============================================================================
# SECTION 3: AUTHENTICATION
# ============================================================================

function Get-ManagedIdentityToken {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Resource
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $tokenUri = "$($env:IDENTITY_ENDPOINT)?resource=$Resource&api-version=2019-08-01"
            $headers = @{ "X-IDENTITY-HEADER" = $env:IDENTITY_HEADER }
            $response = Invoke-RestMethod -Uri $tokenUri -Headers $headers -Method Get -TimeoutSec 30
            return $response.access_token
        }
        catch {
            Write-Log "WARN" "Managed identity token attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                throw "Failed to get managed identity token after $maxRetries attempts: $($_.Exception.Message)"
            }
        }
    }
}

function Get-KeyVaultSecretREST {
    param(
        [string]$VaultName,
        [string]$SecretName,
        [string]$AccessToken
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $secretUri = "https://$($VaultName.Trim()).vault.azure.net/secrets/$($SecretName.Trim())?api-version=7.4"
            $headers = @{
                "Authorization" = "Bearer $AccessToken"
                "Content-Type" = "application/json"
            }
            $response = Invoke-RestMethod -Uri $secretUri -Headers $headers -Method Get -TimeoutSec 30
            return $response.value
        }
        catch {
            Write-Log "WARN" "Key Vault secret '$SecretName' attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                throw "Failed to get secret '$SecretName' after $maxRetries attempts: $($_.Exception.Message)"
            }
        }
    }
}

function Get-ServiceTitanToken {
    param(
        [string]$ClientId,
        [string]$ClientSecret
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $tokenUri = "https://auth.servicetitan.io/connect/token"
            $body = "grant_type=client_credentials&client_id=$([uri]::EscapeDataString($ClientId.Trim()))&client_secret=$([uri]::EscapeDataString($ClientSecret.Trim()))"
            $response = Invoke-RestMethod -Uri $tokenUri -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -TimeoutSec 30
            return $response.access_token
        }
        catch {
            Write-Log "WARN" "ServiceTitan token attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                throw "Failed to get ServiceTitan token after $maxRetries attempts: $($_.Exception.Message)"
            }
        }
    }
}

function Get-GraphToken {
    param(
        [string]$TenantId,
        [string]$ClientId,
        [string]$ClientSecret
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $tokenUri = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
            $body = @{
                grant_type = "client_credentials"
                client_id = $ClientId.Trim()
                client_secret = $ClientSecret.Trim()
                scope = "https://graph.microsoft.com/.default"
            }
            $response = Invoke-RestMethod -Uri $tokenUri -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -TimeoutSec 30
            return $response.access_token
        }
        catch {
            Write-Log "WARN" "Graph token attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                throw "Failed to get Graph token after $maxRetries attempts: $($_.Exception.Message)"
            }
        }
    }
}

# ============================================================================
# SECTION 4: SERVICETITAN DATA RETRIEVAL
# ============================================================================

function Get-ActiveTechnicians {
    param(
        [hashtable]$Creds
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    $uri = "https://api.servicetitan.io/settings/v2/tenant/$($Creds.TenantId)/technicians?active=true"

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 30
            Write-Log "INFO" "Retrieved $($response.data.Count) active technicians"
            return @($response.data)
        }
        catch {
            Write-Log "WARN" "Get technicians attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                Write-Log "ERROR" "Failed to get technicians after $maxRetries attempts"
                return @()
            }
        }
    }
}

function Get-TechnicianJobs {
    param(
        [int]$TechnicianId,
        [DateTime]$Date,
        [hashtable]$Creds
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    $startDate = $Date.ToString("yyyy-MM-dd")
    $endDate = $Date.AddDays(1).ToString("yyyy-MM-dd")

    $uri = "https://api.servicetitan.io/jpm/v2/tenant/$($Creds.TenantId)/jobs?technicianId=$TechnicianId&completedOnOrAfter=$startDate&completedBefore=$endDate&pageSize=100"

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 60
            return @($response.data)
        }
        catch {
            Write-Log "WARN" "Get jobs for tech $TechnicianId attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                Write-Log "ERROR" "Failed to get jobs for tech $TechnicianId after $maxRetries attempts"
                return @()
            }
        }
    }
}

function Get-TechnicianAppointments {
    param(
        [int]$TechnicianId,
        [DateTime]$Date,
        [hashtable]$Creds
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    $startDate = $Date.ToString("yyyy-MM-dd")
    $endDate = $Date.AddDays(1).ToString("yyyy-MM-dd")

    $uri = "https://api.servicetitan.io/dispatch/v2/tenant/$($Creds.TenantId)/appointments?technicianId=$TechnicianId&startsOnOrAfter=$startDate&startsBefore=$endDate"

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 30
            return @($response.data)
        }
        catch {
            Write-Log "WARN" "Get appointments for tech $TechnicianId attempt $attempt failed"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                return @()
            }
        }
    }
}

function Get-TechnicianTimesheet {
    param(
        [int]$TechnicianId,
        [DateTime]$Date,
        [hashtable]$Creds
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    $dateStr = $Date.ToString("yyyy-MM-dd")
    $uri = "https://api.servicetitan.io/payroll/v2/tenant/$($Creds.TenantId)/timesheets?technicianId=$TechnicianId&date=$dateStr"

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 30
            return @($response.data)
        }
        catch {
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                return @()
            }
        }
    }
}

function Get-WeekToDateStats {
    param(
        [int]$TechnicianId,
        [DateTime]$Date,
        [hashtable]$Creds
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    # Get start of week (Monday)
    $dayOfWeek = [int]$Date.DayOfWeek
    if ($dayOfWeek -eq 0) { $dayOfWeek = 7 }  # Sunday = 7
    $weekStart = $Date.AddDays(-($dayOfWeek - 1))

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    $startDate = $weekStart.ToString("yyyy-MM-dd")
    $endDate = $Date.AddDays(1).ToString("yyyy-MM-dd")

    $uri = "https://api.servicetitan.io/jpm/v2/tenant/$($Creds.TenantId)/jobs?technicianId=$TechnicianId&completedOnOrAfter=$startDate&completedBefore=$endDate&pageSize=200"

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 60
            $jobs = @($response.data)

            $totalRevenue = ($jobs | Measure-Object -Property total -Sum).Sum
            if (-not $totalRevenue) { $totalRevenue = 0 }

            # Calculate total hours from job durations
            $totalHours = 0
            foreach ($job in $jobs) {
                if ($job.completedOn -and $job.arrivedOn) {
                    try {
                        $arrived = [DateTime]::Parse($job.arrivedOn)
                        $completed = [DateTime]::Parse($job.completedOn)
                        $totalHours += ($completed - $arrived).TotalHours
                    }
                    catch {
                        # Skip jobs with invalid dates
                    }
                }
            }

            return @{
                JobsCompleted = $jobs.Count
                Revenue = $totalRevenue
                HoursWorked = $totalHours
            }
        }
        catch {
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                return @{ JobsCompleted = 0; Revenue = 0; HoursWorked = 0 }
            }
        }
    }
}

function Get-MonthToDateStats {
    param(
        [int]$TechnicianId,
        [DateTime]$Date,
        [hashtable]$Creds
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    # Get start of month
    $monthStart = [DateTime]::new($Date.Year, $Date.Month, 1)

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    $startDate = $monthStart.ToString("yyyy-MM-dd")
    $endDate = $Date.AddDays(1).ToString("yyyy-MM-dd")

    $uri = "https://api.servicetitan.io/jpm/v2/tenant/$($Creds.TenantId)/jobs?technicianId=$TechnicianId&completedOnOrAfter=$startDate&completedBefore=$endDate&pageSize=500"

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 90
            $jobs = @($response.data)

            $totalRevenue = ($jobs | Measure-Object -Property total -Sum).Sum
            if (-not $totalRevenue) { $totalRevenue = 0 }

            $totalHours = 0
            foreach ($job in $jobs) {
                if ($job.completedOn -and $job.arrivedOn) {
                    try {
                        $arrived = [DateTime]::Parse($job.arrivedOn)
                        $completed = [DateTime]::Parse($job.completedOn)
                        $totalHours += ($completed - $arrived).TotalHours
                    }
                    catch {
                        # Skip jobs with invalid dates
                    }
                }
            }

            return @{
                JobsCompleted = $jobs.Count
                Revenue = $totalRevenue
                HoursWorked = $totalHours
            }
        }
        catch {
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                return @{ JobsCompleted = 0; Revenue = 0; HoursWorked = 0 }
            }
        }
    }
}

function Get-TechnicianCallbacks {
    param(
        [int]$TechnicianId,
        [DateTime]$Date,
        [hashtable]$Creds,
        [int]$LookbackDays = 30
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    $startDate = $Date.AddDays(-$LookbackDays).ToString("yyyy-MM-dd")
    $endDate = $Date.AddDays(1).ToString("yyyy-MM-dd")

    # Get jobs with callback flag or recall type
    $uri = "https://api.servicetitan.io/jpm/v2/tenant/$($Creds.TenantId)/jobs?technicianId=$TechnicianId&completedOnOrAfter=$startDate&completedBefore=$endDate&jobTypes=Recall&pageSize=100"

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 60
            return @($response.data)
        }
        catch {
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                return @()
            }
        }
    }
}

# ============================================================================
# SECTION 5: COSMOS DB OPERATIONS
# ============================================================================

function Get-CosmosAuthHeader {
    param(
        [string]$Verb,
        [string]$ResourceType,
        [string]$ResourceLink,
        [string]$MasterKey,
        [string]$Date
    )

    $keyBytes = [Convert]::FromBase64String($MasterKey)
    $text = "$($Verb.ToLower())`n$($ResourceType.ToLower())`n$ResourceLink`n$($Date.ToLower())`n`n"
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = $keyBytes
    $hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($text))
    $sig = [Convert]::ToBase64String($hash)
    return [uri]::EscapeDataString("type=master&ver=1.0&sig=$sig")
}

function Set-TechnicianDailyReport {
    param(
        [hashtable]$Report,
        [hashtable]$Creds
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/tech_daily"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-partitionkey" = '["tech_daily"]'
        "x-ms-documentdb-is-upsert" = "True"
        "Content-Type" = "application/json"
    }

    $body = $Report | ConvertTo-Json -Depth 15

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -TimeoutSec 30 | Out-Null
            Write-Log "DEBUG" "Saved report for tech $($Report.technicianId)"
            return $true
        }
        catch {
            Write-Log "WARN" "Cosmos save attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                Write-Log "ERROR" "Failed to save tech report to Cosmos after $maxRetries attempts"
                return $false
            }
        }
    }
}

function Set-TeamDailyReport {
    param(
        [hashtable]$Report,
        [hashtable]$Creds
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/tech_daily"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-partitionkey" = '["team_daily"]'
        "x-ms-documentdb-is-upsert" = "True"
        "Content-Type" = "application/json"
    }

    $body = $Report | ConvertTo-Json -Depth 15

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -TimeoutSec 30 | Out-Null
            Write-Log "DEBUG" "Saved team daily report"
            return $true
        }
        catch {
            Write-Log "WARN" "Cosmos team report save attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                Write-Log "ERROR" "Failed to save team report to Cosmos after $maxRetries attempts"
                return $false
            }
        }
    }
}

function Get-HistoricalTechReport {
    param(
        [int]$TechnicianId,
        [string]$DateStr,
        [hashtable]$Creds
    )

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/tech_daily"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-partitionkey" = '["tech_daily"]'
        "Content-Type" = "application/query+json"
        "x-ms-documentdb-isquery" = "true"
    }

    $reportId = "tech_daily_$($TechnicianId)_$($DateStr -replace '-', '')"
    $query = @{
        query = "SELECT * FROM c WHERE c.id = @id"
        parameters = @(
            @{ name = "@id"; value = $reportId }
        )
    } | ConvertTo-Json -Depth 5

    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $query -TimeoutSec 30
        if ($response.Documents.Count -gt 0) {
            return $response.Documents[0]
        }
        return $null
    }
    catch {
        return $null
    }
}

# ============================================================================
# SECTION 6: REPORT GENERATION
# ============================================================================

function Build-TechnicianDailyReport {
    param(
        [object]$Technician,
        [DateTime]$Date,
        [hashtable]$Creds
    )

    $techId = $Technician.id
    $dateStr = $Date.ToString("yyyy-MM-dd")

    Write-Log "INFO" "Building report for $($Technician.name) - $dateStr"

    # Get jobs for the day
    $jobs = Get-TechnicianJobs -TechnicianId $techId -Date $Date -Creds $Creds
    $appointments = Get-TechnicianAppointments -TechnicianId $techId -Date $Date -Creds $Creds
    $weekStats = Get-WeekToDateStats -TechnicianId $techId -Date $Date -Creds $Creds
    $monthStats = Get-MonthToDateStats -TechnicianId $techId -Date $Date -Creds $Creds
    $callbacks = Get-TechnicianCallbacks -TechnicianId $techId -Date $Date -Creds $Creds

    # Calculate metrics
    $totalRevenue = ($jobs | Measure-Object -Property total -Sum).Sum
    if (-not $totalRevenue) { $totalRevenue = 0 }

    $totalHours = 0
    $estimatedHours = 0
    $onTimeCount = 0
    $jobDetails = @()
    $alerts = @()

    foreach ($job in $jobs) {
        # Calculate job duration
        $duration = 0
        if ($job.completedOn -and $job.arrivedOn) {
            try {
                $arrived = [DateTime]::Parse($job.arrivedOn)
                $completed = [DateTime]::Parse($job.completedOn)
                $duration = ($completed - $arrived).TotalHours
            }
            catch {
                $duration = 0
            }
        }

        $totalHours += $duration

        # Estimate (if available)
        $estHours = if ($job.estimatedDuration) { $job.estimatedDuration / 60 } else { 2.0 }
        $estimatedHours += $estHours

        # On-time arrival check (within 15 minutes)
        if ($job.scheduledStart -and $job.arrivedOn) {
            try {
                $scheduled = [DateTime]::Parse($job.scheduledStart)
                $arrived = [DateTime]::Parse($job.arrivedOn)
                if ($arrived -le $scheduled.AddMinutes(15)) {
                    $onTimeCount++
                }
            }
            catch {
                # Skip invalid dates
            }
        }

        # Efficiency variance check
        if ($duration -gt 0 -and $estHours -gt 0 -and $duration -gt $estHours * (1 + $script:ReportConfig.EfficiencyVarianceAlert)) {
            $alerts += @{
                type = "efficiency_variance"
                message = "Job #$($job.number) took $([math]::Round($duration, 1))h vs $([math]::Round($estHours, 1))h estimated"
                severity = "low"
                jobId = $job.id
                jobNumber = $job.number
            }
        }

        # Build job detail record
        $jobDetails += @{
            jobId = $job.id
            jobNumber = $job.number
            customer = $job.customerName
            address = if ($job.location -and $job.location.address) { $job.location.address.street } else { "" }
            type = $job.jobType
            summary = $job.summary
            businessUnit = $job.businessUnit
            scheduledStart = $job.scheduledStart
            actualStart = $job.arrivedOn
            actualEnd = $job.completedOn
            estimatedHours = $estHours
            actualHours = [math]::Round($duration, 2)
            revenue = $job.total
            status = $job.status
        }
    }

    # Calculate daily metrics
    $jobCount = $jobs.Count
    $avgJobValue = if ($jobCount -gt 0) { $totalRevenue / $jobCount } else { 0 }
    $avgJobDuration = if ($jobCount -gt 0) { $totalHours / $jobCount } else { 0 }
    $onTimeRate = if ($jobCount -gt 0) { $onTimeCount / $jobCount } else { 1.0 }
    $efficiency = if ($totalHours -gt 0) { $estimatedHours / $totalHours } else { 1.0 }
    $utilization = if ($script:ReportConfig.StandardWorkday -gt 0) { $totalHours / $script:ReportConfig.StandardWorkday } else { 0 }

    # Callback rate (30-day lookback)
    $callbackRate = 0
    if ($monthStats.JobsCompleted -gt 0 -and $callbacks.Count -gt 0) {
        $callbackRate = $callbacks.Count / $monthStats.JobsCompleted
    }

    # Revenue target check
    if ($totalRevenue -lt $script:ReportConfig.DailyRevenueTarget * 0.75) {
        $alerts += @{
            type = "low_revenue"
            message = "Daily revenue `$$([math]::Round($totalRevenue, 0)) below 75% of target (`$$($script:ReportConfig.DailyRevenueTarget))"
            severity = "medium"
        }
    }

    # Overtime check
    if ($weekStats.HoursWorked -gt $script:ReportConfig.OvertimeThreshold - 8) {
        $alerts += @{
            type = "overtime_warning"
            message = "Approaching overtime: $([math]::Round($weekStats.HoursWorked, 1))h this week (threshold: $($script:ReportConfig.OvertimeThreshold)h)"
            severity = "medium"
        }
    }

    # On-time arrival check
    if ($onTimeRate -lt $script:ReportConfig.TargetOnTimeArrival -and $jobCount -gt 0) {
        $alerts += @{
            type = "late_arrivals"
            message = "On-time arrival rate $("{0:P0}" -f $onTimeRate) below target $("{0:P0}" -f $script:ReportConfig.TargetOnTimeArrival)"
            severity = "low"
        }
    }

    # Callback rate check
    if ($callbackRate -gt $script:ReportConfig.MaxCallbackRate) {
        $alerts += @{
            type = "high_callback_rate"
            message = "Callback rate $("{0:P1}" -f $callbackRate) exceeds threshold $("{0:P0}" -f $script:ReportConfig.MaxCallbackRate)"
            severity = "high"
        }
    }

    # Build report document
    $report = @{
        id = "tech_daily_$($techId)_$($dateStr -replace '-', '')"
        technicianId = $techId
        date = $dateStr

        technician = @{
            id = $techId
            name = $Technician.name
            email = $Technician.email
            role = if ($Technician.role) { $Technician.role } else { "Technician" }
        }

        daily = @{
            jobsCompleted = $jobCount
            jobsAssigned = $appointments.Count
            completionRate = if ($appointments.Count -gt 0) { [math]::Round($jobCount / $appointments.Count, 2) } else { 1.0 }
            revenue = [math]::Round($totalRevenue, 2)
            hoursWorked = [math]::Round($totalHours, 2)
            hoursEstimated = [math]::Round($estimatedHours, 2)
            efficiency = [math]::Round($efficiency, 2)
            utilization = [math]::Round($utilization, 2)
        }

        jobs = $jobDetails

        metrics = @{
            avgJobDuration = [math]::Round($avgJobDuration, 2)
            avgJobValue = [math]::Round($avgJobValue, 2)
            onTimeArrival = [math]::Round($onTimeRate, 2)
            callbackRate = [math]::Round($callbackRate, 3)
            firstTimeFixRate = if ($callbacks.Count -gt 0) { [math]::Round(1 - $callbackRate, 2) } else { 1.0 }
        }

        alerts = $alerts

        weekToDate = @{
            jobsCompleted = $weekStats.JobsCompleted
            revenue = [math]::Round($weekStats.Revenue, 2)
            hoursWorked = [math]::Round($weekStats.HoursWorked, 2)
            avgJobValue = if ($weekStats.JobsCompleted -gt 0) { [math]::Round($weekStats.Revenue / $weekStats.JobsCompleted, 2) } else { 0 }
        }

        monthToDate = @{
            jobsCompleted = $monthStats.JobsCompleted
            revenue = [math]::Round($monthStats.Revenue, 2)
            hoursWorked = [math]::Round($monthStats.HoursWorked, 2)
            avgJobValue = if ($monthStats.JobsCompleted -gt 0) { [math]::Round($monthStats.Revenue / $monthStats.JobsCompleted, 2) } else { 0 }
        }

        partitionKey = "tech_daily"
        metadata = @{
            generatedAt = (Get-Date).ToString("o")
            runbookVersion = "1.1.0"
        }
    }

    # Update global stats
    $script:ReportStats.TotalJobs += $jobCount
    $script:ReportStats.TotalRevenue += $totalRevenue
    $script:ReportStats.TotalHours += $totalHours
    $script:ReportStats.Alerts += $alerts

    return $report
}

# ============================================================================
# SECTION 7: TEAM SUMMARY
# ============================================================================

function Build-TeamDailySummary {
    param(
        [array]$TechReports,
        [DateTime]$Date
    )

    $dateStr = $Date.ToString("yyyy-MM-dd")

    Write-Log "INFO" "Building team summary for $dateStr with $($TechReports.Count) technicians"

    # Aggregate metrics
    $totalJobs = 0
    $totalRevenue = 0
    $totalHours = 0
    $totalUtilization = 0

    foreach ($report in $TechReports) {
        $totalJobs += $report.daily.jobsCompleted
        $totalRevenue += $report.daily.revenue
        $totalHours += $report.daily.hoursWorked
        $totalUtilization += $report.daily.utilization
    }

    $avgJobValue = if ($totalJobs -gt 0) { $totalRevenue / $totalJobs } else { 0 }
    $avgUtilization = if ($TechReports.Count -gt 0) { $totalUtilization / $TechReports.Count } else { 0 }

    # Rankings
    $byRevenue = $TechReports | Sort-Object { $_.daily.revenue } -Descending
    $byJobs = $TechReports | Sort-Object { $_.daily.jobsCompleted } -Descending
    $byEfficiency = $TechReports | Where-Object { $_.daily.hoursWorked -gt 0 } | Sort-Object { $_.daily.efficiency } -Descending

    # Individual summaries with badges
    $techSummaries = @()
    foreach ($report in $TechReports) {
        $badges = @()
        if ($byRevenue.Count -gt 0 -and $report.technician.id -eq $byRevenue[0].technician.id -and $report.daily.revenue -gt 0) {
            $badges += "💰 Top Revenue"
        }
        if ($byJobs.Count -gt 0 -and $report.technician.id -eq $byJobs[0].technician.id -and $report.daily.jobsCompleted -gt 0) {
            $badges += "🏆 Most Jobs"
        }
        if ($byEfficiency.Count -gt 0 -and $report.technician.id -eq $byEfficiency[0].technician.id -and $report.daily.efficiency -gt 1) {
            $badges += "⚡ Most Efficient"
        }

        $techSummaries += @{
            TechnicianId = $report.technician.id
            Name = $report.technician.name
            Jobs = $report.daily.jobsCompleted
            Revenue = $report.daily.revenue
            Hours = $report.daily.hoursWorked
            Utilization = $report.daily.utilization
            Efficiency = $report.daily.efficiency
            Badges = $badges
            Alerts = $report.alerts.Count
        }
    }

    # Collect all alerts with technician context
    $allAlerts = @()
    foreach ($report in $TechReports) {
        foreach ($alert in $report.alerts) {
            $allAlerts += @{
                type = $alert.type
                message = $alert.message
                severity = $alert.severity
                technician = $report.technician.name
                technicianId = $report.technician.id
            }
        }
    }

    # Target calculations
    $teamDailyTarget = $script:ReportConfig.DailyRevenueTarget * $TechReports.Count
    $targetMet = $totalRevenue -ge ($teamDailyTarget * 0.9)  # 90% of target = met

    $summary = @{
        id = "team_daily_$($dateStr -replace '-', '')"
        date = $dateStr

        team = @{
            technicianCount = $TechReports.Count
            totalJobs = $totalJobs
            totalRevenue = [math]::Round($totalRevenue, 2)
            totalHours = [math]::Round($totalHours, 2)
            avgJobValue = [math]::Round($avgJobValue, 2)
            avgUtilization = [math]::Round($avgUtilization, 2)
        }

        rankings = @{
            byRevenue = @($byRevenue | Select-Object -First 3 | ForEach-Object {
                @{ Name = $_.technician.name; Value = $_.daily.revenue }
            })
            byJobs = @($byJobs | Select-Object -First 3 | ForEach-Object {
                @{ Name = $_.technician.name; Value = $_.daily.jobsCompleted }
            })
            byEfficiency = @($byEfficiency | Select-Object -First 3 | ForEach-Object {
                @{ Name = $_.technician.name; Value = $_.daily.efficiency }
            })
        }

        technicians = $techSummaries

        alerts = $allAlerts

        targets = @{
            dailyRevenueTarget = $teamDailyTarget
            dailyRevenueActual = [math]::Round($totalRevenue, 2)
            percentOfTarget = if ($teamDailyTarget -gt 0) { [math]::Round(($totalRevenue / $teamDailyTarget) * 100, 1) } else { 0 }
            targetMet = $targetMet
        }

        partitionKey = "team_daily"
        metadata = @{
            generatedAt = (Get-Date).ToString("o")
            runbookVersion = "1.1.0"
        }
    }

    return $summary
}

function Build-WeeklySummary {
    param(
        [array]$TechReports,
        [DateTime]$WeekEndDate,
        [hashtable]$Creds
    )

    # Get start of week (Monday)
    $dayOfWeek = [int]$WeekEndDate.DayOfWeek
    if ($dayOfWeek -eq 0) { $dayOfWeek = 7 }
    $weekStart = $WeekEndDate.AddDays(-($dayOfWeek - 1))

    Write-Log "INFO" "Building weekly summary: $($weekStart.ToString('yyyy-MM-dd')) to $($WeekEndDate.ToString('yyyy-MM-dd'))"

    # Aggregate week-to-date stats for each technician
    $weeklyTechStats = @()
    foreach ($tech in $TechReports) {
        $wtd = $tech.weekToDate
        $weeklyTechStats += @{
            TechnicianId = $tech.technician.id
            Name = $tech.technician.name
            JobsCompleted = $wtd.jobsCompleted
            Revenue = $wtd.revenue
            HoursWorked = $wtd.hoursWorked
            AvgJobValue = $wtd.avgJobValue
        }
    }

    # Aggregate totals
    $totalJobs = ($weeklyTechStats | Measure-Object -Property JobsCompleted -Sum).Sum
    $totalRevenue = ($weeklyTechStats | Measure-Object -Property Revenue -Sum).Sum
    $totalHours = ($weeklyTechStats | Measure-Object -Property HoursWorked -Sum).Sum

    $weeklyTarget = $script:ReportConfig.WeeklyRevenueTarget * $TechReports.Count

    $summary = @{
        id = "team_weekly_$($weekStart.ToString('yyyyMMdd'))"
        weekStart = $weekStart.ToString("yyyy-MM-dd")
        weekEnd = $WeekEndDate.ToString("yyyy-MM-dd")

        team = @{
            technicianCount = $TechReports.Count
            totalJobs = $totalJobs
            totalRevenue = [math]::Round($totalRevenue, 2)
            totalHours = [math]::Round($totalHours, 2)
            avgJobValue = if ($totalJobs -gt 0) { [math]::Round($totalRevenue / $totalJobs, 2) } else { 0 }
        }

        technicians = @($weeklyTechStats | Sort-Object { $_.Revenue } -Descending)

        targets = @{
            weeklyRevenueTarget = $weeklyTarget
            weeklyRevenueActual = [math]::Round($totalRevenue, 2)
            percentOfTarget = if ($weeklyTarget -gt 0) { [math]::Round(($totalRevenue / $weeklyTarget) * 100, 1) } else { 0 }
            targetMet = $totalRevenue -ge ($weeklyTarget * 0.9)
        }

        partitionKey = "team_weekly"
        metadata = @{
            generatedAt = (Get-Date).ToString("o")
        }
    }

    return $summary
}

# ============================================================================
# SECTION 8: REPORT FORMATTING
# ============================================================================

function Format-TextReport {
    param(
        [hashtable]$TeamSummary,
        [array]$TechReports
    )

    $date = [DateTime]::Parse($TeamSummary.date)
    $dateFormatted = $date.ToString("dddd, MMMM d, yyyy")

    $report = @"
═══════════════════════════════════════════════════════════════
                 PHOENIX ELECTRIC - DAILY TECH REPORT
                       $dateFormatted
═══════════════════════════════════════════════════════════════

📊 TEAM SUMMARY
───────────────────────────────────────────────────────────────
  Technicians Active:  $($TeamSummary.team.technicianCount)
  Jobs Completed:      $($TeamSummary.team.totalJobs)
  Total Revenue:       `$$("{0:N2}" -f $TeamSummary.team.totalRevenue)
  Average Job Value:   `$$("{0:N2}" -f $TeamSummary.team.avgJobValue)
  Total Hours:         $("{0:N1}" -f $TeamSummary.team.totalHours)
  Avg Utilization:     $("{0:P0}" -f $TeamSummary.team.avgUtilization)

"@

    # Add target status
    $targetEmoji = if ($TeamSummary.targets.targetMet) { "✅" } else { "⚠️" }
    $report += @"
📎 TARGET STATUS: $targetEmoji ($($TeamSummary.targets.percentOfTarget)% of target)
  Daily Target:   `$$("{0:N0}" -f $TeamSummary.targets.dailyRevenueTarget)
  Actual:         `$$("{0:N0}" -f $TeamSummary.targets.dailyRevenueActual)

"@

    # Individual performance
    $report += @"
👤 INDIVIDUAL PERFORMANCE
───────────────────────────────────────────────────────────────
"@

    foreach ($tech in ($TeamSummary.technicians | Sort-Object { $_.Revenue } -Descending)) {
        $badges = if ($tech.Badges.Count -gt 0) { " " + ($tech.Badges -join " ") } else { "" }
        $alertFlag = if ($tech.Alerts -gt 0) { " ⚠️" } else { "" }

        $report += @"

  $($tech.Name)$badges$alertFlag
    Jobs: $($tech.Jobs) | Revenue: `$$("{0:N0}" -f $tech.Revenue) | Hours: $("{0:N1}" -f $tech.Hours) | Util: $("{0:P0}" -f $tech.Utilization)
"@
    }

    # Alerts section
    if ($TeamSummary.alerts.Count -gt 0) {
        $report += @"


⚠️ ATTENTION ITEMS
───────────────────────────────────────────────────────────────
"@
        # Group alerts by severity
        $highAlerts = $TeamSummary.alerts | Where-Object { $_.severity -eq "high" }
        $mediumAlerts = $TeamSummary.alerts | Where-Object { $_.severity -eq "medium" }
        $lowAlerts = $TeamSummary.alerts | Where-Object { $_.severity -eq "low" }

        if ($highAlerts.Count -gt 0) {
            $report += "`n  🔴 HIGH PRIORITY:"
            foreach ($alert in $highAlerts) {
                $report += "`n    • [$($alert.technician)] $($alert.message)"
            }
        }

        if ($mediumAlerts.Count -gt 0) {
            $report += "`n  🟡 MEDIUM PRIORITY:"
            foreach ($alert in $mediumAlerts) {
                $report += "`n    • [$($alert.technician)] $($alert.message)"
            }
        }

        if ($lowAlerts.Count -gt 0) {
            $report += "`n  🟢 LOW PRIORITY:"
            foreach ($alert in $lowAlerts) {
                $report += "`n    • [$($alert.technician)] $($alert.message)"
            }
        }
    }

    $report += @"


═══════════════════════════════════════════════════════════════
             Generated by Phoenix AI Core
             $((Get-Date).ToString("h:mm tt"))
═══════════════════════════════════════════════════════════════
"@

    return $report
}

function Format-HtmlReport {
    param(
        [hashtable]$TeamSummary,
        [array]$TechReports
    )

    $date = [DateTime]::Parse($TeamSummary.date)
    $targetStatus = if ($TeamSummary.targets.targetMet) {
        '<span style="color: #27ae60;">✅ Target Met</span>'
    } else {
        '<span style="color: #e74c3c;">⚠️ Below Target</span>'
    }

    $techRows = ""
    foreach ($tech in ($TeamSummary.technicians | Sort-Object { $_.Revenue } -Descending)) {
        $badges = ($tech.Badges | ForEach-Object { "<span class='badge'>$_</span>" }) -join " "
        $rowClass = if ($tech.Alerts -gt 0) { "class='alert-row'" } else { "" }

        $techRows += @"
        <tr $rowClass>
            <td><strong>$($tech.Name)</strong> $badges</td>
            <td>$($tech.Jobs)</td>
            <td>`$$("{0:N0}" -f $tech.Revenue)</td>
            <td>$("{0:N1}" -f $tech.Hours)</td>
            <td>$("{0:P0}" -f $tech.Utilization)</td>
        </tr>
"@
    }

    $alertsHtml = ""
    if ($TeamSummary.alerts.Count -gt 0) {
        $alertItems = ""

        # Group by severity
        $highAlerts = $TeamSummary.alerts | Where-Object { $_.severity -eq "high" }
        $mediumAlerts = $TeamSummary.alerts | Where-Object { $_.severity -eq "medium" }
        $lowAlerts = $TeamSummary.alerts | Where-Object { $_.severity -eq "low" }

        if ($highAlerts.Count -gt 0) {
            $alertItems += "<div class='alert-group high'><strong>🔴 High Priority</strong><ul>"
            foreach ($alert in $highAlerts) {
                $alertItems += "<li><strong>$($alert.technician):</strong> $($alert.message)</li>"
            }
            $alertItems += "</ul></div>"
        }

        if ($mediumAlerts.Count -gt 0) {
            $alertItems += "<div class='alert-group medium'><strong>🟡 Medium Priority</strong><ul>"
            foreach ($alert in $mediumAlerts) {
                $alertItems += "<li><strong>$($alert.technician):</strong> $($alert.message)</li>"
            }
            $alertItems += "</ul></div>"
        }

        if ($lowAlerts.Count -gt 0) {
            $alertItems += "<div class='alert-group low'><strong>🟢 Low Priority</strong><ul>"
            foreach ($alert in $lowAlerts) {
                $alertItems += "<li><strong>$($alert.technician):</strong> $($alert.message)</li>"
            }
            $alertItems += "</ul></div>"
        }

        $alertsHtml = @"
        <div class="alerts">
            <h3>⚠️ Attention Items ($($TeamSummary.alerts.Count))</h3>
            $alertItems
        </div>
"@
    }

    $html = @"
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #1a5276 0%, #2980b9 100%); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .header .date { opacity: 0.9; margin-top: 5px; }
        .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; padding: 20px; background: #f8f9fa; }
        .metric { text-align: center; }
        .metric .value { font-size: 28px; font-weight: bold; color: #2c3e50; }
        .metric .label { font-size: 12px; color: #7f8c8d; text-transform: uppercase; }
        .content { padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th { background: #ecf0f1; padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #7f8c8d; }
        td { padding: 12px; border-bottom: 1px solid #ecf0f1; }
        .alert-row { background: #fff3cd; }
        .badge { display: inline-block; padding: 2px 8px; background: #e8f4fd; color: #2980b9; border-radius: 12px; font-size: 11px; margin-left: 5px; }
        .target-status { text-align: center; padding: 15px; font-size: 18px; }
        .target-details { text-align: center; font-size: 14px; color: #666; margin-top: 5px; }
        .alerts { background: #f8f9fa; padding: 15px 20px; margin: 0; border-top: 1px solid #ecf0f1; }
        .alerts h3 { margin-top: 0; color: #2c3e50; }
        .alert-group { margin-bottom: 15px; }
        .alert-group.high { border-left: 3px solid #e74c3c; padding-left: 10px; }
        .alert-group.medium { border-left: 3px solid #f39c12; padding-left: 10px; }
        .alert-group.low { border-left: 3px solid #27ae60; padding-left: 10px; }
        .alert-group ul { margin: 5px 0 0 0; padding-left: 20px; }
        .alert-group li { margin: 3px 0; }
        .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; border-top: 1px solid #ecf0f1; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⚡ Phoenix Electric - Daily Tech Report</h1>
            <div class="date">$($date.ToString("dddd, MMMM d, yyyy"))</div>
        </div>

        <div class="summary">
            <div class="metric">
                <div class="value">$($TeamSummary.team.totalJobs)</div>
                <div class="label">Jobs Completed</div>
            </div>
            <div class="metric">
                <div class="value">`$$("{0:N0}" -f $TeamSummary.team.totalRevenue)</div>
                <div class="label">Total Revenue</div>
            </div>
            <div class="metric">
                <div class="value">$("{0:P0}" -f $TeamSummary.team.avgUtilization)</div>
                <div class="label">Avg Utilization</div>
            </div>
        </div>

        <div class="target-status">
            $targetStatus
            <div class="target-details">
                $($TeamSummary.targets.percentOfTarget)% of daily target (`$$("{0:N0}" -f $TeamSummary.targets.dailyRevenueTarget))
            </div>
        </div>

        <div class="content">
            <h3>👤 Individual Performance</h3>
            <table>
                <thead>
                    <tr>
                        <th>Technician</th>
                        <th>Jobs</th>
                        <th>Revenue</th>
                        <th>Hours</th>
                        <th>Utilization</th>
                    </tr>
                </thead>
                <tbody>
                    $techRows
                </tbody>
            </table>
        </div>

        $alertsHtml

        <div class="footer">
            Generated by Phoenix AI Core • $((Get-Date).ToString("h:mm tt"))
        </div>
    </div>
</body>
</html>
"@

    return $html
}

# ============================================================================
# SECTION 9: REPORT DELIVERY
# ============================================================================

function Send-TechReportEmail {
    param(
        [string]$HtmlContent,
        [string]$TextContent,
        [DateTime]$Date,
        [hashtable]$Creds
    )

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    $subject = "⚡ Daily Tech Report - $($Date.ToString('MMM d, yyyy'))"

    $headers = @{
        "Authorization" = "Bearer $($Creds.GraphToken)"
        "Content-Type" = "application/json"
    }

    foreach ($recipient in $script:ReportConfig.Recipients) {
        $emailPayload = @{
            message = @{
                subject = $subject
                body = @{
                    contentType = "HTML"
                    content = $HtmlContent
                }
                toRecipients = @(
                    @{ emailAddress = @{ address = $recipient } }
                )
            }
            saveToSentItems = $false
        } | ConvertTo-Json -Depth 10

        $uri = "https://graph.microsoft.com/v1.0/users/ai@phoenixelectric.life/sendMail"

        for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
            try {
                Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $emailPayload -TimeoutSec 30 | Out-Null
                Write-Log "INFO" "Report email sent to $recipient"
                break
            }
            catch {
                Write-Log "WARN" "Email to $recipient attempt $attempt failed: $($_.Exception.Message)"
                if ($attempt -lt $maxRetries) {
                    Start-Sleep -Milliseconds ($retryDelay * $attempt)
                } else {
                    Write-Log "ERROR" "Failed to send report to $recipient after $maxRetries attempts"
                    $script:ReportStats.Errors += "Email delivery failed: $recipient"
                }
            }
        }
    }
}

function Send-TechReportToTeams {
    param(
        [hashtable]$TeamSummary,
        [string]$WebhookUrl
    )

    if ([string]::IsNullOrEmpty($WebhookUrl)) {
        Write-Log "WARN" "Teams webhook URL not configured, skipping Teams notification"
        return
    }

    $maxRetries = $script:ReportConfig.MaxRetries
    $retryDelay = $script:ReportConfig.RetryDelayMs

    $date = [DateTime]::Parse($TeamSummary.date)
    $targetEmoji = if ($TeamSummary.targets.targetMet) { "✅" } else { "⚠️" }

    $card = @{
        "@type" = "MessageCard"
        "@context" = "http://schema.org/extensions"
        "themeColor" = if ($TeamSummary.targets.targetMet) { "27AE60" } else { "FFA500" }
        "summary" = "Daily Tech Report - $($date.ToString('MMM d'))"
        "sections" = @(
            @{
                "activityTitle" = "⚡ Daily Tech Report"
                "activitySubtitle" = $date.ToString("dddd, MMMM d, yyyy")
                "facts" = @(
                    @{ "name" = "Jobs Completed"; "value" = "$($TeamSummary.team.totalJobs)" }
                    @{ "name" = "Total Revenue"; "value" = "`$$("{0:N0}" -f $TeamSummary.team.totalRevenue)" }
                    @{ "name" = "Avg Utilization"; "value" = "$("{0:P0}" -f $TeamSummary.team.avgUtilization)" }
                    @{ "name" = "Target Status"; "value" = "$targetEmoji $($TeamSummary.targets.percentOfTarget)%" }
                )
            }
        )
    }

    # Add top performers section
    if ($TeamSummary.rankings.byRevenue.Count -gt 0) {
        $topPerformer = $TeamSummary.rankings.byRevenue[0]
        $card.sections += @{
            "activityTitle" = "🏆 Top Performer"
            "text" = "$($topPerformer.Name): `$$("{0:N0}" -f $topPerformer.Value)"
        }
    }

    # Add alerts section if any
    $highAlerts = $TeamSummary.alerts | Where-Object { $_.severity -eq "high" -or $_.severity -eq "medium" }
    if ($highAlerts.Count -gt 0) {
        $alertText = ($highAlerts | Select-Object -First 5 | ForEach-Object { "• **$($_.technician):** $($_.message)" }) -join "`n"
        $card.sections += @{
            "activityTitle" = "⚠️ Alerts ($($highAlerts.Count))"
            "text" = $alertText
        }
    }

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $payload = $card | ConvertTo-Json -Depth 15
            Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 30 | Out-Null
            Write-Log "INFO" "Teams notification sent"
            return
        }
        catch {
            Write-Log "WARN" "Teams notification attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                Write-Log "ERROR" "Failed to send Teams notification after $maxRetries attempts"
            }
        }
    }
}

# ============================================================================
# SECTION 10: MAIN EXECUTION
# ============================================================================

Write-Log "INFO" "═══════════════════════════════════════════════════════════════"
Write-Log "INFO" "Phoenix AI Technician Daily Reports starting..."
Write-Log "INFO" "Mode: $Mode"
Write-Log "INFO" "═══════════════════════════════════════════════════════════════"

try {
    # Determine report date
    if ([string]::IsNullOrEmpty($ReportDate)) {
        $reportDate = Get-Date
    } else {
        try {
            $reportDate = [DateTime]::Parse($ReportDate)
        }
        catch {
            Write-Log "WARN" "Invalid date format '$ReportDate', using today"
            $reportDate = Get-Date
        }
    }

    Write-Log "INFO" "Report date: $($reportDate.ToString('yyyy-MM-dd'))"

    # Load credentials
    Write-Log "INFO" "Loading credentials from Key Vault..."

    $kvToken = Get-ManagedIdentityToken -Resource "https://vault.azure.net"
    $vaultName = (Get-AutomationVariable -Name 'VaultName').Trim()

    Write-Log "INFO" "Retrieving secrets..."

    $creds = @{
        TenantId = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName "SERVICETITAN-TENANT-ID" -AccessToken $kvToken
        STClientId = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName "SERVICETITAN-CORE-CLIENT-ID" -AccessToken $kvToken
        STClientSecret = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName "SERVICETITAN-CORE-SECRET" -AccessToken $kvToken
        STAppKey = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName "SERVICETITAN-CORE-APP-KEY" -AccessToken $kvToken
        M365TenantId = (Get-AutomationVariable -Name 'TenantId').Trim()
        GraphClientId = (Get-AutomationVariable -Name 'CourierAppId').Trim()
        GraphClientSecret = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName "PhoenixMailCourierSecret" -AccessToken $kvToken
        CosmosAccount = "phoenix-ai-memory"
        CosmosDb = "phoenix-db"
        CosmosMasterKey = $null
        CosmosEnabled = $false
        TeamsWebhook = $null
    }

    # Try to get Cosmos DB key (optional)
    try {
        $creds.CosmosMasterKey = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName "COSMOS-DB-KEY" -AccessToken $kvToken
        $creds.CosmosEnabled = $true
    }
    catch {
        Write-Log "WARN" "Cosmos DB not configured - storage disabled"
        $creds.CosmosEnabled = $false
    }

    # Try to get Teams webhook (optional)
    try {
        $creds.TeamsWebhook = (Get-AutomationVariable -Name 'TeamsWebhook_AIUpdates').Trim()
    }
    catch {
        Write-Log "WARN" "Teams webhook not configured"
    }

    # Get API tokens
    Write-Log "INFO" "Authenticating to ServiceTitan..."
    $creds.STToken = Get-ServiceTitanToken -ClientId $creds.STClientId -ClientSecret $creds.STClientSecret

    Write-Log "INFO" "Authenticating to Microsoft Graph..."
    $creds.GraphToken = Get-GraphToken -TenantId $creds.M365TenantId -ClientId $creds.GraphClientId -ClientSecret $creds.GraphClientSecret

    # Clear sensitive secrets from memory
    $creds.STClientSecret = $null
    $creds.GraphClientSecret = $null

    Write-Log "INFO" "Authentication complete"

    switch ($Mode) {
        "daily" {
            # Get all active technicians
            $technicians = Get-ActiveTechnicians -Creds $creds

            if ($technicians.Count -eq 0) {
                throw "No active technicians found"
            }

            Write-Log "INFO" "Processing $($technicians.Count) active technicians"

            $techReports = @()

            foreach ($tech in $technicians) {
                try {
                    $report = Build-TechnicianDailyReport -Technician $tech -Date $reportDate -Creds $creds
                    $techReports += $report

                    # Save individual report to Cosmos (if enabled)
                    if ($creds.CosmosEnabled) {
                        Set-TechnicianDailyReport -Report $report -Creds $creds | Out-Null
                    }
                    $script:ReportStats.TechniciansProcessed++
                }
                catch {
                    Write-Log "ERROR" "Failed to process tech $($tech.name): $($_.Exception.Message)"
                    $script:ReportStats.Errors += "Tech $($tech.name): $($_.Exception.Message)"
                }
            }

            if ($techReports.Count -eq 0) {
                throw "No technician reports generated"
            }

            # Build team summary
            $teamSummary = Build-TeamDailySummary -TechReports $techReports -Date $reportDate

            # Save team summary to Cosmos
            if ($creds.CosmosEnabled) {
                Set-TeamDailyReport -Report $teamSummary -Creds $creds | Out-Null
            }

            # Generate formatted reports
            Write-Log "INFO" "Generating formatted reports..."
            $textReport = Format-TextReport -TeamSummary $teamSummary -TechReports $techReports
            $htmlReport = Format-HtmlReport -TeamSummary $teamSummary -TechReports $techReports

            # Deliver reports
            Write-Log "INFO" "Delivering reports..."
            Send-TechReportEmail -HtmlContent $htmlReport -TextContent $textReport -Date $reportDate -Creds $creds
            Send-TechReportToTeams -TeamSummary $teamSummary -WebhookUrl $creds.TeamsWebhook

            # Output text report to log
            Write-Output $textReport
        }

        "single" {
            if (-not $TechnicianId) {
                throw "TechnicianId parameter required for single mode"
            }

            $technicians = Get-ActiveTechnicians -Creds $creds
            $tech = $technicians | Where-Object { $_.id -eq [int]$TechnicianId }

            if (-not $tech) {
                throw "Technician not found: $TechnicianId"
            }

            Write-Log "INFO" "Generating report for $($tech.name)"

            $report = Build-TechnicianDailyReport -Technician $tech -Date $reportDate -Creds $creds
            if ($creds.CosmosEnabled) {
                Set-TechnicianDailyReport -Report $report -Creds $creds | Out-Null
            }
            $script:ReportStats.TechniciansProcessed = 1

            Write-Output ($report | ConvertTo-Json -Depth 10)
        }

        "team" {
            # Team summary only (no email delivery)
            $technicians = Get-ActiveTechnicians -Creds $creds

            if ($technicians.Count -eq 0) {
                throw "No active technicians found"
            }

            $techReports = @()

            foreach ($tech in $technicians) {
                try {
                    $report = Build-TechnicianDailyReport -Technician $tech -Date $reportDate -Creds $creds
                    $techReports += $report
                    $script:ReportStats.TechniciansProcessed++
                }
                catch {
                    Write-Log "ERROR" "Failed to process tech $($tech.name): $($_.Exception.Message)"
                }
            }

            $teamSummary = Build-TeamDailySummary -TechReports $techReports -Date $reportDate
            Write-Output ($teamSummary | ConvertTo-Json -Depth 15)
        }

        "weekly" {
            # Weekly summary report
            $technicians = Get-ActiveTechnicians -Creds $creds

            if ($technicians.Count -eq 0) {
                throw "No active technicians found"
            }

            $techReports = @()

            foreach ($tech in $technicians) {
                try {
                    $report = Build-TechnicianDailyReport -Technician $tech -Date $reportDate -Creds $creds
                    $techReports += $report
                    $script:ReportStats.TechniciansProcessed++
                }
                catch {
                    Write-Log "ERROR" "Failed to process tech $($tech.name): $($_.Exception.Message)"
                }
            }

            $weeklySummary = Build-WeeklySummary -TechReports $techReports -WeekEndDate $reportDate -Creds $creds
            Write-Output ($weeklySummary | ConvertTo-Json -Depth 15)
        }
    }

    # Final summary
    Write-Log "INFO" "═══════════════════════════════════════════════════════════════"
    Write-Log "INFO" "TECHNICIAN DAILY REPORTS COMPLETE"
    Write-Log "INFO" "═══════════════════════════════════════════════════════════════"
    Write-Log "INFO" "Technicians Processed: $($script:ReportStats.TechniciansProcessed)"
    Write-Log "INFO" "Total Jobs: $($script:ReportStats.TotalJobs)"
    Write-Log "INFO" "Total Revenue: `$$("{0:N2}" -f $script:ReportStats.TotalRevenue)"
    Write-Log "INFO" "Total Hours: $("{0:N1}" -f $script:ReportStats.TotalHours)"
    Write-Log "INFO" "Alerts Generated: $($script:ReportStats.Alerts.Count)"
    if ($script:ReportStats.Errors.Count -gt 0) {
        Write-Log "WARN" "Errors: $($script:ReportStats.Errors.Count)"
    }

    $result = @{
        Status = "Success"
        Mode = $Mode
        Date = $reportDate.ToString("yyyy-MM-dd")
        Stats = @{
            TechniciansProcessed = $script:ReportStats.TechniciansProcessed
            TotalJobs = $script:ReportStats.TotalJobs
            TotalRevenue = [math]::Round($script:ReportStats.TotalRevenue, 2)
            TotalHours = [math]::Round($script:ReportStats.TotalHours, 2)
            AlertsGenerated = $script:ReportStats.Alerts.Count
            Errors = $script:ReportStats.Errors.Count
        }
        CompletedAt = (Get-Date).ToString("o")
    }
}
catch {
    Write-Log "CRITICAL" "Technician reports failed: $($_.Exception.Message)"
    Write-Log "ERROR" "Stack trace: $($_.ScriptStackTrace)"

    $result = @{
        Status = "Failed"
        Mode = $Mode
        Error = $_.Exception.Message
        Stats = @{
            TechniciansProcessed = $script:ReportStats.TechniciansProcessed
            TotalJobs = $script:ReportStats.TotalJobs
            TotalRevenue = [math]::Round($script:ReportStats.TotalRevenue, 2)
            Errors = $script:ReportStats.Errors
        }
        FailedAt = (Get-Date).ToString("o")
    }
}

# Output JSON for orchestration
$jsonOutput = $result | ConvertTo-Json -Depth 10 -Compress
Write-Output "---JSON_OUTPUT_START---"
Write-Output $jsonOutput
Write-Output "---JSON_OUTPUT_END---"
