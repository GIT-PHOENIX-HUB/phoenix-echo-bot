<#
.SYNOPSIS
    Phoenix AI Security Sentinel
.DESCRIPTION
    Monitors all Phoenix AI Core activity, detects anomalies, generates security
    alerts, and maintains audit trail. This is the watchful eye that never sleeps.

    What Gets Monitored:
    - All API calls (ServiceTitan, Graph, Cosmos)
    - Authentication events (token refreshes, failures)
    - Write operations (approvals, executions)
    - Error rates and patterns
    - Secret access and rotation
    - System health and performance

    Monitoring Categories:
    1. Authentication Monitoring - token acquisition, refresh, failures
    2. API Usage Monitoring - call volume, error rates, response times
    3. Write Operation Monitoring - POST/PUT/DELETE/PATCH, approvals
    4. Secret Management Monitoring - Key Vault access, rotation, expiration
    5. System Health Monitoring - runbook execution, Cosmos throughput

    Modes:
    - monitor: Run all security checks (default, runs every 15 min)
    - audit: Generate detailed audit report
    - report: Daily security summary
    - alert: Process specific alert

.NOTES
    Runtime: PS72-Courier (PowerShell 7.2)
    Author: Phoenix Electric AI Team
    Version: 1.1.0
    Source: Part 12 of Phoenix AI Playbook

    RUNS: Every 15 minutes (continuous monitoring)
          Daily at 11 PM (full security report)

    Cosmos Containers: security_events, security_alerts

    Alert Severity Levels:
    - CRITICAL (Red): Security breach, data loss, system down - Immediate response
    - HIGH (Orange): Auth failures, API errors, anomalies - < 1 hour
    - MEDIUM (Yellow): Rate limits, warnings, unusual patterns - < 4 hours
    - LOW (Green): Info, audits, routine events - Next business day

    Secret Expiration Tracking:
    - PhoenixMailCourierSecret expires: March 28, 2026
#>

#Requires -Modules Az.Accounts, Az.KeyVault

[CmdletBinding()]
param(
    [ValidateSet("monitor", "audit", "report", "alert")]
    [string]$Mode = "monitor",

    [int]$LookbackMinutes = 15,

    [string]$AlertId = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ============================================================================
# SECTION 1: CONFIGURATION
# ============================================================================

$script:SecurityConfig = @{
    # Thresholds
    MaxFailedAuthAttempts = 3
    MaxApiErrorRate = 0.10           # 10% error rate triggers alert
    MaxResponseTimeMs = 5000          # 5 second response time alert
    RateLimitWarningPercent = 0.80   # Alert at 80% of rate limit

    # Anomaly detection
    AnomalyStdDevThreshold = 2.5     # 2.5 standard deviations
    MinSamplesForAnomaly = 10        # Need 10 samples before anomaly detection

    # Secret management
    SecretExpirationWarningDays = 30
    KnownSecrets = @(
        @{ Name = "PhoenixMailCourierSecret"; ExpirationDate = "2026-03-28" }
        @{ Name = "SERVICETITAN-CORE-SECRET"; ExpirationDate = "2025-12-31" }
    )

    # Retention
    EventRetentionDays = 90
    AuditRetentionDays = 365

    # Alert channels
    CriticalAlertRecipients = @("shane@phoenixelectric.life")
    HighAlertRecipients = @("shane@phoenixelectric.life", "smowbray@phoenixelectric.life")

    # Retry configuration
    MaxRetries = 3
    RetryDelayMs = 2000
}

$script:MonitoringStats = @{
    EventsProcessed = 0
    AlertsGenerated = 0
    AnomaliesDetected = 0
    SecurityIssues = 0
    ChecksPassed = 0
    ChecksFailed = 0
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
        [string]$Agent = "SecuritySentinel"
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

    $maxRetries = $script:SecurityConfig.MaxRetries
    $retryDelay = $script:SecurityConfig.RetryDelayMs

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

    $maxRetries = $script:SecurityConfig.MaxRetries
    $retryDelay = $script:SecurityConfig.RetryDelayMs

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

function Get-GraphToken {
    param(
        [string]$TenantId,
        [string]$ClientId,
        [string]$ClientSecret
    )

    $maxRetries = $script:SecurityConfig.MaxRetries
    $retryDelay = $script:SecurityConfig.RetryDelayMs

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
# SECTION 4: COSMOS DB OPERATIONS
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

function Write-SecurityEvent {
    param(
        [hashtable]$Event,
        [hashtable]$Creds
    )

    $maxRetries = $script:SecurityConfig.MaxRetries
    $retryDelay = $script:SecurityConfig.RetryDelayMs

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/security_events"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-partitionkey" = '["security_events"]'
        "x-ms-documentdb-is-upsert" = "True"
        "Content-Type" = "application/json"
    }

    $body = $Event | ConvertTo-Json -Depth 15

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -TimeoutSec 30 | Out-Null
            return $true
        }
        catch {
            Write-Log "WARN" "Write security event attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                Write-Log "ERROR" "Failed to write security event after $maxRetries attempts"
                return $false
            }
        }
    }
}

function Get-RecentSecurityEvents {
    param(
        [int]$Minutes,
        [hashtable]$Creds
    )

    $maxRetries = $script:SecurityConfig.MaxRetries
    $retryDelay = $script:SecurityConfig.RetryDelayMs

    $cutoff = (Get-Date).AddMinutes(-$Minutes).ToUniversalTime().ToString("o")

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/security_events"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-query-enablecrosspartition" = "True"
        "Content-Type" = "application/query+json"
        "x-ms-documentdb-isquery" = "true"
    }

    $query = @{
        query = "SELECT * FROM c WHERE c.timestamp >= @cutoff ORDER BY c.timestamp DESC"
        parameters = @(@{ name = "@cutoff"; value = $cutoff })
    } | ConvertTo-Json -Depth 5

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $query -TimeoutSec 60
            return @($response.Documents)
        }
        catch {
            Write-Log "WARN" "Get security events attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                Write-Log "ERROR" "Failed to get security events after $maxRetries attempts"
                return @()
            }
        }
    }
}

