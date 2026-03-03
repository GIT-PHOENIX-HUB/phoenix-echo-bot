<#
.SYNOPSIS
    Phoenix AI Maintenance & Cleanup Runner
.DESCRIPTION
    Performs scheduled maintenance tasks for Phoenix AI Core:
    - Cosmos DB data retention enforcement
    - Stale approval cleanup
    - Old security event archival
    - Failed job retry/cleanup
    - System health verification
    - Storage optimization

    Based on Part 15 (Maintenance & Operations) of the Phoenix AI Playbook.

.NOTES
    Runtime: PS72-Courier (PowerShell 7.2)
    Author: Phoenix Electric AI Team
    Version: 1.1.0
    Source: Part 15 of Phoenix AI Playbook

    SCHEDULE: Sundays 3:00 AM Mountain Time (weekly maintenance)
              Daily 2:00 AM (light cleanup)

    Modes:
    - daily: Quick cleanup (expired approvals, old temp data)
    - weekly: Full maintenance (retention enforcement, optimization)
    - audit: Generate maintenance report without changes
    - single: Run specific task only

    Retention Policies:
    - Security events: 90 days
    - Security alerts: 365 days
    - Approvals (expired): 30 days
    - Tech daily reports: 90 days
    - Estimate tracking: 180 days
    - Invoice tracking: 365 days
#>

#Requires -Modules Az.Accounts, Az.KeyVault

[CmdletBinding()]
param(
    [ValidateSet("daily", "weekly", "audit", "single")]
    [string]$Mode = "daily",

    [ValidateSet("approvals", "security_events", "security_alerts", "tech_daily", "estimate_tracking", "invoice_tracking", "all")]
    [string]$Task = "all",

    [switch]$DryRun = $false,

    [int]$BatchSize = 100
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ============================================================================
# SECTION 1: CONFIGURATION
# ============================================================================

$script:RetentionDays = @{
    security_events = 90
    security_alerts = 365
    approvals = 30           # Expired/completed approvals
    tech_daily = 90
    estimate_tracking = 180
    invoice_tracking = 365
}

$script:MaintenanceStats = @{
    ContainersProcessed = 0
    DocumentsScanned = 0
    DocumentsDeleted = 0
    DocumentsArchived = 0
    Errors = @()
    StartTime = Get-Date
}

$script:ExecutionLog = @()

# ============================================================================
# SECTION 2: LOGGING
# ============================================================================

function Write-Log {
    param(
        [ValidateSet("INFO", "WARN", "ERROR", "DEBUG")]
        [string]$Level = "INFO",
        [Parameter(Mandatory=$true)]
        [string]$Message,
        [string]$Agent = "MAINTENANCE"
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $script:ExecutionLog += @{
        Timestamp = $timestamp
        Level = $Level
        Agent = $Agent
        Message = $Message
    }

    switch ($Level) {
        "WARN"  { Write-Warning "[$timestamp] $Level [$Agent]: $Message" }
        default { Write-Output "[$timestamp] $Level [$Agent]: $Message" }
    }
}

# ============================================================================
# SECTION 3: AUTHENTICATION (REST-based)
# ============================================================================

function Get-ManagedIdentityToken {
    param([Parameter(Mandatory=$true)][string]$Resource)

    $maxRetries = 3
    $retryDelay = 2000

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
                throw "Failed to get managed identity token after $maxRetries attempts"
            }
        }
    }
}

function Get-KeyVaultSecretREST {
    param(
        [Parameter(Mandatory=$true)][string]$VaultName,
        [Parameter(Mandatory=$true)][string]$SecretName,
        [Parameter(Mandatory=$true)][string]$AccessToken
    )

    $maxRetries = 3
    $retryDelay = 2000

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
                throw "Failed to get secret '$SecretName' after $maxRetries attempts"
            }
        }
    }
}

