<#
.SYNOPSIS
    Phoenix AI Invoice Collection Automation
.DESCRIPTION
    Tracks unpaid invoices, sends payment reminders at configured intervals,
    escalates overdue accounts, and syncs with QuickBooks.

    Features:
    - 5-stage collection timeline (Day 7, 14, 21, 30, 45)
    - Member customers get 7-day grace period
    - High-value invoices ($2500+) get personal attention
    - Service hold recommendations at 45 days
    - Full tracking history in Cosmos DB
    - Aging report with priority action items
    - Draft emails for human approval (never auto-sends)

.NOTES
    Runtime: PS72-Courier (PowerShell 7.2)
    Author: Phoenix Electric AI Team
    Version: 1.1.0
    Source: Part 9 of Phoenix AI Playbook

    CRITICAL RULES:
    1. NEVER auto-send emails - always create drafts for approval
    2. Respect doNotContact flag
    3. Stop reminders if customer disputes invoice
    4. Escalate at Day 45, don't harass
    5. Member customers get gentler treatment

    COLLECTION TIMELINE:
    Day 7:  Friendly reminder
    Day 14: Second reminder + payment link
    Day 21: Overdue notice
    Day 30: Final notice
    Day 45: Account hold + escalate
#>

[CmdletBinding()]
param(
    [ValidateSet("process", "report", "single", "sync")]
    [string]$Mode = "process",

    [string]$SingleInvoiceId = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ============================================================================
# SECTION 1: CONFIGURATION
# ============================================================================

$script:CollectionConfig = @{
    # Collection schedule (days since invoice)
    Schedule = @(
        @{ Day = 7;  Stage = 1; Template = "friendly_reminder"; Severity = "LOW" }
        @{ Day = 14; Stage = 2; Template = "second_reminder"; Severity = "LOW" }
        @{ Day = 21; Stage = 3; Template = "overdue_notice"; Severity = "MEDIUM" }
        @{ Day = 30; Stage = 4; Template = "final_notice"; Severity = "HIGH" }
        @{ Day = 45; Stage = 5; Template = "account_hold"; Severity = "CRITICAL" }
    )

    # Member customers get extended grace
    MemberGraceDays = 7

    # High-value threshold (gets personal attention)
    HighValueThreshold = 2500

    # Minimum balance to pursue (don't chase $5 invoices)
    MinimumBalanceThreshold = 25

    # Service hold threshold (days overdue)
    ServiceHoldThreshold = 45

    # Sender configuration
    BillingSender = @{
        Email = "accounting@phoenixelectric.life"
        Name = "Phoenix Electric Billing"
    }

    ManagementSender = @{
        Email = "shane@phoenixelectric.life"
        Name = "Shane Warehime"
    }

    # Payment link base URL
    PaymentLinkBase = "https://pay.phoenixelectric.life/invoice/"
}

# ============================================================================
# SECTION 2: EMAIL TEMPLATES
# ============================================================================

$script:CollectionTemplates = @{

    # Stage 1: Day 7 - Friendly Reminder
    "friendly_reminder" = @{
        Subject = "Friendly reminder - Invoice #{{InvoiceNumber}}"
        Body = @"
Hi {{CustomerFirstName}},

Just a friendly reminder that invoice #{{InvoiceNumber}} for `${{InvoiceTotal}} is due {{DueStatus}}.

This was for the work we completed at {{JobAddress}}:
{{JobSummary}}

You can pay by:
- Check mailed to: PO Box 1234, Edwards CO 81632
- Credit card: Call us at (970) 445-9119
- Online: {{PaymentLink}}

If you've already sent payment, thank you! Please disregard this reminder.

Questions? Just reply to this email.

Best,
Phoenix Electric
"@
    }

    # Stage 2: Day 14 - Second Reminder
    "second_reminder" = @{
        Subject = "Payment reminder - Invoice #{{InvoiceNumber}} (`${{InvoiceTotal}})"
        Body = @"
Hi {{CustomerFirstName}},

This is a reminder that invoice #{{InvoiceNumber}} for `${{InvoiceTotal}} is now {{DaysOld}} days old.

Original due date: {{DueDate}}
Current balance: `${{Balance}}

For your convenience, you can pay online anytime:
{{PaymentLink}}

Or call us at (970) 445-9119 to pay by phone.

If you have any questions about this invoice or need to discuss payment arrangements, please don't hesitate to reach out.

Thank you,
Phoenix Electric Billing
"@
    }

    # Stage 3: Day 21 - Overdue Notice
    "overdue_notice" = @{
        Subject = "OVERDUE: Invoice #{{InvoiceNumber}} - Action Required"
        Body = @"
Hi {{CustomerFirstName}},

Invoice #{{InvoiceNumber}} is now {{DaysOverdue}} days past due.

Invoice Amount: `${{InvoiceTotal}}
Due Date: {{DueDate}}
Days Overdue: {{DaysOverdue}}

We understand that sometimes invoices slip through the cracks. If you're experiencing any difficulties, please contact us to discuss payment options.

To avoid any disruption to future service, please remit payment as soon as possible:
{{PaymentLink}}

If you believe this invoice was paid or have questions, please reply to this email or call (970) 445-9119.

Thank you for your prompt attention to this matter.

Phoenix Electric Billing
"@
    }

    # Stage 4: Day 30 - Final Notice
    "final_notice" = @{
        Subject = "FINAL NOTICE: Invoice #{{InvoiceNumber}} - Account Review"
        Body = @"
{{CustomerFirstName}},

This is a final notice regarding invoice #{{InvoiceNumber}}.

Amount Due: `${{Balance}}
Days Overdue: {{DaysOverdue}}

Your account is scheduled for review on {{ReviewDate}}. Accounts with outstanding balances may be subject to:
- Service hold for future work requests
- Late fees per our service agreement
- Referral to collections

We want to resolve this amicably. If you need to set up a payment plan or discuss your account, please contact us immediately at (970) 445-9119.

Pay now to avoid further action:
{{PaymentLink}}

Phoenix Electric Billing
"@
    }

    # Stage 5: Day 45 - Account Hold Notice
    "account_hold" = @{
        Subject = "ACCOUNT HOLD: Phoenix Electric - Immediate Action Required"
        Body = @"
{{CustomerFirstName}},

Due to the outstanding balance of `${{Balance}} on invoice #{{InvoiceNumber}}, your account has been placed on hold.

This means:
- New service requests cannot be scheduled
- Existing appointments may be subject to review

Invoice Details:
- Invoice Number: {{InvoiceNumber}}
- Original Amount: `${{InvoiceTotal}}
- Current Balance: `${{Balance}}
- Days Overdue: {{DaysOverdue}}

To restore your account to good standing, please contact us immediately:
- Phone: (970) 445-9119
- Email: accounting@phoenixelectric.life

We value your business and want to find a resolution.

Phoenix Electric Management
"@
    }

    # Special: Payment Plan Confirmation
    "payment_plan_confirmation" = @{
        Subject = "Payment Plan Confirmed - Invoice #{{InvoiceNumber}}"
        Body = @"
Hi {{CustomerFirstName}},

Thank you for setting up a payment plan for invoice #{{InvoiceNumber}}.

Payment Plan Details:
- Total Balance: `${{Balance}}
- Number of Payments: {{PaymentCount}}
- Payment Amount: `${{PaymentAmount}}
- First Payment Due: {{FirstPaymentDate}}
- Payment Schedule: {{PaymentSchedule}}

We'll send a reminder before each payment is due.

If you have any questions or need to modify the plan, please contact us at (970) 445-9119.

Thank you for working with us.

Phoenix Electric Billing
"@
    }

    # Special: Payment Received Thank You
    "payment_received" = @{
        Subject = "Payment Received - Thank You!"
        Body = @"
Hi {{CustomerFirstName}},

Thank you! We've received your payment of `${{PaymentAmount}} for invoice #{{InvoiceNumber}}.

{{#if RemainingBalance}}
Remaining balance: `${{RemainingBalance}}
{{else}}
Your invoice is now paid in full.
{{/if}}

We appreciate your business and look forward to serving you again.

Best,
Phoenix Electric
"@
    }
}

# ============================================================================
# SECTION 3: PROCESSING STATS
# ============================================================================

$script:ProcessingStats = @{
    TotalUnpaid = 0
    TotalOverdue = 0
    TotalValue = 0
    OverdueValue = 0
    RemindersDue = 0
    DraftsCreated = 0
    Escalated = 0
    ServiceHolds = 0
    Skipped = 0
    Errors = 0
}

# ============================================================================
# SECTION 4: LOGGING
# ============================================================================

function Write-Log {
    param(
        [ValidateSet("DEBUG", "INFO", "WARN", "ERROR", "CRITICAL")]
        [string]$Level = "INFO",
        [Parameter(Mandatory=$true)][string]$Message,
        [string]$Agent = "INVOICE_COLLECTION"
    )
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $levelPadded = $Level.PadRight(8)
    Write-Output "[$timestamp] $levelPadded [$Agent]: $Message"
}

# ============================================================================
# SECTION 5: AUTHENTICATION (REST-based, no Az modules)
# ============================================================================

function Get-ManagedIdentityToken {
    param([Parameter(Mandatory=$true)][string]$Resource)

    $maxRetries = 3
    $retryDelay = 2

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $tokenUri = "$($env:IDENTITY_ENDPOINT)?resource=$Resource&api-version=2019-08-01"
            $headers = @{ "X-IDENTITY-HEADER" = $env:IDENTITY_HEADER }
            $response = Invoke-RestMethod -Uri $tokenUri -Headers $headers -Method Get -TimeoutSec 30
            return $response.access_token
        }
        catch {
            if ($attempt -eq $maxRetries) {
                throw "Failed to get managed identity token after $maxRetries attempts: $($_.Exception.Message)"
            }
            Write-Log "WARN" "Token attempt $attempt failed, retrying in ${retryDelay}s..."
            Start-Sleep -Seconds $retryDelay
            $retryDelay *= 2
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
    $retryDelay = 2

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
            if ($attempt -eq $maxRetries) {
                throw "Failed to get secret '$SecretName' after $maxRetries attempts: $($_.Exception.Message)"
            }
            Write-Log "WARN" "Secret retrieval attempt $attempt failed, retrying..."
            Start-Sleep -Seconds $retryDelay
            $retryDelay *= 2
        }
    }
}

function Get-ServiceTitanToken {
    param(
        [Parameter(Mandatory=$true)][string]$ClientId,
        [Parameter(Mandatory=$true)][string]$ClientSecret
    )

    $maxRetries = 3
    $retryDelay = 2

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        try {
            $tokenUri = "https://auth.servicetitan.io/connect/token"
            $body = "grant_type=client_credentials&client_id=$([uri]::EscapeDataString($ClientId.Trim()))&client_secret=$([uri]::EscapeDataString($ClientSecret.Trim()))"
            $response = Invoke-RestMethod -Uri $tokenUri -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -TimeoutSec 30
            return $response.access_token
        }
        catch {
            if ($attempt -eq $maxRetries) {
                throw "Failed to get ServiceTitan token after $maxRetries attempts: $($_.Exception.Message)"
            }
            Write-Log "WARN" "ST token attempt $attempt failed, retrying..."
            Start-Sleep -Seconds $retryDelay
            $retryDelay *= 2
        }
    }
}

function Get-GraphToken {
    param(
        [Parameter(Mandatory=$true)][string]$TenantId,
        [Parameter(Mandatory=$true)][string]$ClientId,
        [Parameter(Mandatory=$true)][string]$ClientSecret
    )

    $maxRetries = 3
    $retryDelay = 2

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
            if ($attempt -eq $maxRetries) {
                throw "Failed to get Graph token after $maxRetries attempts: $($_.Exception.Message)"
            }
            Write-Log "WARN" "Graph token attempt $attempt failed, retrying..."
            Start-Sleep -Seconds $retryDelay
            $retryDelay *= 2
        }
    }
}

# ============================================================================
# SECTION 6: SERVICETITAN INVOICE RETRIEVAL
# ============================================================================

function Get-UnpaidInvoices {
    param([Parameter(Mandatory=$true)][hashtable]$Creds)

    Write-Log "INFO" "Fetching unpaid invoices from ServiceTitan..."

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
        "Content-Type" = "application/json"
    }

    $allInvoices = @()
    $page = 1
    $hasMore = $true
    $maxRetries = 3

    while ($hasMore) {
        $uri = "https://api.servicetitan.io/accounting/v2/tenant/$($Creds.TenantId)/invoices?page=$page&pageSize=100"

        $retryCount = 0
        $success = $false

        while (-not $success -and $retryCount -lt $maxRetries) {
            try {
                $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 60

                if ($response.data -and $response.data.Count -gt 0) {
                    # Filter to only unpaid invoices that aren't voided
                    $unpaid = $response.data | Where-Object {
                        $_.balance -gt 0 -and
                        $_.status -ne "Void" -and
                        $_.status -ne "Canceled"
                    }
                    $allInvoices += $unpaid

                    $page++
                    if ($response.data.Count -lt 100) { $hasMore = $false }
                }
                else {
                    $hasMore = $false
                }

                $success = $true
                Start-Sleep -Milliseconds 100  # Rate limiting
            }
            catch {
                $retryCount++
                if ($retryCount -ge $maxRetries) {
                    Write-Log "ERROR" "Failed to fetch invoices page $page after $maxRetries attempts: $($_.Exception.Message)"
                    $hasMore = $false
                }
                else {
                    Write-Log "WARN" "Invoice fetch attempt $retryCount failed, retrying..."
                    Start-Sleep -Seconds 2
                }
            }
        }
    }

    Write-Log "INFO" "Found $($allInvoices.Count) unpaid invoices"
    return $allInvoices
}

function Get-InvoiceCustomer {
    param(
        [Parameter(Mandatory=$true)][int]$CustomerId,
        [Parameter(Mandatory=$true)][hashtable]$Creds
    )

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    try {
        $uri = "https://api.servicetitan.io/crm/v2/tenant/$($Creds.TenantId)/customers/$CustomerId"
        $customer = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 30
        if ($null -ne $customer.data) { return $customer.data }
        return $customer
    }
    catch {
        Write-Log "WARN" "Could not fetch customer $CustomerId`: $($_.Exception.Message)"
        return $null
    }
}

function Get-CustomerMembership {
    param(
        [Parameter(Mandatory=$true)][int]$CustomerId,
        [Parameter(Mandatory=$true)][hashtable]$Creds
    )

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    try {
        $uri = "https://api.servicetitan.io/memberships/v2/tenant/$($Creds.TenantId)/memberships?customerId=$CustomerId&status=Active"
        $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 30
        $memberships = if ($null -ne $response.data) { @($response.data) } else { @() }
        return ($memberships.Count -gt 0)
    }
    catch {
        Write-Log "WARN" "Could not check membership for customer $CustomerId`: $($_.Exception.Message)"
        return $false
    }
}

function Get-InvoiceJob {
    param(
        [int]$JobId,
        [Parameter(Mandatory=$true)][hashtable]$Creds
    )

    if (-not $JobId -or $JobId -eq 0) { return $null }

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    try {
        $uri = "https://api.servicetitan.io/jpm/v2/tenant/$($Creds.TenantId)/jobs/$JobId"
        $job = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 30
        if ($null -ne $job.data) { return $job.data }
        return $job
    }
    catch {
        Write-Log "WARN" "Could not fetch job $JobId`: $($_.Exception.Message)"
        return $null
    }
}

function Get-SingleInvoice {
    param(
        [Parameter(Mandatory=$true)][string]$InvoiceId,
        [Parameter(Mandatory=$true)][hashtable]$Creds
    )

    $headers = @{
        "Authorization" = "Bearer $($Creds.STToken)"
        "ST-App-Key" = $Creds.STAppKey
    }

    try {
        $uri = "https://api.servicetitan.io/accounting/v2/tenant/$($Creds.TenantId)/invoices/$InvoiceId"
        $invoice = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 30
        if ($null -ne $invoice.data) { return $invoice.data }
        return $invoice
    }
    catch {
        Write-Log "ERROR" "Could not fetch invoice $InvoiceId`: $($_.Exception.Message)"
        return $null
    }
}

# ============================================================================
# SECTION 7: COSMOS DB TRACKING
# ============================================================================

function Get-CosmosAuthHeader {
    param(
        [Parameter(Mandatory=$true)][string]$Verb,
        [Parameter(Mandatory=$true)][string]$ResourceType,
        [Parameter(Mandatory=$true)][string]$ResourceLink,
        [Parameter(Mandatory=$true)][string]$MasterKey,
        [Parameter(Mandatory=$true)][string]$Date
    )

    $keyBytes = [Convert]::FromBase64String($MasterKey)
    $text = "$($Verb.ToLower())`n$($ResourceType.ToLower())`n$ResourceLink`n$($Date.ToLower())`n`n"
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = $keyBytes
    $hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($text))
    $sig = [Convert]::ToBase64String($hash)
    return [uri]::EscapeDataString("type=master&ver=1.0&sig=$sig")
}

function Get-InvoiceTracking {
    param(
        [Parameter(Mandatory=$true)][string]$InvoiceId,
        [Parameter(Mandatory=$true)][hashtable]$Creds
    )

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/invoice_tracking/docs/inv_track_$InvoiceId"
    $auth = Get-CosmosAuthHeader -Verb "GET" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-partitionkey" = '["invoice_tracking"]'
    }

    try {
        $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 30
        return @{ Found = $true; Document = $response }
    }
    catch {
        $isNotFound = $false
        try {
            if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) {
                $isNotFound = $true
            }
        }
        catch {
            if ($_.Exception.Message -match '\b404\b') {
                $isNotFound = $true
            }
        }

        if ($isNotFound) {
            return @{ Found = $false; Document = $null }
        }

        Write-Log "ERROR" "Cosmos read failed for invoice $InvoiceId`: $($_.Exception.Message)"
        throw
    }
}