function Write-SecurityAlert {
    param(
        [hashtable]$Alert,
        [hashtable]$Creds
    )

    $maxRetries = $script:SecurityConfig.MaxRetries
    $retryDelay = $script:SecurityConfig.RetryDelayMs

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/security_alerts"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-partitionkey" = '["security_alerts"]'
        "x-ms-documentdb-is-upsert" = "True"
        "Content-Type" = "application/json"
    }

    $body = $Alert | ConvertTo-Json -Depth 15

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -TimeoutSec 30 | Out-Null
            return $true
        }
        catch {
            Write-Log "WARN" "Write security alert attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Start-Sleep -Milliseconds ($retryDelay * $attempt)
            } else {
                Write-Log "ERROR" "Failed to write security alert after $maxRetries attempts"
                return $false
            }
        }
    }
}

function Get-RecentSecurityAlerts {
    param(
        [int]$Hours = 24,
        [hashtable]$Creds
    )

    $cutoff = (Get-Date).AddHours(-$Hours).ToUniversalTime().ToString("o")

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/security_alerts"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-query-enablecrosspartition" = "True"
        "Content-Type" = "application/query+json"
        "x-ms-documentdb-isquery" = "true"
    }

    $query = @{
        query = "SELECT * FROM c WHERE c.timestamp >= @cutoff ORDER BY c.timestamp DESC"
        parameters = @(@{ name = "@cutoff"; value = $cutoff })
    } | ConvertTo-Json -Depth 5

    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $query -TimeoutSec 60
        return @($response.Documents)
    }
    catch {
        return @()
    }
}

function Update-SecurityAlert {
    param(
        [string]$AlertId,
        [string]$Status,
        [string]$AcknowledgedBy = $null,
        [string]$ResolvedBy = $null,
        [hashtable]$Creds
    )

    # First get the existing alert
    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/security_alerts"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-partitionkey" = '["security_alerts"]'
        "Content-Type" = "application/query+json"
        "x-ms-documentdb-isquery" = "true"
    }

    $query = @{
        query = "SELECT * FROM c WHERE c.id = @id"
        parameters = @(@{ name = "@id"; value = $AlertId })
    } | ConvertTo-Json -Depth 5

    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $query -TimeoutSec 30
        if ($response.Documents.Count -eq 0) {
            Write-Log "WARN" "Alert not found: $AlertId"
            return $false
        }

        $alert = $response.Documents[0]
        $alert.status = $Status

        if ($AcknowledgedBy -and $Status -eq "acknowledged") {
            $alert.acknowledgedBy = $AcknowledgedBy
            $alert.acknowledgedAt = (Get-Date).ToUniversalTime().ToString("o")
        }

        if ($ResolvedBy -and $Status -eq "resolved") {
            $alert.resolvedBy = $ResolvedBy
            $alert.resolvedAt = (Get-Date).ToUniversalTime().ToString("o")
        }

        # Upsert the updated alert
        Write-SecurityAlert -Alert $alert -Creds $Creds
        return $true
    }
    catch {
        Write-Log "ERROR" "Failed to update alert: $($_.Exception.Message)"
        return $false
    }
}

# ============================================================================
# SECTION 5: EVENT LOGGING FUNCTIONS
# ============================================================================

function New-SecurityEvent {
    param(
        [string]$EventType,
        [string]$Severity,
        [string]$Component,
        [string]$Action,
        [string]$Resource,
        [string]$Result,
        [hashtable]$Details = @{},
        [bool]$WriteOperation = $false,
        [bool]$Sensitive = $false,
        [bool]$ExternalCommunication = $false,
        [hashtable]$Creds
    )

    $eventId = "sec_evt_$((Get-Date).ToString('yyyyMMdd_HHmmss'))_$([guid]::NewGuid().ToString().Substring(0,8))"

    $event = @{
        id = $eventId
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        eventType = $EventType
        severity = $Severity

        source = @{
            system = "phoenix_ai_core"
            component = $Component
            runbook = if ($env:AUTOMATION_RUNBOOK_NAME) { $env:AUTOMATION_RUNBOOK_NAME } else { "SecurityMonitor" }
            runId = if ($env:AUTOMATION_JOB_ID) { $env:AUTOMATION_JOB_ID } else { [guid]::NewGuid().ToString() }
        }

        event = @{
            action = $Action
            resource = $Resource
            result = $Result
            details = $Details
        }

        context = @{
            triggeredBy = $Mode
            correlationId = "corr_$([guid]::NewGuid().ToString().Substring(0,8))"
            ipAddress = "internal"
            userAgent = "PhoenixAI/1.0"
        }

        flags = @{
            sensitive = $Sensitive
            writeOperation = $WriteOperation
            externalCommunication = $ExternalCommunication
            requiresAudit = ($Severity -in @("critical", "high") -or $WriteOperation)
        }

        partitionKey = "security_events"
    }

    Write-SecurityEvent -Event $event -Creds $Creds | Out-Null
    $script:MonitoringStats.EventsProcessed++

    return $event
}

# ============================================================================
# SECTION 6: MONITORING FUNCTIONS
# ============================================================================

function Test-AuthenticationHealth {
    param(
        [hashtable]$Creds
    )

    Write-Log "INFO" "Checking authentication health..."
    $alerts = @()

    try {
        # Check recent auth events
        $recentEvents = Get-RecentSecurityEvents -Minutes 60 -Creds $Creds
        $authEvents = $recentEvents | Where-Object { $_.eventType -eq "authentication" }

        $failedAuths = $authEvents | Where-Object { $_.event.result -eq "failure" }

        if ($failedAuths.Count -ge $script:SecurityConfig.MaxFailedAuthAttempts) {
            $alerts += @{
                type = "auth_failures"
                severity = "high"
                message = "$($failedAuths.Count) authentication failures in the last hour"
                details = @{
                    failureCount = $failedAuths.Count
                    components = @(($failedAuths | Group-Object { $_.source.component } | ForEach-Object { $_.Name }))
                    lastFailure = if ($failedAuths.Count -gt 0) { $failedAuths[0].timestamp } else { $null }
                }
            }
            $script:MonitoringStats.ChecksFailed++
        } else {
            $script:MonitoringStats.ChecksPassed++
        }

        # Check for repeated failures from same component
        $componentFailures = $failedAuths | Group-Object { $_.source.component }
        foreach ($group in $componentFailures) {
            if ($group.Count -ge 2) {
                $alerts += @{
                    type = "repeated_auth_failure"
                    severity = "high"
                    message = "Repeated auth failures from $($group.Name): $($group.Count) failures"
                    details = @{
                        component = $group.Name
                        failureCount = $group.Count
                        timestamps = @($group.Group | ForEach-Object { $_.timestamp })
                    }
                }
            }
        }
    }
    catch {
        Write-Log "ERROR" "Auth health check failed: $($_.Exception.Message)"
        $script:MonitoringStats.Errors += "Auth check: $($_.Exception.Message)"
    }

    return $alerts
}