function Get-GraphToken {
    param(
        [Parameter(Mandatory=$true)][string]$TenantId,
        [Parameter(Mandatory=$true)][string]$ClientId,
        [Parameter(Mandatory=$true)][string]$ClientSecret
    )

    $tokenUri = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
    $body = @{
        grant_type = "client_credentials"
        client_id = $ClientId.Trim()
        client_secret = $ClientSecret.Trim()
        scope = "https://graph.microsoft.com/.default"
    }

    try {
        $response = Invoke-RestMethod -Uri $tokenUri -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -TimeoutSec 30
        return $response.access_token
    }
    catch {
        Write-Log "ERROR" "Graph auth failed: $($_.Exception.Message)"
        throw
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

function Get-ExpiredDocuments {
    param(
        [string]$Container,
        [int]$RetentionDays,
        [string]$DateField = "timestamp",
        [hashtable]$Creds
    )

    $cutoffDate = (Get-Date).AddDays(-$RetentionDays).ToUniversalTime().ToString("o")

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/$Container"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-query-enablecrosspartition" = "True"
        "Content-Type" = "application/query+json"
        "x-ms-documentdb-isquery" = "true"
        "x-ms-max-item-count" = "$BatchSize"
    }

    $query = @{
        query = "SELECT c.id, c.partitionKey, c.$DateField FROM c WHERE c.$DateField < @cutoff"
        parameters = @(@{ name = "@cutoff"; value = $cutoffDate })
    } | ConvertTo-Json -Depth 5

    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $query -TimeoutSec 60
        return $response.Documents
    }
    catch {
        Write-Log "ERROR" "Failed to query $Container for expired docs: $($_.Exception.Message)"
        return @()
    }
}

function Get-ExpiredApprovals {
    param([hashtable]$Creds)

    $cutoffDate = (Get-Date).AddDays(-$script:RetentionDays.approvals).ToUniversalTime().ToString("o")

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/approvals"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-query-enablecrosspartition" = "True"
        "Content-Type" = "application/query+json"
        "x-ms-documentdb-isquery" = "true"
        "x-ms-max-item-count" = "$BatchSize"
    }

    # Get expired or completed/denied approvals older than retention
    $query = @{
        query = "SELECT c.id, c.partitionKey, c.timestamp, c.status FROM c WHERE (c.status IN ('expired', 'completed', 'denied') AND c.timestamp < @cutoff) OR (c.status = 'pending' AND c.expiresAt < @now)"
        parameters = @(
            @{ name = "@cutoff"; value = $cutoffDate }
            @{ name = "@now"; value = (Get-Date).ToUniversalTime().ToString("o") }
        )
    } | ConvertTo-Json -Depth 5

    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $query -TimeoutSec 60
        return $response.Documents
    }
    catch {
        Write-Log "ERROR" "Failed to query approvals: $($_.Exception.Message)"
        return @()
    }
}

function Remove-CosmosDocument {
    param(
        [string]$Container,
        [string]$DocumentId,
        [string]$PartitionKey,
        [hashtable]$Creds
    )

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/$Container/docs/$DocumentId"
    $auth = Get-CosmosAuthHeader -Verb "DELETE" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-partitionkey" = "[`"$PartitionKey`"]"
    }

    try {
        Invoke-RestMethod -Uri $uri -Method Delete -Headers $headers -TimeoutSec 30 | Out-Null
        return $true
    }
    catch {
        Write-Log "WARN" "Failed to delete $DocumentId from $Container`: $($_.Exception.Message)"
        return $false
    }
}

function Get-ContainerDocumentCount {
    param(
        [string]$Container,
        [hashtable]$Creds
    )

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/$Container"
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
        query = "SELECT VALUE COUNT(1) FROM c"
        parameters = @()
    } | ConvertTo-Json -Depth 5

    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $query -TimeoutSec 30
        return $response.Documents[0]
    }
    catch {
        return -1
    }
}

# ============================================================================
# SECTION 5: CLEANUP TASKS
# ============================================================================

function Invoke-ApprovalCleanup {
    param(
        [hashtable]$Creds,
        [bool]$IsDryRun
    )

    Write-Log "INFO" "Starting approval cleanup..."

    $expiredApprovals = Get-ExpiredApprovals -Creds $Creds
    Write-Log "INFO" "Found $($expiredApprovals.Count) expired/stale approvals"

    $script:MaintenanceStats.DocumentsScanned += $expiredApprovals.Count

    if ($expiredApprovals.Count -eq 0) {
        return @{
            Container = "approvals"
            Scanned = 0
            Deleted = 0
            Errors = 0
        }
    }

    $deleted = 0
    $errors = 0

    foreach ($approval in $expiredApprovals) {
        if ($IsDryRun) {
            Write-Log "DEBUG" "[DryRun] Would delete approval $($approval.id) (status: $($approval.status))"
            $deleted++
        }
        else {
            $partitionKey = if ($approval.partitionKey) { $approval.partitionKey } else { "approvals" }
            $success = Remove-CosmosDocument -Container "approvals" -DocumentId $approval.id -PartitionKey $partitionKey -Creds $Creds

            if ($success) {
                $deleted++
                $script:MaintenanceStats.DocumentsDeleted++
            }
            else {
                $errors++
            }
        }

        # Throttle to avoid overwhelming Cosmos
        if (-not $IsDryRun -and $deleted % 10 -eq 0) {
            Start-Sleep -Milliseconds 200
        }
    }

    Write-Log "INFO" "Approval cleanup complete: $deleted deleted, $errors errors"

    return @{
        Container = "approvals"
        Scanned = $expiredApprovals.Count
        Deleted = $deleted
        Errors = $errors
    }
}