function Set-InvoiceTracking {
    param(
        [Parameter(Mandatory=$true)][object]$TrackingDoc,
        [Parameter(Mandatory=$true)][hashtable]$Creds
    )

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/invoice_tracking"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-partitionkey" = '["invoice_tracking"]'
        "x-ms-documentdb-is-upsert" = "True"
        "Content-Type" = "application/json"
    }

    $body = $TrackingDoc | ConvertTo-Json -Depth 15

    try {
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -TimeoutSec 30 | Out-Null
        Write-Log "DEBUG" "Saved tracking for invoice $($TrackingDoc.invoiceId)"
    }
    catch {
        Write-Log "ERROR" "Cosmos write failed for invoice $($TrackingDoc.invoiceId): $($_.Exception.Message)"
        throw
    }
}

function Get-AllInvoiceTracking {
    param([Parameter(Mandatory=$true)][hashtable]$Creds)

    $date = [DateTime]::UtcNow.ToString("R")
    $resourceLink = "dbs/$($Creds.CosmosDb)/colls/invoice_tracking"
    $auth = Get-CosmosAuthHeader -Verb "POST" -ResourceType "docs" -ResourceLink $resourceLink -MasterKey $Creds.CosmosMasterKey -Date $date

    $uri = "https://$($Creds.CosmosAccount).documents.azure.com/$resourceLink/docs"
    $headers = @{
        "Authorization" = $auth
        "x-ms-date" = $date
        "x-ms-version" = "2018-12-31"
        "x-ms-documentdb-query-enablecrosspartition" = "True"
        "x-ms-documentdb-isquery" = "true"
        "Content-Type" = "application/query+json"
    }

    $query = @{
        query = "SELECT * FROM c WHERE c.partitionKey = @pk AND IS_NULL(c.outcome.status)"
        parameters = @(
            @{ name = "@pk"; value = "invoice_tracking" }
        )
    } | ConvertTo-Json -Depth 5

    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $query -TimeoutSec 60
        return $response.Documents
    }
    catch {
        Write-Log "ERROR" "Failed to query tracking documents: $($_.Exception.Message)"
        return @()
    }
}