function Test-ApiHealth {
    param(
        [hashtable]$Creds
    )

    Write-Log "INFO" "Checking API health..."
    $alerts = @()

    try {
        $recentEvents = Get-RecentSecurityEvents -Minutes $LookbackMinutes -Creds $Creds
        $apiEvents = $recentEvents | Where-Object { $_.eventType -eq "api_call" }

        if ($apiEvents.Count -eq 0) {
            Write-Log "INFO" "No API events in lookback period"
            $script:MonitoringStats.ChecksPassed++
            return $alerts
        }

        # Calculate error rate
        $errorCount = ($apiEvents | Where-Object { $_.event.result -ne "success" }).Count
        $errorRate = $errorCount / $apiEvents.Count

        if ($errorRate -ge $script:SecurityConfig.MaxApiErrorRate) {
            $alerts += @{
                type = "high_error_rate"
                severity = "high"
                message = "API error rate at $([math]::Round($errorRate * 100, 1))% ($errorCount of $($apiEvents.Count) calls)"
                details = @{
                    totalCalls = $apiEvents.Count
                    errorCount = $errorCount
                    errorRate = [math]::Round($errorRate, 3)
                    byEndpoint = @(($apiEvents | Where-Object { $_.event.result -ne "success" } | Group-Object { $_.event.resource } | ForEach-Object { @{ endpoint = $_.Name; count = $_.Count } }))
                }
            }
            $script:MonitoringStats.ChecksFailed++
        } else {
            $script:MonitoringStats.ChecksPassed++
        }

        # Check response times
        $slowCalls = $apiEvents | Where-Object {
            $_.event.details.durationMs -and $_.event.details.durationMs -gt $script:SecurityConfig.MaxResponseTimeMs
        }

        if ($slowCalls.Count -gt 3) {
            $durations = @($slowCalls | ForEach-Object { $_.event.details.durationMs } | Where-Object { $_ -ne $null })
            $avgDuration = if ($durations.Count -gt 0) { [math]::Round((($durations | Measure-Object -Average).Average), 0) } else { 0 }
            $maxDuration = if ($durations.Count -gt 0) { ($durations | Measure-Object -Maximum).Maximum } else { 0 }

            $alerts += @{
                type = "slow_responses"
                severity = "medium"
                message = "$($slowCalls.Count) API calls exceeded $($script:SecurityConfig.MaxResponseTimeMs)ms threshold"
                details = @{
                    slowCallCount = $slowCalls.Count
                    avgDurationMs = $avgDuration
                    maxDurationMs = $maxDuration
                    endpoints = @(($slowCalls | Group-Object { $_.event.resource } | ForEach-Object { $_.Name }))
                }
            }
            $script:MonitoringStats.ChecksFailed++
        } else {
            $script:MonitoringStats.ChecksPassed++
        }

        # Check for rate limit proximity
        # This would require tracking rate limit headers - placeholder for future implementation
    }
    catch {
        Write-Log "ERROR" "API health check failed: $($_.Exception.Message)"
        $script:MonitoringStats.Errors += "API check: $($_.Exception.Message)"
    }

    return $alerts
}

function Test-WriteOperationHealth {
    param(
        [hashtable]$Creds
    )

    Write-Log "INFO" "Checking write operation health..."
    $alerts = @()

    try {
        $recentEvents = Get-RecentSecurityEvents -Minutes 60 -Creds $Creds
        $writeEvents = $recentEvents | Where-Object { $_.flags.writeOperation -eq $true }

        if ($writeEvents.Count -eq 0) {
            $script:MonitoringStats.ChecksPassed++
            return $alerts
        }

        # Check for unapproved writes (critical security issue)
        $unapprovedWrites = $writeEvents | Where-Object {
            -not $_.event.details.approvalId -and $_.event.result -eq "success"
        }

        if ($unapprovedWrites.Count -gt 0) {
            $alerts += @{
                type = "unapproved_write"
                severity = "critical"
                message = "$($unapprovedWrites.Count) write operations executed without approval"
                details = @{
                    count = $unapprovedWrites.Count
                    operations = @($unapprovedWrites | ForEach-Object { "$($_.event.action) $($_.event.resource)" })
                    timestamps = @($unapprovedWrites | ForEach-Object { $_.timestamp })
                }
            }
            $script:MonitoringStats.SecurityIssues++
            $script:MonitoringStats.ChecksFailed++
        }

        # Check for failed writes
        $failedWrites = $writeEvents | Where-Object { $_.event.result -eq "failure" }

        if ($failedWrites.Count -gt 2) {
            $alerts += @{
                type = "write_failures"
                severity = "high"
                message = "$($failedWrites.Count) write operations failed in the last hour"
                details = @{
                    count = $failedWrites.Count
                    operations = @($failedWrites | ForEach-Object { "$($_.event.action) $($_.event.resource)" })
                    errors = @($failedWrites | ForEach-Object { $_.event.details.error } | Where-Object { $_ })
                }
            }
            $script:MonitoringStats.ChecksFailed++
        } else {
            $script:MonitoringStats.ChecksPassed++
        }

        # Track write volume for anomaly detection
        $writeVolume = $writeEvents.Count
        Write-Log "INFO" "Write operations in last hour: $writeVolume"
    }
    catch {
        Write-Log "ERROR" "Write operation health check failed: $($_.Exception.Message)"
        $script:MonitoringStats.Errors += "Write check: $($_.Exception.Message)"
    }

    return $alerts
}