function Invoke-SecurityEventsCleanup {
    param(
        [hashtable]$Creds,
        [bool]$IsDryRun
    )

    Write-Log "INFO" "Starting security events cleanup (retention: $($script:RetentionDays.security_events) days)..."

    $expiredDocs = Get-ExpiredDocuments -Container "security_events" -RetentionDays $script:RetentionDays.security_events -DateField "timestamp" -Creds $Creds
    Write-Log "INFO" "Found $($expiredDocs.Count) expired security events"

    $script:MaintenanceStats.DocumentsScanned += $expiredDocs.Count

    if ($expiredDocs.Count -eq 0) {
        return @{
            Container = "security_events"
            Scanned = 0
            Deleted = 0
            Errors = 0
        }
    }

    $deleted = 0
    $errors = 0

    foreach ($doc in $expiredDocs) {
        if ($IsDryRun) {
            Write-Log "DEBUG" "[DryRun] Would delete security event $($doc.id)"
            $deleted++
        }
        else {
            $partitionKey = if ($doc.partitionKey) { $doc.partitionKey } else { "security_events" }
            $success = Remove-CosmosDocument -Container "security_events" -DocumentId $doc.id -PartitionKey $partitionKey -Creds $Creds

            if ($success) {
                $deleted++
                $script:MaintenanceStats.DocumentsDeleted++
            }
            else {
                $errors++
            }
        }

        if (-not $IsDryRun -and $deleted % 10 -eq 0) {
            Start-Sleep -Milliseconds 200
        }
    }

    Write-Log "INFO" "Security events cleanup complete: $deleted deleted, $errors errors"

    return @{
        Container = "security_events"
        Scanned = $expiredDocs.Count
        Deleted = $deleted
        Errors = $errors
    }
}

function Invoke-SecurityAlertsCleanup {
    param(
        [hashtable]$Creds,
        [bool]$IsDryRun
    )

    Write-Log "INFO" "Starting security alerts cleanup (retention: $($script:RetentionDays.security_alerts) days)..."

    $expiredDocs = Get-ExpiredDocuments -Container "security_alerts" -RetentionDays $script:RetentionDays.security_alerts -DateField "timestamp" -Creds $Creds
    Write-Log "INFO" "Found $($expiredDocs.Count) expired security alerts"

    $script:MaintenanceStats.DocumentsScanned += $expiredDocs.Count

    if ($expiredDocs.Count -eq 0) {
        return @{
            Container = "security_alerts"
            Scanned = 0
            Deleted = 0
            Errors = 0
        }
    }

    $deleted = 0
    $errors = 0

    foreach ($doc in $expiredDocs) {
        if ($IsDryRun) {
            Write-Log "DEBUG" "[DryRun] Would delete security alert $($doc.id)"
            $deleted++
        }
        else {
            $partitionKey = if ($doc.partitionKey) { $doc.partitionKey } else { "security_alerts" }
            $success = Remove-CosmosDocument -Container "security_alerts" -DocumentId $doc.id -PartitionKey $partitionKey -Creds $Creds

            if ($success) {
                $deleted++
                $script:MaintenanceStats.DocumentsDeleted++
            }
            else {
                $errors++
            }
        }

        if (-not $IsDryRun -and $deleted % 10 -eq 0) {
            Start-Sleep -Milliseconds 200
        }
    }

    Write-Log "INFO" "Security alerts cleanup complete: $deleted deleted, $errors errors"

    return @{
        Container = "security_alerts"
        Scanned = $expiredDocs.Count
        Deleted = $deleted
        Errors = $errors
    }
}