# ============================================================================
# SECTION 8: EMAIL DRAFT CREATION
# ============================================================================

function New-CollectionDraft {
    param(
        [Parameter(Mandatory=$true)][object]$TrackingDoc,
        [Parameter(Mandatory=$true)][string]$Template,
        [Parameter(Mandatory=$true)][hashtable]$Creds
    )

    $templateData = $script:CollectionTemplates[$Template]
    if (-not $templateData) {
        Write-Log "ERROR" "Template '$Template' not found"
        return @{ Success = $false; Error = "Template not found" }
    }

    $scheduledStage = ($script:CollectionConfig.Schedule | Where-Object { $_.Template -eq $Template } | Select-Object -First 1).Stage
    if (-not $scheduledStage) {
        $scheduledStage = $TrackingDoc.tracking.collectionStage
    }

    # Determine sender based on stage (escalated notices come from management)
    $sender = if ($scheduledStage -ge 4) {
        $script:CollectionConfig.ManagementSender
    } else {
        $script:CollectionConfig.BillingSender
    }

    # Parse customer first name
    $customerName = $TrackingDoc.customer.name
    $firstName = if ($customerName -match "^(\S+)") { $Matches[1] } else { "Customer" }

    # Calculate due status
    $dueDate = [DateTime]::Parse($TrackingDoc.invoice.dueDate)
    $now = Get-Date
    $daysOverdue = [Math]::Max(0, ($now - $dueDate).Days)
    $dueStatus = if ($daysOverdue -gt 0) { "$daysOverdue days overdue" } else { "on $($dueDate.ToString('MMM d, yyyy'))" }

    # Payment link
    $paymentLink = "$($script:CollectionConfig.PaymentLinkBase)$($TrackingDoc.invoiceId)"

    # Review date (7 days from now for final notices)
    $reviewDate = $now.AddDays(7).ToString("MMMM d, yyyy")

    # Job info
    $jobAddress = if ($TrackingDoc.invoice.jobAddress) { $TrackingDoc.invoice.jobAddress } else { "your property" }
    $jobSummary = if ($TrackingDoc.invoice.jobSummary) { $TrackingDoc.invoice.jobSummary } else { "Electrical services" }

    # Replace placeholders in subject
    $subject = $templateData.Subject `
        -replace '{{InvoiceNumber}}', $TrackingDoc.invoice.number `
        -replace '{{InvoiceTotal}}', ("{0:N2}" -f $TrackingDoc.invoice.total) `
        -replace '{{Balance}}', ("{0:N2}" -f $TrackingDoc.invoice.balance)

    # Replace placeholders in body
    $body = $templateData.Body `
        -replace '{{CustomerFirstName}}', $firstName `
        -replace '{{InvoiceNumber}}', $TrackingDoc.invoice.number `
        -replace '{{InvoiceTotal}}', ("{0:N2}" -f $TrackingDoc.invoice.total) `
        -replace '{{Balance}}', ("{0:N2}" -f $TrackingDoc.invoice.balance) `
        -replace '{{DueDate}}', $dueDate.ToString("MMMM d, yyyy") `
        -replace '{{DueStatus}}', $dueStatus `
        -replace '{{DaysOld}}', $TrackingDoc.tracking.daysSinceInvoice `
        -replace '{{DaysOverdue}}', $daysOverdue `
        -replace '{{JobAddress}}', $jobAddress `
        -replace '{{JobSummary}}', $jobSummary `
        -replace '{{PaymentLink}}', $paymentLink `
        -replace '{{ReviewDate}}', $reviewDate

    # Verify we have a valid email address
    if (-not $TrackingDoc.customer.email) {
        Write-Log "WARN" "No email for customer $($TrackingDoc.customer.name)"
        return @{ Success = $false; Error = "No customer email" }
    }

    # Create draft via Graph API
    $headers = @{
        "Authorization" = "Bearer $($Creds.GraphToken)"
        "Content-Type" = "application/json"
    }

    $draftPayload = @{
        subject = $subject
        body = @{
            contentType = "Text"
            content = $body
        }
        toRecipients = @(
            @{
                emailAddress = @{
                    address = $TrackingDoc.customer.email
                    name = $TrackingDoc.customer.name
                }
            }
        )
        importance = if ($scheduledStage -ge 3) { "high" } else { "normal" }
        categories = @("Collection", "Invoice-$($TrackingDoc.invoice.number)")
    } | ConvertTo-Json -Depth 10

    $uri = "https://graph.microsoft.com/v1.0/users/$($sender.Email)/messages"

    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $draftPayload -TimeoutSec 30
        Write-Log "INFO" "Created collection draft for invoice $($TrackingDoc.invoice.number) (Stage $scheduledStage)"

        return @{
            Success = $true
            DraftId = $response.id
            Subject = $subject
            Sender = $sender.Email
            Recipient = $TrackingDoc.customer.email
            Stage = $scheduledStage
            Template = $Template
        }
    }
    catch {
        Write-Log "ERROR" "Failed to create draft for invoice $($TrackingDoc.invoice.number): $($_.Exception.Message)"
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# ============================================================================
# SECTION 9: TEAMS NOTIFICATIONS
# ============================================================================

function Send-CollectionNotification {
    param(
        [Parameter(Mandatory=$true)][object]$TrackingDoc,
        [Parameter(Mandatory=$true)][string]$NotificationType,
        [hashtable]$DraftInfo,
        [string]$WebhookUrl
    )

    if ([string]::IsNullOrWhiteSpace($WebhookUrl)) {
        Write-Log "DEBUG" "Teams webhook not configured; skipping notification"
        return $false
    }

    # Emoji and color based on notification type
    $emoji = switch ($NotificationType) {
        "draft_created" { "📝" }
        "overdue_escalation" { "⚠️" }
        "service_hold" { "🚫" }
        "payment_received" { "💰" }
        "high_value_overdue" { "🔴" }
        "new_overdue" { "📋" }
        default { "📊" }
    }

    $color = switch ($NotificationType) {
        "service_hold" { "FF0000" }
        "high_value_overdue" { "FF0000" }
        "overdue_escalation" { "FFA500" }
        "payment_received" { "27AE60" }
        "draft_created" { "0078D4" }
        default { "6C757D" }
    }

    $title = switch ($NotificationType) {
        "draft_created" { "Collection Draft Created" }
        "overdue_escalation" { "Overdue Invoice Escalation" }
        "service_hold" { "SERVICE HOLD RECOMMENDED" }
        "payment_received" { "Payment Received" }
        "high_value_overdue" { "HIGH VALUE OVERDUE" }
        default { "Invoice Collection Update" }
    }

    # Build facts
    $facts = @(
        @{ "name" = "Invoice"; "value" = $TrackingDoc.invoice.number }
        @{ "name" = "Customer"; "value" = $TrackingDoc.customer.name }
        @{ "name" = "Balance"; "value" = "`$$("{0:N2}" -f $TrackingDoc.invoice.balance)" }
        @{ "name" = "Days Overdue"; "value" = "$($TrackingDoc.tracking.daysOverdue)" }
        @{ "name" = "Stage"; "value" = "$($TrackingDoc.tracking.collectionStage) of 5" }
    )

    if ($TrackingDoc.flags.memberCustomer) {
        $facts += @{ "name" = "Member"; "value" = "Yes ⭐" }
    }

    if ($DraftInfo -and $DraftInfo.Success) {
        $facts += @{ "name" = "Draft Sender"; "value" = $DraftInfo.Sender }
    }

    $card = @{
        "@type" = "MessageCard"
        "@context" = "http://schema.org/extensions"
        "themeColor" = $color
        "summary" = "$emoji $title - $($TrackingDoc.customer.name)"
        "sections" = @(
            @{
                "activityTitle" = "$emoji $title"
                "activitySubtitle" = $TrackingDoc.customer.name
                "facts" = $facts
                "markdown" = $true
            }
        )
        "potentialAction" = @(
            @{
                "@type" = "OpenUri"
                "name" = "View in ServiceTitan"
                "targets" = @(@{ "os" = "default"; "uri" = "https://go.servicetitan.com/Invoice/$($TrackingDoc.invoiceId)" })
            }
        )
    }

    # Add special sections for service holds
    if ($NotificationType -eq "service_hold") {
        $card.sections += @{
            "activityTitle" = "🚫 Immediate Action Required"
            "text" = "This account is **$($TrackingDoc.tracking.daysOverdue) days overdue** with a balance of **`$$("{0:N2}" -f $TrackingDoc.invoice.balance)**. Consider placing a service hold until payment is received."
            "markdown" = $true
        }
    }

    # Add context for high-value
    if ($NotificationType -eq "high_value_overdue") {
        $card.sections += @{
            "activityTitle" = "🔴 High Value Account"
            "text" = "This invoice exceeds the `$2,500 threshold and requires immediate attention."
            "markdown" = $true
        }
    }

    try {
        $payload = $card | ConvertTo-Json -Depth 15
        Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 30 | Out-Null
        Write-Log "DEBUG" "Teams notification sent: $NotificationType for $($TrackingDoc.invoice.number)"
        return $true
    }
    catch {
        Write-Log "WARN" "Teams notification failed: $($_.Exception.Message)"
        return $false
    }
}