function Test-SecretHealth {
    param(
        [hashtable]$Creds
    )

    Write-Log "INFO" "Checking secret health..."
    $alerts = @()

    try {
        foreach ($secret in $script:SecurityConfig.KnownSecrets) {
            try {
                $expDate = [DateTime]::Parse($secret.ExpirationDate)
                $daysUntilExpiration = ($expDate - (Get-Date)).Days

                if ($daysUntilExpiration -le $script:SecurityConfig.SecretExpirationWarningDays) {
                    $severity = if ($daysUntilExpiration -le 7) {
                        "critical"
                    } elseif ($daysUntilExpiration -le 14) {
                        "high"
                    } else {
                        "medium"
                    }

                    $alerts += @{
                        type = "secret_expiring"
                        severity = $severity
                        message = "Secret '$($secret.Name)' expires in $daysUntilExpiration days"
                        details = @{
                            secretName = $secret.Name
                            expirationDate = $secret.ExpirationDate
                            daysRemaining = $daysUntilExpiration
                        }
                    }
                    $script:MonitoringStats.ChecksFailed++
                } else {
                    $script:MonitoringStats.ChecksPassed++
                }
            }
            catch {
                Write-Log "WARN" "Could not parse expiration date for $($secret.Name)"
            }
        }

        if ($Creds.CosmosEnabled) {
            # Check for excessive secret access (potential credential harvesting)
            $recentEvents = Get-RecentSecurityEvents -Minutes 60 -Creds $Creds
            $secretAccessEvents = $recentEvents | Where-Object { $_.eventType -eq "secret_access" }

            $accessBySecret = $secretAccessEvents | Group-Object { $_.event.resource }
            foreach ($group in $accessBySecret) {
                if ($group.Count -gt 20) {  # More than 20 accesses in an hour is unusual
                    $alerts += @{
                        type = "excessive_secret_access"
                        severity = "high"
                        message = "Excessive access to secret '$($group.Name)': $($group.Count) times in 1 hour"
                        details = @{
                            secretName = $group.Name
                            accessCount = $group.Count
                            components = @(($group.Group | Group-Object { $_.source.component } | ForEach-Object { $_.Name }))
                        }
                    }
                    $script:MonitoringStats.SecurityIssues++
                }
            }
        }
    }
    catch {
        Write-Log "ERROR" "Secret health check failed: $($_.Exception.Message)"
        $script:MonitoringStats.Errors += "Secret check: $($_.Exception.Message)"
    }

    return $alerts
}

function Test-AnomalyDetection {
    param(
        [hashtable]$Creds
    )

    Write-Log "INFO" "Running anomaly detection..."
    $alerts = @()

    try {
        # Get current hour data
        $recentEvents = Get-RecentSecurityEvents -Minutes 60 -Creds $Creds

        if ($recentEvents.Count -lt $script:SecurityConfig.MinSamplesForAnomaly) {
            Write-Log "INFO" "Not enough samples for anomaly detection ($($recentEvents.Count) < $($script:SecurityConfig.MinSamplesForAnomaly))"
            return $alerts
        }

        # Get historical data for comparison (last 24 hours)
        $historicalEvents = Get-RecentSecurityEvents -Minutes 1440 -Creds $Creds

        if ($historicalEvents.Count -lt $script:SecurityConfig.MinSamplesForAnomaly * 10) {
            Write-Log "INFO" "Not enough historical data for anomaly detection"
            return $alerts
        }

        # Group by component
        $componentActivity = $recentEvents | Group-Object { $_.source.component }

        foreach ($component in $componentActivity) {
            $historicalForComponent = $historicalEvents | Where-Object { $_.source.component -eq $component.Name }

            if ($historicalForComponent.Count -lt $script:SecurityConfig.MinSamplesForAnomaly) {
                continue
            }

            # Calculate hourly averages
            $hourlyGroups = $historicalForComponent | Group-Object { [DateTime]::Parse($_.timestamp).Hour }

            if ($hourlyGroups.Count -lt 3) {
                continue
            }

            $counts = $hourlyGroups | ForEach-Object { $_.Count }
            $avgPerHour = ($counts | Measure-Object -Average).Average
            $variance = ($counts | ForEach-Object { [math]::Pow($_ - $avgPerHour, 2) } | Measure-Object -Average).Average
            $stdDev = [math]::Sqrt($variance)

            if ($stdDev -eq 0) {
                continue
            }

            # Current hour count
            $currentHourCount = $component.Count

            # Check for anomaly
            $zScore = ($currentHourCount - $avgPerHour) / $stdDev

            if ([math]::Abs($zScore) -gt $script:SecurityConfig.AnomalyStdDevThreshold) {
                $direction = if ($zScore -gt 0) { "spike" } else { "drop" }

                $alerts += @{
                    type = "activity_anomaly"
                    severity = "medium"
                    message = "Unusual activity $direction detected in $($component.Name)"
                    details = @{
                        component = $component.Name
                        currentCount = $currentHourCount
                        expectedAvg = [math]::Round($avgPerHour, 1)
                        stdDev = [math]::Round($stdDev, 1)
                        zScore = [math]::Round($zScore, 2)
                        direction = $direction
                        deviation = "$([math]::Round([math]::Abs($zScore), 1)) standard deviations"
                    }
                }
                $script:MonitoringStats.AnomaliesDetected++
            }
        }

        $script:MonitoringStats.ChecksPassed++
    }
    catch {
        Write-Log "ERROR" "Anomaly detection failed: $($_.Exception.Message)"
        $script:MonitoringStats.Errors += "Anomaly detection: $($_.Exception.Message)"
    }

    return $alerts
}