function Invoke-TechDailyCleanup {
    param(
        [hashtable]$Creds,
        [bool]$IsDryRun
    )

    Write-Log "INFO" "Starting tech daily reports cleanup (retention: $($script:RetentionDays.tech_daily) days)..."

    $expiredDocs = Get-ExpiredDocuments -Container "tech_daily" -RetentionDays $script:RetentionDays.tech_daily -DateField "date" -Creds $Creds
    Write-Log "INFO" "Found $($expiredDocs.Count) expired tech daily reports"

    $script:MaintenanceStats.DocumentsScanned += $expiredDocs.Count

    if ($expiredDocs.Count -eq 0) {
        return @{
            Container = "tech_daily"
            Scanned = 0
            Deleted = 0
            Errors = 0
        }
    }

    $deleted = 0
    $errors = 0

    foreach ($doc in $expiredDocs) {
        if ($IsDryRun) {
            Write-Log "DEBUG" "[DryRun] Would delete tech report $($doc.id)"
            $deleted++
        }
        else {
            $partitionKey = if ($doc.partitionKey) { $doc.partitionKey } else { "tech_daily" }
            $success = Remove-CosmosDocument -Container "tech_daily" -DocumentId $doc.id -PartitionKey $partitionKey -Creds $Creds

            if ($success) {
                $deleted++
                $script:MaintenanceStats.DocumentsDeleted++
            }
            else {
                $errors++
            }
        }

        if (-not $IsDryRun -and $deleted % 10 -eq 0) {
            Start-Sleep -Milliseconds 200
        }
    }

    Write-Log "INFO" "Tech daily cleanup complete: $deleted deleted, $errors errors"

    return @{
        Container = "tech_daily"
        Scanned = $expiredDocs.Count
        Deleted = $deleted
        Errors = $errors
    }
}

function Invoke-EstimateTrackingCleanup {
    param(
        [hashtable]$Creds,
        [bool]$IsDryRun
    )

    Write-Log "INFO" "Starting estimate tracking cleanup (retention: $($script:RetentionDays.estimate_tracking) days)..."

    $expiredDocs = Get-ExpiredDocuments -Container "estimate_tracking" -RetentionDays $script:RetentionDays.estimate_tracking -DateField "lastUpdated" -Creds $Creds
    Write-Log "INFO" "Found $($expiredDocs.Count) expired estimate tracking records"

    $script:MaintenanceStats.DocumentsScanned += $expiredDocs.Count

    if ($expiredDocs.Count -eq 0) {
        return @{
            Container = "estimate_tracking"
            Scanned = 0
            Deleted = 0
            Errors = 0
        }
    }

    $deleted = 0
    $errors = 0

    foreach ($doc in $expiredDocs) {
        if ($IsDryRun) {
            Write-Log "DEBUG" "[DryRun] Would delete estimate tracking $($doc.id)"
            $deleted++
        }
        else {
            $partitionKey = if ($doc.partitionKey) { $doc.partitionKey } else { "estimate_tracking" }
            $success = Remove-CosmosDocument -Container "estimate_tracking" -DocumentId $doc.id -PartitionKey $partitionKey -Creds $Creds

            if ($success) {
                $deleted++
                $script:MaintenanceStats.DocumentsDeleted++
            }
            else {
                $errors++
            }
        }

        if (-not $IsDryRun -and $deleted % 10 -eq 0) {
            Start-Sleep -Milliseconds 200
        }
    }

    Write-Log "INFO" "Estimate tracking cleanup complete: $deleted deleted, $errors errors"

    return @{
        Container = "estimate_tracking"
        Scanned = $expiredDocs.Count
        Deleted = $deleted
        Errors = $errors
    }
}