# ============================================================================
# SECTION 10: COLLECTION PROCESSOR
# ============================================================================

function Get-DueCollectionStage {
    param(
        [Parameter(Mandatory=$true)][int]$DaysSinceInvoice,
        [Parameter(Mandatory=$true)][int]$CurrentStage,
        [bool]$IsMember = $false
    )

    # Add grace period for members
    $effectiveDays = if ($IsMember) {
        $DaysSinceInvoice - $script:CollectionConfig.MemberGraceDays
    } else {
        $DaysSinceInvoice
    }

    # Find the next stage due (higher than current stage)
    foreach ($stage in $script:CollectionConfig.Schedule) {
        if ($effectiveDays -ge $stage.Day -and $CurrentStage -lt $stage.Stage) {
            return $stage
        }
    }

    return $null
}

function Invoke-InvoiceCollection {
    param(
        [Parameter(Mandatory=$true)][object]$Invoice,
        [Parameter(Mandatory=$true)][hashtable]$Creds
    )

    $invoiceId = $Invoice.id
    $now = Get-Date

    # Skip small balances
    if ($Invoice.balance -lt $script:CollectionConfig.MinimumBalanceThreshold) {
        Write-Log "DEBUG" "Skipping invoice $invoiceId - balance (`$$($Invoice.balance)) below threshold"
        $script:ProcessingStats.Skipped++
        return @{ Action = "skipped"; Reason = "below_threshold" }
    }

    # Get or create tracking document
    $trackingResult = @{ Found = $false; Document = $null }
    if ($Creds.CosmosEnabled) {
        try {
            $trackingResult = Get-InvoiceTracking -InvoiceId $invoiceId -Creds $Creds
        }
        catch {
            Write-Log "ERROR" "Failed to get tracking for invoice $invoiceId`: $($_.Exception.Message)"
            $script:ProcessingStats.Errors++
            return @{ Action = "error"; Reason = "cosmos_read_failed" }
        }
    }

    if ($trackingResult.Found) {
        # Use existing tracking document
        $tracking = $trackingResult.Document

        # Update balance from ServiceTitan (may have changed)
        $tracking.invoice.balance = $Invoice.balance

        # Check if paid (balance is now zero)
        if ($Invoice.balance -eq 0) {
            Write-Log "INFO" "Invoice $invoiceId ($($tracking.invoice.number)) has been paid!"
            $tracking.outcome.status = "paid"
            $tracking.outcome.paidDate = $now.ToString("o")
            $tracking.outcome.paidAmount = $tracking.invoice.total
            $tracking.metadata.updatedAt = $now.ToString("o")

            if ($Creds.CosmosEnabled) {
                Set-InvoiceTracking -TrackingDoc $tracking -Creds $Creds
            }

            # Send celebration notification
            Send-CollectionNotification `
                -TrackingDoc $tracking `
                -NotificationType "payment_received" `
                -WebhookUrl $Creds.TeamsWebhook | Out-Null

            return @{ Action = "paid"; InvoiceNumber = $tracking.invoice.number }
        }
    }
    else {
        # Create new tracking document
        Write-Log "INFO" "Creating new tracking for invoice $invoiceId"

        # Fetch additional info from ServiceTitan
        $customer = Get-InvoiceCustomer -CustomerId $Invoice.customerId -Creds $Creds
        $isMember = Get-CustomerMembership -CustomerId $Invoice.customerId -Creds $Creds
        $job = Get-InvoiceJob -JobId $Invoice.jobId -Creds $Creds

        # Extract customer email
        $customerEmail = $null
        if ($customer -and $customer.contacts) {
            $emailContact = $customer.contacts | Where-Object { $_.type -eq "Email" } | Select-Object -First 1
            if ($emailContact) { $customerEmail = $emailContact.value }
        }

        # Extract phone
        $customerPhone = $null
        if ($customer -and $customer.contacts) {
            $phoneContact = $customer.contacts | Where-Object { $_.type -eq "Phone" -or $_.type -eq "MobilePhone" } | Select-Object -First 1
            if ($phoneContact) { $customerPhone = $phoneContact.value }
        }

        $tracking = @{
            id = "inv_track_$invoiceId"
            invoiceId = $invoiceId
            serviceTitanId = $invoiceId

            customer = @{
                id = $Invoice.customerId
                name = if ($customer) { $customer.name } else { $Invoice.customerName }
                email = $customerEmail
                phone = $customerPhone
                isMember = $isMember
            }

            invoice = @{
                number = $Invoice.number
                total = $Invoice.total
                balance = $Invoice.balance
                createdDate = $Invoice.createdOn
                dueDate = if ($Invoice.dueDate) { $Invoice.dueDate } else { $Invoice.createdOn }
                jobId = $Invoice.jobId
                jobSummary = if ($job -and $job.summary) { $job.summary } else { "Electrical services" }
                jobAddress = if ($job -and $job.location -and $job.location.address) { $job.location.address.street } else { "" }
                status = $Invoice.status
            }

            tracking = @{
                daysSinceInvoice = 0
                daysOverdue = 0
                collectionStage = 0
                lastReminderDate = $null
                nextReminderDate = $null
                totalReminders = 0
                responseReceived = $false
                paymentPromised = $false
                promisedDate = $null
            }

            reminderHistory = @()
            payments = @()

            flags = @{
                highValue = ($Invoice.total -ge $script:CollectionConfig.HighValueThreshold)
                memberCustomer = $isMember
                repeatCustomer = $false
                paymentPlanActive = $false
                serviceHold = $false
                doNotContact = $false
                disputeActive = $false
            }

            notes = @()

            outcome = @{
                status = $null
                paidDate = $null
                paidAmount = $null
                writeOffAmount = $null
                sentToCollections = $false
            }

            partitionKey = "invoice_tracking"
            metadata = @{
                createdAt = $now.ToString("o")
                updatedAt = $now.ToString("o")
            }
        }
    }

    # Check flags that block collection
    if ($tracking.flags.doNotContact) {
        Write-Log "DEBUG" "Skipping invoice $invoiceId - doNotContact flag"
        $script:ProcessingStats.Skipped++
        return @{ Action = "skipped"; Reason = "do_not_contact" }
    }

    if ($tracking.flags.disputeActive) {
        Write-Log "DEBUG" "Skipping invoice $invoiceId - active dispute"
        $script:ProcessingStats.Skipped++
        return @{ Action = "skipped"; Reason = "dispute_active" }
    }

    if ($tracking.flags.paymentPlanActive) {
        Write-Log "DEBUG" "Skipping invoice $invoiceId - payment plan active"
        $script:ProcessingStats.Skipped++
        return @{ Action = "skipped"; Reason = "payment_plan_active" }
    }

    # Skip if no email
    if (-not $tracking.customer.email) {
        Write-Log "WARN" "Skipping invoice $invoiceId ($($tracking.invoice.number)) - no customer email"
        $script:ProcessingStats.Skipped++
        return @{ Action = "skipped"; Reason = "no_email" }
    }

    # Calculate days since invoice and days overdue
    $createdDate = [DateTime]::Parse($tracking.invoice.createdDate)
    $dueDate = [DateTime]::Parse($tracking.invoice.dueDate)
    $daysSinceInvoice = ($now - $createdDate).Days
    $daysOverdue = [Math]::Max(0, ($now - $dueDate).Days)

    $tracking.tracking.daysSinceInvoice = $daysSinceInvoice
    $tracking.tracking.daysOverdue = $daysOverdue

    # Update stats
    $script:ProcessingStats.TotalValue += $tracking.invoice.balance
    if ($daysOverdue -gt 0) {
        $script:ProcessingStats.TotalOverdue++
        $script:ProcessingStats.OverdueValue += $tracking.invoice.balance
    }

    # Check for service hold threshold
    if ($daysOverdue -ge $script:CollectionConfig.ServiceHoldThreshold -and -not $tracking.flags.serviceHold) {
        Write-Log "WARN" "Invoice $invoiceId ($($tracking.invoice.number)) qualifies for SERVICE HOLD - $daysOverdue days overdue, `$$("{0:N2}" -f $tracking.invoice.balance)"

        Send-CollectionNotification `
            -TrackingDoc $tracking `
            -NotificationType "service_hold" `
            -WebhookUrl $Creds.TeamsWebhook | Out-Null

        $tracking.flags.serviceHold = $true
        $script:ProcessingStats.ServiceHolds++
    }

    # Determine if collection reminder is due
    $dueStage = Get-DueCollectionStage -DaysSinceInvoice $daysSinceInvoice -CurrentStage $tracking.tracking.collectionStage -IsMember $tracking.flags.memberCustomer

    $actionTaken = "none"

    if ($dueStage) {
        Write-Log "INFO" "Collection reminder due for invoice $($tracking.invoice.number) - Stage $($dueStage.Stage) ($($dueStage.Template)), Day $daysSinceInvoice"

        $script:ProcessingStats.RemindersDue++

        # Create draft email
        $draftResult = New-CollectionDraft -TrackingDoc $tracking -Template $dueStage.Template -Creds $Creds

        if ($draftResult.Success) {
            # Update tracking
            $tracking.tracking.collectionStage = $dueStage.Stage
            $tracking.tracking.lastReminderDate = $now.ToString("o")
            $tracking.tracking.totalReminders++

            # Calculate next reminder date
            $nextStage = $script:CollectionConfig.Schedule | Where-Object { $_.Stage -eq ($dueStage.Stage + 1) } | Select-Object -First 1
            if ($nextStage) {
                $daysUntilNext = $nextStage.Day - $daysSinceInvoice
                if ($tracking.flags.memberCustomer) { $daysUntilNext += $script:CollectionConfig.MemberGraceDays }
                $tracking.tracking.nextReminderDate = $now.AddDays($daysUntilNext).ToString("o")
            }

            # Add to history
            $tracking.reminderHistory += @{
                date = $now.ToString("o")
                stage = $dueStage.Stage
                method = "email"
                templateUsed = $dueStage.Template
                draftId = $draftResult.DraftId
                status = "draft_pending_review"
                severity = $dueStage.Severity
                sender = $draftResult.Sender
            }

            $script:ProcessingStats.DraftsCreated++
            $actionTaken = "draft_created"

            # Notify Teams for high severity or high value
            if ($dueStage.Severity -in @("HIGH", "CRITICAL") -or $tracking.flags.highValue) {
                $notifyType = if ($tracking.flags.highValue -and $daysOverdue -gt 14) {
                    "high_value_overdue"
                } elseif ($dueStage.Severity -eq "CRITICAL") {
                    "service_hold"
                } else {
                    "overdue_escalation"
                }

                Send-CollectionNotification `
                    -TrackingDoc $tracking `
                    -NotificationType $notifyType `
                    -DraftInfo $draftResult `
                    -WebhookUrl $Creds.TeamsWebhook | Out-Null

                $script:ProcessingStats.Escalated++
            }
        }
        else {
            Write-Log "ERROR" "Failed to create draft for invoice $($tracking.invoice.number): $($draftResult.Error)"
            $script:ProcessingStats.Errors++
            $actionTaken = "draft_failed"
        }
    }

    # Save tracking document
    $tracking.metadata.updatedAt = $now.ToString("o")

    if ($Creds.CosmosEnabled) {
        try {
            Set-InvoiceTracking -TrackingDoc $tracking -Creds $Creds
        }
        catch {
            Write-Log "ERROR" "Failed to save tracking for invoice $invoiceId`: $($_.Exception.Message)"
            $script:ProcessingStats.Errors++
        }
    }

    return @{
        Action = $actionTaken
        InvoiceNumber = $tracking.invoice.number
        Stage = $tracking.tracking.collectionStage
        DaysOverdue = $daysOverdue
        Balance = $tracking.invoice.balance
    }
}