function Test-SystemHealth {
    param(
        [hashtable]$Creds
    )

    Write-Log "INFO" "Checking system health..."
    $alerts = @()

    try {
        # Check for runbook failures
        $recentEvents = Get-RecentSecurityEvents -Minutes 60 -Creds $Creds
        $runbookEvents = $recentEvents | Where-Object { $_.eventType -eq "runbook_execution" }

        $failedRunbooks = $runbookEvents | Where-Object { $_.event.result -eq "failure" }

        if ($failedRunbooks.Count -gt 0) {
            $alerts += @{
                type = "runbook_failures"
                severity = "high"
                message = "$($failedRunbooks.Count) runbook failures in the last hour"
                details = @{
                    count = $failedRunbooks.Count
                    runbooks = @(($failedRunbooks | Group-Object { $_.source.runbook } | ForEach-Object { @{ name = $_.Name; count = $_.Count } }))
                    errors = @($failedRunbooks | ForEach-Object { $_.event.details.error } | Where-Object { $_ } | Select-Object -First 5)
                }
            }
            $script:MonitoringStats.ChecksFailed++
        } else {
            $script:MonitoringStats.ChecksPassed++
        }

        # Check for consecutive failures (same runbook failing multiple times)
        $runbookFailureCounts = $failedRunbooks | Group-Object { $_.source.runbook }
        foreach ($group in $runbookFailureCounts) {
            if ($group.Count -ge 3) {
                $alerts += @{
                    type = "consecutive_runbook_failures"
                    severity = "critical"
                    message = "Runbook '$($group.Name)' has failed $($group.Count) times in the last hour"
                    details = @{
                        runbook = $group.Name
                        failureCount = $group.Count
                        timestamps = @($group.Group | ForEach-Object { $_.timestamp })
                    }
                }
                $script:MonitoringStats.SecurityIssues++
            }
        }
    }
    catch {
        Write-Log "ERROR" "System health check failed: $($_.Exception.Message)"
        $script:MonitoringStats.Errors += "System check: $($_.Exception.Message)"
    }

    return $alerts
}

# ============================================================================
# SECTION 7: ALERT DELIVERY
# ============================================================================

function Send-SecurityAlertNotification {
    param(
        [hashtable]$Alert,
        [hashtable]$Creds
    )

    $maxRetries = $script:SecurityConfig.MaxRetries
    $retryDelay = $script:SecurityConfig.RetryDelayMs

    # Determine color based on severity
    $colorMap = @{
        "critical" = "FF0000"
        "high" = "FFA500"
        "medium" = "FFFF00"
        "low" = "27AE60"
    }

    $emojiMap = @{
        "critical" = "🚨"
        "high" = "⚠️"
        "medium" = "🔔"
        "low" = "ℹ️"
    }

    $color = $colorMap[$Alert.severity]
    $emoji = $emojiMap[$Alert.severity]

    # Build Teams card
    $facts = @(
        @{ "name" = "Type"; "value" = $Alert.type }
        @{ "name" = "Severity"; "value" = $Alert.severity.ToUpper() }
        @{ "name" = "Time"; "value" = (Get-Date).ToString("yyyy-MM-dd h:mm tt") }
    )

    # Add details to facts
    if ($Alert.details) {
        foreach ($key in $Alert.details.Keys) {
            $value = $Alert.details[$key]
            if ($value -is [array]) {
                $value = ($value | Select-Object -First 3) -join ", "
                if ($Alert.details[$key].Count -gt 3) {
                    $value += "..."
                }
            }
            $facts += @{ "name" = $key; "value" = "$value" }
        }
    }

    $card = @{
        "@type" = "MessageCard"
        "@context" = "http://schema.org/extensions"
        "themeColor" = $color
        "summary" = "$emoji Security Alert: $($Alert.type)"
        "sections" = @(
            @{
                "activityTitle" = "$emoji SECURITY ALERT"
                "activitySubtitle" = $Alert.severity.ToUpper()
                "facts" = $facts
                "text" = $Alert.message
                "markdown" = $true
            }
        )
    }

    # Send to Teams
    $webhookUrl = if ($Alert.severity -eq "critical") {
        $Creds.TeamsWebhookUrgent
    } else {
        $Creds.TeamsWebhookAI
    }

    if ($webhookUrl) {
        for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
            try {
                $payload = $card | ConvertTo-Json -Depth 15
                Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 30 | Out-Null
                Write-Log "INFO" "Teams alert sent for $($Alert.type)"
                break
            }
            catch {
                Write-Log "WARN" "Teams alert attempt $attempt failed: $($_.Exception.Message)"
                if ($attempt -lt $maxRetries) {
                    Start-Sleep -Milliseconds ($retryDelay * $attempt)
                } else {
                    Write-Log "ERROR" "Failed to send Teams alert after $maxRetries attempts"
                }
            }
        }
    }

    # Send email for critical/high alerts
    if ($Alert.severity -in @("critical", "high")) {
        $recipients = if ($Alert.severity -eq "critical") {
            $script:SecurityConfig.CriticalAlertRecipients
        } else {
            $script:SecurityConfig.HighAlertRecipients
        }

        $subject = "$emoji Phoenix AI Security Alert: $($Alert.type)"

        $detailsHtml = ""
        if ($Alert.details) {
            $detailsHtml = "<table style='border-collapse: collapse; margin-top: 10px;'>"
            foreach ($key in $Alert.details.Keys) {
                $value = $Alert.details[$key]
                if ($value -is [array]) {
                    $value = ($value | Select-Object -First 5) -join "<br>"
                }
                $detailsHtml += "<tr><td style='padding: 5px; border: 1px solid #ddd; font-weight: bold;'>$key</td><td style='padding: 5px; border: 1px solid #ddd;'>$value</td></tr>"
            }
            $detailsHtml += "</table>"
        }

        $body = @"
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; }
        .header { background: #$color; color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .header h2 { margin: 10px 0 0 0; font-size: 18px; opacity: 0.9; }
        .content { padding: 30px; }
        .content p { margin: 10px 0; }
        .alert-box { background: #f8f9fa; border-left: 4px solid #$color; padding: 15px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="header">
        <h1>$emoji SECURITY ALERT</h1>
        <h2>$($Alert.severity.ToUpper())</h2>
    </div>
    <div class="content">
        <p><strong>Type:</strong> $($Alert.type)</p>
        <p><strong>Time:</strong> $(Get-Date -Format "yyyy-MM-dd h:mm:ss tt")</p>
        <div class="alert-box">
            <strong>Message:</strong><br>
            $($Alert.message)
        </div>
        <h3>Details</h3>
        $detailsHtml
    </div>
    <div class="footer">
        Phoenix AI Security Sentinel<br>
        This is an automated alert. Please investigate immediately for critical/high severity alerts.
    </div>
</body>
</html>
"@

        $headers = @{
            "Authorization" = "Bearer $($Creds.GraphToken)"
            "Content-Type" = "application/json"
        }

        foreach ($recipient in $recipients) {
            $emailPayload = @{
                message = @{
                    subject = $subject
                    body = @{
                        contentType = "HTML"
                        content = $body
                    }
                    toRecipients = @(
                        @{ emailAddress = @{ address = $recipient } }
                    )
                    importance = if ($Alert.severity -eq "critical") { "high" } else { "normal" }
                }
                saveToSentItems = $false
            } | ConvertTo-Json -Depth 10

            for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
                try {
                    $uri = "https://graph.microsoft.com/v1.0/users/ai@phoenixelectric.life/sendMail"
                    Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $emailPayload -TimeoutSec 30 | Out-Null
                    Write-Log "INFO" "Alert email sent to $recipient"
                    break
                }
                catch {
                    Write-Log "WARN" "Email to $recipient attempt $attempt failed: $($_.Exception.Message)"
                    if ($attempt -lt $maxRetries) {
                        Start-Sleep -Milliseconds ($retryDelay * $attempt)
                    } else {
                        Write-Log "ERROR" "Failed to send alert email to $recipient after $maxRetries attempts"
                    }
                }
            }
        }
    }

    $script:MonitoringStats.AlertsGenerated++
}