function Invoke-InvoiceTrackingCleanup {
    param(
        [hashtable]$Creds,
        [bool]$IsDryRun
    )

    Write-Log "INFO" "Starting invoice tracking cleanup (retention: $($script:RetentionDays.invoice_tracking) days)..."

    $expiredDocs = Get-ExpiredDocuments -Container "invoice_tracking" -RetentionDays $script:RetentionDays.invoice_tracking -DateField "lastUpdated" -Creds $Creds
    Write-Log "INFO" "Found $($expiredDocs.Count) expired invoice tracking records"

    $script:MaintenanceStats.DocumentsScanned += $expiredDocs.Count

    if ($expiredDocs.Count -eq 0) {
        return @{
            Container = "invoice_tracking"
            Scanned = 0
            Deleted = 0
            Errors = 0
        }
    }

    $deleted = 0
    $errors = 0

    foreach ($doc in $expiredDocs) {
        if ($IsDryRun) {
            Write-Log "DEBUG" "[DryRun] Would delete invoice tracking $($doc.id)"
            $deleted++
        }
        else {
            $partitionKey = if ($doc.partitionKey) { $doc.partitionKey } else { "invoice_tracking" }
            $success = Remove-CosmosDocument -Container "invoice_tracking" -DocumentId $doc.id -PartitionKey $partitionKey -Creds $Creds

            if ($success) {
                $deleted++
                $script:MaintenanceStats.DocumentsDeleted++
            }
            else {
                $errors++
            }
        }

        if (-not $IsDryRun -and $deleted % 10 -eq 0) {
            Start-Sleep -Milliseconds 200
        }
    }

    Write-Log "INFO" "Invoice tracking cleanup complete: $deleted deleted, $errors errors"

    return @{
        Container = "invoice_tracking"
        Scanned = $expiredDocs.Count
        Deleted = $deleted
        Errors = $errors
    }
}

# ============================================================================
# SECTION 6: AUDIT REPORT
# ============================================================================

function Get-MaintenanceAuditReport {
    param([hashtable]$Creds)

    Write-Log "INFO" "Generating maintenance audit report..."

    $containers = @(
        "security_events",
        "security_alerts",
        "approvals",
        "tech_daily",
        "estimate_tracking",
        "invoice_tracking",
        "customers",
        "jobs",
        "interactions",
        "pricebook"
    )

    $containerStats = @{}

    foreach ($container in $containers) {
        $count = Get-ContainerDocumentCount -Container $container -Creds $Creds
        $containerStats[$container] = @{
            DocumentCount = $count
            RetentionDays = if ($script:RetentionDays[$container]) { $script:RetentionDays[$container] } else { "N/A" }
        }

        Write-Log "INFO" "Container $container`: $count documents"
    }

    # Get counts of documents that would be deleted
    $pendingCleanup = @{}

    foreach ($container in @("security_events", "security_alerts", "tech_daily", "estimate_tracking", "invoice_tracking")) {
        if ($script:RetentionDays[$container]) {
            $dateField = switch ($container) {
                "tech_daily" { "date" }
                { $_ -in @("estimate_tracking", "invoice_tracking") } { "lastUpdated" }
                default { "timestamp" }
            }
            $expired = Get-ExpiredDocuments -Container $container -RetentionDays $script:RetentionDays[$container] -DateField $dateField -Creds $Creds
            $pendingCleanup[$container] = $expired.Count
        }
    }

    # Get expired approvals count
    $expiredApprovals = Get-ExpiredApprovals -Creds $Creds
    $pendingCleanup["approvals"] = $expiredApprovals.Count

    $report = @{
        GeneratedAt = (Get-Date).ToString("o")
        ContainerStats = $containerStats
        PendingCleanup = $pendingCleanup
        TotalPendingDeletion = ($pendingCleanup.Values | Measure-Object -Sum).Sum
        RetentionPolicies = $script:RetentionDays
    }

    return $report
}

# ============================================================================
# SECTION 7: TEAMS NOTIFICATION
# ============================================================================