# ============================================================================
# SECTION 11: AGING REPORT
# ============================================================================

function Get-InvoiceAgingReport {
    param([Parameter(Mandatory=$true)][hashtable]$Creds)

    Write-Log "INFO" "Generating invoice aging report..."

    $invoices = Get-UnpaidInvoices -Creds $Creds

    $report = @{
        GeneratedAt = (Get-Date).ToString("o")
        GeneratedBy = "INVOICE_COLLECTION"
        Summary = @{
            TotalUnpaid = $invoices.Count
            TotalValue = 0
            ByAge = @{
                Current = @{ Count = 0; Value = 0; Label = "0-30 days" }
                ThirtyDays = @{ Count = 0; Value = 0; Label = "31-60 days" }
                SixtyDays = @{ Count = 0; Value = 0; Label = "61-90 days" }
                NinetyPlus = @{ Count = 0; Value = 0; Label = "90+ days" }
            }
        }
        HighPriority = @()
        ServiceHoldCandidates = @()
        MemberOverdue = @()
        NoEmailCustomers = @()
        Invoices = @()
    }

    foreach ($inv in $invoices) {
        $createdDate = [DateTime]::Parse($inv.createdOn)
        $age = ((Get-Date) - $createdDate).Days
        $balance = [double]$inv.balance

        $report.Summary.TotalValue += $balance

        # Age buckets
        if ($age -le 30) {
            $report.Summary.ByAge.Current.Count++
            $report.Summary.ByAge.Current.Value += $balance
        }
        elseif ($age -le 60) {
            $report.Summary.ByAge.ThirtyDays.Count++
            $report.Summary.ByAge.ThirtyDays.Value += $balance
        }
        elseif ($age -le 90) {
            $report.Summary.ByAge.SixtyDays.Count++
            $report.Summary.ByAge.SixtyDays.Value += $balance
        }
        else {
            $report.Summary.ByAge.NinetyPlus.Count++
            $report.Summary.ByAge.NinetyPlus.Value += $balance
        }

        $invoiceRecord = @{
            Id = $inv.id
            Number = $inv.number
            Customer = $inv.customerName
            CustomerId = $inv.customerId
            Balance = $balance
            Age = $age
            Status = $inv.status
        }

        # High priority (>$2500 and >14 days)
        if ($balance -ge $script:CollectionConfig.HighValueThreshold -and $age -ge 14) {
            $report.HighPriority += $invoiceRecord
        }

        # Service hold candidates (>45 days)
        if ($age -ge $script:CollectionConfig.ServiceHoldThreshold) {
            $report.ServiceHoldCandidates += $invoiceRecord
        }

        $report.Invoices += $invoiceRecord
    }

    # Sort priority lists
    $report.HighPriority = $report.HighPriority | Sort-Object { $_.Balance } -Descending
    $report.ServiceHoldCandidates = $report.ServiceHoldCandidates | Sort-Object { $_.Age } -Descending
    $report.Invoices = $report.Invoices | Sort-Object { $_.Age } -Descending

    # Summary text
    $report.SummaryText = @"
INVOICE AGING REPORT
====================
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm')

TOTALS
------
Total Unpaid Invoices: $($report.Summary.TotalUnpaid)
Total Outstanding: `$$("{0:N2}" -f $report.Summary.TotalValue)

BY AGE
------
Current (0-30 days):  $($report.Summary.ByAge.Current.Count) invoices, `$$("{0:N2}" -f $report.Summary.ByAge.Current.Value)
31-60 days:           $($report.Summary.ByAge.ThirtyDays.Count) invoices, `$$("{0:N2}" -f $report.Summary.ByAge.ThirtyDays.Value)
61-90 days:           $($report.Summary.ByAge.SixtyDays.Count) invoices, `$$("{0:N2}" -f $report.Summary.ByAge.SixtyDays.Value)
90+ days:             $($report.Summary.ByAge.NinetyPlus.Count) invoices, `$$("{0:N2}" -f $report.Summary.ByAge.NinetyPlus.Value)

ACTION REQUIRED
---------------
High Priority (>`$2500, >14 days): $($report.HighPriority.Count)
Service Hold Candidates (>45 days): $($report.ServiceHoldCandidates.Count)
"@

    Write-Log "INFO" "Aging report complete: $($report.Summary.TotalUnpaid) invoices, `$$("{0:N2}" -f $report.Summary.TotalValue) outstanding"

    return $report
}