# ============================================================================
# SECTION 8: AUDIT REPORT
# ============================================================================

function Get-SecurityAuditReport {
    param(
        [int]$Hours = 24,
        [hashtable]$Creds
    )

    Write-Log "INFO" "Generating security audit report for last $Hours hours..."

    $events = Get-RecentSecurityEvents -Minutes ($Hours * 60) -Creds $Creds
    $alerts = Get-RecentSecurityAlerts -Hours $Hours -Creds $Creds

    # Aggregate statistics
    $byType = @{}
    $bySeverity = @{}
    $byComponent = @{}

    foreach ($event in $events) {
        # By type
        if (-not $byType[$event.eventType]) { $byType[$event.eventType] = 0 }
        $byType[$event.eventType]++

        # By severity
        if (-not $bySeverity[$event.severity]) { $bySeverity[$event.severity] = 0 }
        $bySeverity[$event.severity]++

        # By component
        $comp = $event.source.component
        if (-not $byComponent[$comp]) { $byComponent[$comp] = 0 }
        $byComponent[$comp]++
    }

    # Authentication stats
    $authEvents = $events | Where-Object { $_.eventType -eq "authentication" }
    $authFailures = ($authEvents | Where-Object { $_.event.result -eq "failure" }).Count
    $authSuccessRate = if ($authEvents.Count -gt 0) { 1 - ($authFailures / $authEvents.Count) } else { 1.0 }

    # API stats
    $apiEvents = $events | Where-Object { $_.eventType -eq "api_call" }
    $apiErrors = ($apiEvents | Where-Object { $_.event.result -ne "success" }).Count
    $apiErrorRate = if ($apiEvents.Count -gt 0) { $apiErrors / $apiEvents.Count } else { 0 }

    $avgResponseMs = 0
    $apiWithDuration = $apiEvents | Where-Object { $_.event.details.durationMs }
    if ($apiWithDuration.Count -gt 0) {
        $durations = @($apiWithDuration | ForEach-Object { $_.event.details.durationMs } | Where-Object { $_ -ne $null })
        if ($durations.Count -gt 0) {
            $avgResponseMs = [math]::Round(($durations | Measure-Object -Average).Average, 0)
        }
    }

    # Write operation stats
    $writeEvents = $events | Where-Object { $_.flags.writeOperation }
    $approvedWrites = ($writeEvents | Where-Object { $_.event.details.approvalId }).Count

    # Alert stats
    $alertsBySeverity = @{}
    foreach ($alert in $alerts) {
        if (-not $alertsBySeverity[$alert.severity]) { $alertsBySeverity[$alert.severity] = 0 }
        $alertsBySeverity[$alert.severity]++
    }

    $report = @{
        id = "audit_$((Get-Date).ToString('yyyyMMdd_HHmmss'))"

        period = @{
            start = (Get-Date).AddHours(-$Hours).ToString("o")
            end = (Get-Date).ToString("o")
            hours = $Hours
        }

        summary = @{
            totalEvents = $events.Count
            byType = $byType
            bySeverity = $bySeverity
            byComponent = $byComponent
        }

        authentication = @{
            totalAttempts = $authEvents.Count
            failures = $authFailures
            successRate = [math]::Round($authSuccessRate, 3)
        }

        apiUsage = @{
            totalCalls = $apiEvents.Count
            errors = $apiErrors
            errorRate = [math]::Round($apiErrorRate, 3)
            avgResponseMs = $avgResponseMs
        }

        writeOperations = @{
            total = $writeEvents.Count
            approved = $approvedWrites
            unapproved = $writeEvents.Count - $approvedWrites
        }

        alerts = @{
            generated = $alerts.Count
            bySeverity = $alertsBySeverity
            unresolved = ($alerts | Where-Object { $_.status -ne "resolved" }).Count
        }

        partitionKey = "security_audit"
        generatedAt = (Get-Date).ToString("o")
    }

    return $report
}