function Send-MaintenanceReport {
    param(
        [hashtable]$Results,
        [string]$WebhookUrl
    )

    if (-not $WebhookUrl) {
        Write-Log "WARN" "No Teams webhook configured, skipping notification"
        return
    }

    $totalDeleted = ($Results.TaskResults | ForEach-Object { $_.Deleted } | Measure-Object -Sum).Sum
    $totalErrors = ($Results.TaskResults | ForEach-Object { $_.Errors } | Measure-Object -Sum).Sum

    $statusColor = if ($totalErrors -gt 0) { "FFA500" } else { "27AE60" }
    $statusEmoji = if ($totalErrors -gt 0) { "⚠️" } else { "✅" }

    $facts = @(
        @{ "name" = "Mode"; "value" = $Results.Mode }
        @{ "name" = "Duration"; "value" = "$($Results.DurationSeconds) seconds" }
        @{ "name" = "Documents Scanned"; "value" = "$($Results.Stats.DocumentsScanned)" }
        @{ "name" = "Documents Deleted"; "value" = "$totalDeleted" }
    )

    if ($totalErrors -gt 0) {
        $facts += @{ "name" = "Errors"; "value" = "$totalErrors" }
    }

    $card = @{
        "@type" = "MessageCard"
        "@context" = "http://schema.org/extensions"
        "themeColor" = $statusColor
        "summary" = "$statusEmoji Maintenance Complete"
        "sections" = @(
            @{
                "activityTitle" = "$statusEmoji Phoenix AI Maintenance Complete"
                "activitySubtitle" = (Get-Date).ToString("yyyy-MM-dd h:mm tt")
                "facts" = $facts
                "markdown" = $true
            }
        )
    }

    # Add container breakdown
    if ($Results.TaskResults.Count -gt 0) {
        $breakdownText = ""
        foreach ($task in $Results.TaskResults) {
            $breakdownText += "• $($task.Container): $($task.Deleted) deleted`n"
        }

        $card.sections += @{
            "activityTitle" = "Container Breakdown"
            "text" = $breakdownText
        }
    }

    try {
        $payload = $card | ConvertTo-Json -Depth 15
        Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 30 | Out-Null
        Write-Log "INFO" "Teams maintenance report sent"
    }
    catch {
        Write-Log "WARN" "Failed to send Teams report: $($_.Exception.Message)"
    }
}

# ============================================================================
# SECTION 8: MAIN EXECUTION
# ============================================================================

Write-Log "INFO" "==================================================================="
Write-Log "INFO" "Phoenix AI Maintenance & Cleanup starting..."
Write-Log "INFO" "Mode: $Mode | Task: $Task | DryRun: $DryRun"
Write-Log "INFO" "==================================================================="