# ============================================================================
# SECTION 12: DAILY SUMMARY
# ============================================================================

function Send-DailySummary {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Stats,
        [string]$WebhookUrl
    )

    if ([string]::IsNullOrWhiteSpace($WebhookUrl)) {
        Write-Log "DEBUG" "Teams webhook not configured; skipping daily summary"
        return $false
    }

    $emoji = if ($Stats.DraftsCreated -gt 0 -or $Stats.ServiceHolds -gt 0) { "⚠️" } else { "✅" }

    $card = @{
        "@type" = "MessageCard"
        "@context" = "http://schema.org/extensions"
        "themeColor" = if ($Stats.ServiceHolds -gt 0) { "FF0000" } elseif ($Stats.DraftsCreated -gt 0) { "FFA500" } else { "27AE60" }
        "summary" = "$emoji Invoice Collection Daily Summary"
        "sections" = @(
            @{
                "activityTitle" = "$emoji Invoice Collection Daily Summary"
                "activitySubtitle" = (Get-Date).ToString("dddd, MMMM d, yyyy")
                "facts" = @(
                    @{ "name" = "Total Unpaid"; "value" = "$($Stats.TotalUnpaid) invoices" }
                    @{ "name" = "Total Value"; "value" = "`$$("{0:N2}" -f $Stats.TotalValue)" }
                    @{ "name" = "Overdue"; "value" = "$($Stats.TotalOverdue) invoices (`$$("{0:N2}" -f $Stats.OverdueValue))" }
                    @{ "name" = "Drafts Created"; "value" = "$($Stats.DraftsCreated)" }
                    @{ "name" = "Escalated"; "value" = "$($Stats.Escalated)" }
                    @{ "name" = "Service Holds"; "value" = "$($Stats.ServiceHolds)" }
                    @{ "name" = "Skipped"; "value" = "$($Stats.Skipped)" }
                    @{ "name" = "Errors"; "value" = "$($Stats.Errors)" }
                )
                "markdown" = $true
            }
        )
    }

    if ($Stats.DraftsCreated -gt 0) {
        $card.sections += @{
            "activityTitle" = "📝 Action Required"
            "text" = "**$($Stats.DraftsCreated) collection email drafts** are waiting for review in the accounting mailbox."
            "markdown" = $true
        }
    }

    try {
        $payload = $card | ConvertTo-Json -Depth 15
        Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 30 | Out-Null
        Write-Log "INFO" "Daily summary sent to Teams"
        return $true
    }
    catch {
        Write-Log "WARN" "Failed to send daily summary: $($_.Exception.Message)"
        return $false
    }
}