function Format-DailySecurityReport {
    param(
        [hashtable]$Report,
        [hashtable]$Creds
    )

    $card = @{
        "@type" = "MessageCard"
        "@context" = "http://schema.org/extensions"
        "themeColor" = "2C3E50"
        "summary" = "🔒 Daily Security Report"
        "sections" = @(
            @{
                "activityTitle" = "🔒 Daily Security Report"
                "activitySubtitle" = (Get-Date).ToString("MMMM d, yyyy")
                "facts" = @(
                    @{ "name" = "Total Events"; "value" = "$($Report.summary.totalEvents)" }
                    @{ "name" = "API Calls"; "value" = "$($Report.apiUsage.totalCalls)" }
                    @{ "name" = "API Error Rate"; "value" = "$([math]::Round($Report.apiUsage.errorRate * 100, 1))%" }
                    @{ "name" = "Auth Success Rate"; "value" = "$([math]::Round($Report.authentication.successRate * 100, 1))%" }
                    @{ "name" = "Write Operations"; "value" = "$($Report.writeOperations.total)" }
                    @{ "name" = "Alerts Generated"; "value" = "$($Report.alerts.generated)" }
                    @{ "name" = "Unresolved Alerts"; "value" = "$($Report.alerts.unresolved)" }
                )
                "markdown" = $true
            }
        )
    }

    # Add alert breakdown if any
    if ($Report.alerts.generated -gt 0) {
        $alertDetails = ""
        foreach ($severity in $Report.alerts.bySeverity.Keys) {
            $alertDetails += "• $severity`: $($Report.alerts.bySeverity[$severity])`n"
        }

        $card.sections += @{
            "activityTitle" = "⚠️ Alert Summary"
            "text" = $alertDetails
        }
    }

    # Status indicator
    $statusEmoji = "✅"
    $statusText = "All systems healthy"

    if ($Report.alerts.generated -gt 0 -and $Report.alerts.bySeverity["critical"]) {
        $statusEmoji = "🚨"
        $statusText = "Critical issues detected"
    } elseif ($Report.apiUsage.errorRate -gt 0.05) {
        $statusEmoji = "⚠️"
        $statusText = "Elevated error rate"
    } elseif ($Report.alerts.unresolved -gt 0) {
        $statusEmoji = "🔔"
        $statusText = "Unresolved alerts pending"
    }

    $card.sections += @{
        "activityTitle" = "System Status"
        "text" = "$statusEmoji $statusText"
    }

    return $card
}

# ============================================================================
# SECTION 9: MAIN EXECUTION
# ============================================================================

Write-Log "INFO" "═══════════════════════════════════════════════════════════════"
Write-Log "INFO" "Phoenix AI Security Sentinel starting..."
Write-Log "INFO" "Mode: $Mode | Lookback: $LookbackMinutes minutes"
Write-Log "INFO" "═══════════════════════════════════════════════════════════════"