try {
    # Load credentials
    Write-Log "INFO" "Loading credentials from Key Vault..."

    $kvToken = Get-ManagedIdentityToken -Resource "https://vault.azure.net"
    $vaultName = (Get-AutomationVariable -Name 'VaultName').Trim()

    $creds = @{
        CosmosAccount = "phoenix-ai-memory"
        CosmosDb = "phoenix-db"
        CosmosMasterKey = $null
        CosmosEnabled = $false
        TeamsWebhook = $null
    }

    # Try to get Cosmos DB key (required for maintenance)
    try {
        $creds.CosmosMasterKey = Get-KeyVaultSecretREST -VaultName $vaultName -SecretName "COSMOS-DB-KEY" -AccessToken $kvToken
        $creds.CosmosEnabled = $true
    }
    catch {
        Write-Log "ERROR" "Cosmos DB not configured - maintenance cannot run without Cosmos"
        throw "Cosmos DB is required for maintenance operations but is not configured"
    }

    # Try to get Teams webhook
    try {
        $creds.TeamsWebhook = (Get-AutomationVariable -Name 'TeamsWebhook_AIUpdates').Trim()
    }
    catch {
        Write-Log "WARN" "Teams webhook not configured"
    }

    Write-Log "INFO" "Credentials loaded"

    $taskResults = @()

    switch ($Mode) {
        "audit" {
            Write-Log "INFO" "Running audit mode (no changes)..."
            $auditReport = Get-MaintenanceAuditReport -Creds $creds

            Write-Output ""
            Write-Output "==================================================================="
            Write-Output "MAINTENANCE AUDIT REPORT"
            Write-Output "==================================================================="
            Write-Output ($auditReport | ConvertTo-Json -Depth 10)

            $result = @{
                Status = "Success"
                Mode = "audit"
                AuditReport = $auditReport
            }
        }

        "daily" {
            Write-Log "INFO" "Running daily maintenance..."

            # Daily: Only approvals cleanup
            $taskResults += Invoke-ApprovalCleanup -Creds $creds -IsDryRun $DryRun
            $script:MaintenanceStats.ContainersProcessed++

            $result = @{
                Status = "Success"
                Mode = "daily"
                DryRun = $DryRun.IsPresent
                TaskResults = $taskResults
                Stats = $script:MaintenanceStats
                DurationSeconds = [math]::Round(((Get-Date) - $script:MaintenanceStats.StartTime).TotalSeconds, 1)
            }
        }

        "weekly" {
            Write-Log "INFO" "Running weekly full maintenance..."

            $tasksToRun = if ($Task -eq "all") {
                @("approvals", "security_events", "security_alerts", "tech_daily", "estimate_tracking", "invoice_tracking")
            } else {
                @($Task)
            }

            foreach ($taskName in $tasksToRun) {
                Write-Log "INFO" "─────────────────────────────────────────────────────────────"

                switch ($taskName) {
                    "approvals" {
                        $taskResults += Invoke-ApprovalCleanup -Creds $creds -IsDryRun $DryRun
                    }
                    "security_events" {
                        $taskResults += Invoke-SecurityEventsCleanup -Creds $creds -IsDryRun $DryRun
                    }
                    "security_alerts" {
                        $taskResults += Invoke-SecurityAlertsCleanup -Creds $creds -IsDryRun $DryRun
                    }
                    "tech_daily" {
                        $taskResults += Invoke-TechDailyCleanup -Creds $creds -IsDryRun $DryRun
                    }
                    "estimate_tracking" {
                        $taskResults += Invoke-EstimateTrackingCleanup -Creds $creds -IsDryRun $DryRun
                    }
                    "invoice_tracking" {
                        $taskResults += Invoke-InvoiceTrackingCleanup -Creds $creds -IsDryRun $DryRun
                    }
                }

                $script:MaintenanceStats.ContainersProcessed++
            }

            $result = @{
                Status = "Success"
                Mode = "weekly"
                DryRun = $DryRun.IsPresent
                TaskResults = $taskResults
                Stats = $script:MaintenanceStats
                DurationSeconds = [math]::Round(((Get-Date) - $script:MaintenanceStats.StartTime).TotalSeconds, 1)
            }
        }

        "single" {
            Write-Log "INFO" "Running single task: $Task..."

            switch ($Task) {
                "approvals" {
                    $taskResults += Invoke-ApprovalCleanup -Creds $creds -IsDryRun $DryRun
                }
                "security_events" {
                    $taskResults += Invoke-SecurityEventsCleanup -Creds $creds -IsDryRun $DryRun
                }
                "security_alerts" {
                    $taskResults += Invoke-SecurityAlertsCleanup -Creds $creds -IsDryRun $DryRun
                }
                "tech_daily" {
                    $taskResults += Invoke-TechDailyCleanup -Creds $creds -IsDryRun $DryRun
                }
                "estimate_tracking" {
                    $taskResults += Invoke-EstimateTrackingCleanup -Creds $creds -IsDryRun $DryRun
                }
                "invoice_tracking" {
                    $taskResults += Invoke-InvoiceTrackingCleanup -Creds $creds -IsDryRun $DryRun
                }
                default {
                    throw "Unknown task: $Task"
                }
            }

            $script:MaintenanceStats.ContainersProcessed++

            $result = @{
                Status = "Success"
                Mode = "single"
                Task = $Task
                DryRun = $DryRun.IsPresent
                TaskResults = $taskResults
                Stats = $script:MaintenanceStats
                DurationSeconds = [math]::Round(((Get-Date) - $script:MaintenanceStats.StartTime).TotalSeconds, 1)
            }
        }
    }

    # Send Teams notification for non-audit modes
    if ($Mode -ne "audit" -and -not $DryRun -and $creds.TeamsWebhook) {
        Send-MaintenanceReport -Results $result -WebhookUrl $creds.TeamsWebhook
    }

    Write-Log "INFO" "==================================================================="
    Write-Log "INFO" "MAINTENANCE COMPLETE"
    Write-Log "INFO" "==================================================================="
    Write-Log "INFO" "Containers Processed: $($script:MaintenanceStats.ContainersProcessed)"
    Write-Log "INFO" "Documents Scanned: $($script:MaintenanceStats.DocumentsScanned)"
    Write-Log "INFO" "Documents Deleted: $($script:MaintenanceStats.DocumentsDeleted)"
    Write-Log "INFO" "Duration: $([math]::Round(((Get-Date) - $script:MaintenanceStats.StartTime).TotalSeconds, 1)) seconds"
}
catch {
    Write-Log "ERROR" "Maintenance failed: $($_.Exception.Message)"
    Write-Log "ERROR" "Stack: $($_.ScriptStackTrace)"

    $result = @{
        Status = "Failed"
        Mode = $Mode
        Error = $_.Exception.Message
        Stats = $script:MaintenanceStats
    }
}

# Output JSON
$jsonOutput = $result | ConvertTo-Json -Depth 10 -Compress
Write-Output "---JSON_OUTPUT_START---"
Write-Output $jsonOutput
Write-Output "---JSON_OUTPUT_END---"