# ============================================================================
# SECTION 13: MAIN EXECUTION
# ============================================================================

Write-Log "INFO" "═══════════════════════════════════════════════════════════════"
Write-Log "INFO" "Phoenix AI Invoice Collection Automation starting..."
Write-Log "INFO" "Mode: $Mode"
Write-Log "INFO" "═══════════════════════════════════════════════════════════════"

$result = $null

try {
    # Load credentials from Azure Automation / Key Vault
    Write-Log "INFO" "Loading credentials..."

    $kvToken = Get-ManagedIdentityToken -Resource "https://vault.azure.net"
    $vaultName = (Get-AutomationVariable -Name 'VaultName').Trim()

    $teamsWebhook = $null
    try {
        $teamsWebhook = (Get-AutomationVariable -Name 'TeamsWebhook_AIUpdates').Trim()
    }
    catch {
        Write-Log "WARN" "Teams webhook not configured"
    }

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
        TeamsWebhook = $teamsWebhook
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
        "process" {
            Write-Log "INFO" "Starting invoice collection processing..."

            # Get all unpaid invoices from ServiceTitan
            $invoices = Get-UnpaidInvoices -Creds $creds
            $script:ProcessingStats.TotalUnpaid = $invoices.Count

            Write-Log "INFO" "Processing $($invoices.Count) unpaid invoices..."

            $processed = 0
            foreach ($invoice in $invoices) {
                $processed++
                if ($processed % 25 -eq 0) {
                    Write-Log "INFO" "Progress: $processed / $($invoices.Count) invoices processed..."
                }

                try {
                    Invoke-InvoiceCollection -Invoice $invoice -Creds $creds | Out-Null
                }
                catch {
                    Write-Log "ERROR" "Failed to process invoice $($invoice.id): $($_.Exception.Message)"
                    $script:ProcessingStats.Errors++
                }

                # Small delay to avoid rate limiting
                Start-Sleep -Milliseconds 50
            }

            # Send daily summary
            Send-DailySummary -Stats $script:ProcessingStats -WebhookUrl $creds.TeamsWebhook | Out-Null
        }

        "report" {
            Write-Log "INFO" "Generating aging report..."
            $report = Get-InvoiceAgingReport -Creds $creds

            # Output both summary and JSON
            Write-Output $report.SummaryText
            Write-Output ""
            Write-Output "---JSON_REPORT_START---"
            Write-Output ($report | ConvertTo-Json -Depth 10)
            Write-Output "---JSON_REPORT_END---"
        }

        "single" {
            if (-not $SingleInvoiceId) {
                throw "SingleInvoiceId parameter is required for single mode"
            }

            Write-Log "INFO" "Processing single invoice: $SingleInvoiceId"

            $invoice = Get-SingleInvoice -InvoiceId $SingleInvoiceId -Creds $creds
            if (-not $invoice) {
                throw "Invoice $SingleInvoiceId not found"
            }

            $script:ProcessingStats.TotalUnpaid = 1
            $result = Invoke-InvoiceCollection -Invoice $invoice -Creds $creds

            Write-Log "INFO" "Single invoice result: $($result.Action)"
        }

        "sync" {
            Write-Log "INFO" "QuickBooks sync mode"
            Write-Log "WARN" "QuickBooks sync not yet implemented - planned for future release"
            # Future: Sync invoice status with QuickBooks
            # Future: Import QB payments to update ST invoices
        }
    }

    # Final summary
    Write-Log "INFO" "═══════════════════════════════════════════════════════════════"
    Write-Log "INFO" "PROCESSING COMPLETE"
    Write-Log "INFO" "═══════════════════════════════════════════════════════════════"
    Write-Log "INFO" "Total Unpaid Invoices: $($script:ProcessingStats.TotalUnpaid)"
    Write-Log "INFO" "Total Unpaid Value: `$$("{0:N2}" -f $script:ProcessingStats.TotalValue)"
    Write-Log "INFO" "Overdue Invoices: $($script:ProcessingStats.TotalOverdue)"
    Write-Log "INFO" "Overdue Value: `$$("{0:N2}" -f $script:ProcessingStats.OverdueValue)"
    Write-Log "INFO" "Reminders Due: $($script:ProcessingStats.RemindersDue)"
    Write-Log "INFO" "Drafts Created: $($script:ProcessingStats.DraftsCreated)"
    Write-Log "INFO" "Escalated: $($script:ProcessingStats.Escalated)"
    Write-Log "INFO" "Service Holds: $($script:ProcessingStats.ServiceHolds)"
    Write-Log "INFO" "Skipped: $($script:ProcessingStats.Skipped)"
    Write-Log "INFO" "Errors: $($script:ProcessingStats.Errors)"

    $result = @{
        Status = "Success"
        Mode = $Mode
        Stats = $script:ProcessingStats
        CompletedAt = (Get-Date).ToString("o")
    }
}
catch {
    Write-Log "CRITICAL" "Invoice collection failed: $($_.Exception.Message)"
    Write-Log "ERROR" "Stack trace: $($_.ScriptStackTrace)"

    $result = @{
        Status = "Failed"
        Mode = $Mode
        Error = $_.Exception.Message
        StackTrace = $_.ScriptStackTrace
        Stats = $script:ProcessingStats
        FailedAt = (Get-Date).ToString("o")
    }
}

# Output structured JSON result
$jsonOutput = $result | ConvertTo-Json -Depth 10 -Compress
Write-Output "---JSON_OUTPUT_START---"
Write-Output $jsonOutput
Write-Output "---JSON_OUTPUT_END---"