try {
    # Load credentials
    Write-Log "INFO" "Loading credentials from Key Vault..."

    $kvToken = Get-ManagedIdentityToken -Resource "https://vault.azure.net"
    $vaultName = (Get-AutomationVariable -Name 'VaultName').Trim()

    $creds = @{
        M365TenantId = (Get-AutomationVariable -Name 'TenantId').Trim()
        GraphClientId = (Get-AutomationVariable -Name 'CourierAppId').Trim()
        GraphClientSecret = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName "PhoenixMailCourierSecret" -AccessToken $kvToken
        CosmosAccount = "phoenix-ai-memory"
        CosmosDb = "phoenix-db"
        CosmosMasterKey = $null
        CosmosEnabled = $false
        TeamsWebhookAI = $null
        TeamsWebhookUrgent = $null
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

    # Try to get Teams webhooks (optional)
    try {
        $creds.TeamsWebhookAI = (Get-AutomationVariable -Name 'TeamsWebhook_AIUpdates').Trim()
    }
    catch {
        Write-Log "WARN" "AI Updates Teams webhook not configured"
    }

    try {
        $creds.TeamsWebhookUrgent = (Get-AutomationVariable -Name 'TeamsWebhook_UrgentAlerts').Trim()
    }
    catch {
        Write-Log "WARN" "Urgent Alerts Teams webhook not configured"
    }

    # Get Graph token for email alerts
    Write-Log "INFO" "Authenticating to Microsoft Graph..."
    $creds.GraphToken = Get-GraphToken -TenantId $creds.M365TenantId -ClientId $creds.GraphClientId -ClientSecret $creds.GraphClientSecret

    # Clear sensitive secret
    $creds.GraphClientSecret = $null

    Write-Log "INFO" "Authentication complete"

    switch ($Mode) {
        "monitor" {
            if (-not $creds.CosmosEnabled) {
                Write-Log "WARN" "Cosmos DB not available - security monitoring requires Cosmos for event storage"
                Write-Log "INFO" "Running secret health check only..."

                $allAlerts = @()
                $secretAlerts = Test-SecretHealth -Creds $creds
                $allAlerts += $secretAlerts

                foreach ($alert in $allAlerts) {
                    Send-SecurityAlertNotification -Alert $alert -Creds $creds
                }

                if ($allAlerts.Count -eq 0) {
                    Write-Log "INFO" "✓ Secret health check passed"
                }
            }
            else {
                Write-Log "INFO" "Running security checks..."

                $allAlerts = @()

                # Run all health checks
                Write-Log "INFO" "─────────────────────────────────────────────────────────────"
                $authAlerts = Test-AuthenticationHealth -Creds $creds
                $allAlerts += $authAlerts

                Write-Log "INFO" "─────────────────────────────────────────────────────────────"
                $apiAlerts = Test-ApiHealth -Creds $creds
                $allAlerts += $apiAlerts

                Write-Log "INFO" "─────────────────────────────────────────────────────────────"
                $writeAlerts = Test-WriteOperationHealth -Creds $creds
                $allAlerts += $writeAlerts

                Write-Log "INFO" "─────────────────────────────────────────────────────────────"
                $secretAlerts = Test-SecretHealth -Creds $creds
                $allAlerts += $secretAlerts

                Write-Log "INFO" "─────────────────────────────────────────────────────────────"
                $anomalyAlerts = Test-AnomalyDetection -Creds $creds
                $allAlerts += $anomalyAlerts

                Write-Log "INFO" "─────────────────────────────────────────────────────────────"
                $systemAlerts = Test-SystemHealth -Creds $creds
                $allAlerts += $systemAlerts

                Write-Log "INFO" "─────────────────────────────────────────────────────────────"
                Write-Log "INFO" "Security checks complete. Found $($allAlerts.Count) issues"

                # Process and send alerts
                foreach ($alert in $allAlerts) {
                    # Create alert ID
                    $alertId = "alert_$((Get-Date).ToString('yyyyMMdd_HHmmss'))_$([guid]::NewGuid().ToString().Substring(0,8))"

                    $alertDoc = @{
                        id = $alertId
                        timestamp = (Get-Date).ToUniversalTime().ToString("o")
                        type = $alert.type
                        severity = $alert.severity
                        message = $alert.message
                        details = $alert.details
                        status = "new"
                        acknowledgedBy = $null
                        acknowledgedAt = $null
                        resolvedBy = $null
                        resolvedAt = $null
                        partitionKey = "security_alerts"
                    }

                    # Save to Cosmos
                    Write-SecurityAlert -Alert $alertDoc -Creds $creds | Out-Null

                    # Send notification
                    Send-SecurityAlertNotification -Alert $alert -Creds $creds
                }

                if ($allAlerts.Count -eq 0) {
                    Write-Log "INFO" "✓ All security checks passed"
                }
            }
        }

        "audit" {
            if (-not $creds.CosmosEnabled) {
                Write-Log "WARN" "Cosmos DB not available - audit mode requires Cosmos"
                $report = @{ Status = "Skipped"; Reason = "Cosmos DB not configured" }
            }
            else {
                Write-Log "INFO" "Generating security audit report..."
                $report = Get-SecurityAuditReport -Hours 24 -Creds $creds
            }

            Write-Output ($report | ConvertTo-Json -Depth 15)
        }

        "report" {
            if (-not $creds.CosmosEnabled) {
                Write-Log "WARN" "Cosmos DB not available - report mode requires Cosmos"
                $report = @{ Status = "Skipped"; Reason = "Cosmos DB not configured" }
            }
            else {
                Write-Log "INFO" "Generating and sending daily security summary..."

                $report = Get-SecurityAuditReport -Hours 24 -Creds $creds
                $card = Format-DailySecurityReport -Report $report -Creds $creds

                # Send to Teams
                if ($creds.TeamsWebhookAI) {
                    try {
                        $payload = $card | ConvertTo-Json -Depth 15
                        Invoke-RestMethod -Uri $creds.TeamsWebhookAI -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 30 | Out-Null
                        Write-Log "INFO" "Daily security report sent to Teams"
                    }
                    catch {
                        Write-Log "ERROR" "Failed to send report to Teams: $($_.Exception.Message)"
                    }
                }
            }

            Write-Output ($report | ConvertTo-Json -Depth 15)
        }

        "alert" {
            if (-not $AlertId) {
                throw "AlertId parameter required for alert mode"
            }

            if (-not $creds.CosmosEnabled) {
                Write-Log "WARN" "Cosmos DB not available - alert mode requires Cosmos"
            }
            else {
                Write-Log "INFO" "Processing alert: $AlertId"

                # This mode would typically be used to acknowledge or resolve alerts
                # For now, just display the alert info
                $alerts = Get-RecentSecurityAlerts -Hours 168 -Creds $creds  # 7 days
                $alert = $alerts | Where-Object { $_.id -eq $AlertId }

                if ($alert) {
                    Write-Output ($alert | ConvertTo-Json -Depth 10)
                } else {
                    Write-Log "WARN" "Alert not found: $AlertId"
                }
            }
        }
    }

    # Final summary
    Write-Log "INFO" "═══════════════════════════════════════════════════════════════"
    Write-Log "INFO" "SECURITY MONITORING COMPLETE"
    Write-Log "INFO" "═══════════════════════════════════════════════════════════════"
    Write-Log "INFO" "Events Processed: $($script:MonitoringStats.EventsProcessed)"
    Write-Log "INFO" "Alerts Generated: $($script:MonitoringStats.AlertsGenerated)"
    Write-Log "INFO" "Anomalies Detected: $($script:MonitoringStats.AnomaliesDetected)"
    Write-Log "INFO" "Security Issues: $($script:MonitoringStats.SecurityIssues)"
    Write-Log "INFO" "Checks Passed: $($script:MonitoringStats.ChecksPassed)"
    Write-Log "INFO" "Checks Failed: $($script:MonitoringStats.ChecksFailed)"
    if ($script:MonitoringStats.Errors.Count -gt 0) {
        Write-Log "WARN" "Errors: $($script:MonitoringStats.Errors.Count)"
    }

    $result = @{
        Status = "Success"
        Mode = $Mode
        LookbackMinutes = $LookbackMinutes
        Stats = @{
            EventsProcessed = $script:MonitoringStats.EventsProcessed
            AlertsGenerated = $script:MonitoringStats.AlertsGenerated
            AnomaliesDetected = $script:MonitoringStats.AnomaliesDetected
            SecurityIssues = $script:MonitoringStats.SecurityIssues
            ChecksPassed = $script:MonitoringStats.ChecksPassed
            ChecksFailed = $script:MonitoringStats.ChecksFailed
            Errors = $script:MonitoringStats.Errors.Count
        }
        CompletedAt = (Get-Date).ToString("o")
    }
}
catch {
    Write-Log "CRITICAL" "Security monitoring failed: $($_.Exception.Message)"
    Write-Log "ERROR" "Stack trace: $($_.ScriptStackTrace)"

    $result = @{
        Status = "Failed"
        Mode = $Mode
        Error = $_.Exception.Message
        Stats = @{
            EventsProcessed = $script:MonitoringStats.EventsProcessed
            AlertsGenerated = $script:MonitoringStats.AlertsGenerated
            Errors = $script:MonitoringStats.Errors
        }
        FailedAt = (Get-Date).ToString("o")
    }
}

# Output JSON for orchestration
$jsonOutput = $result | ConvertTo-Json -Depth 10 -Compress
Write-Output "---JSON_OUTPUT_START---"
Write-Output $jsonOutput
Write-Output "---JSON_OUTPUT_END---"
