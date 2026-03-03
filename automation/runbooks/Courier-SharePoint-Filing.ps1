<#
.SYNOPSIS
    Phoenix Mail Courier - SharePoint Filing Runbook
.DESCRIPTION
    Takes ProcessEmails output JSON and files records to SharePoint using routing
    rules defined in this runbook.
.NOTES
    Runtime: PS72-Courier (PowerShell 7.2)
    Author: Phoenix AI Core
    Version: 1.1.0

    SAFETY RULES:
    - Read-only from mailboxes (emails already processed upstream)
    - Write to SharePoint only
    - 3-failure rule on SharePoint operations
    - All operations logged
#>

#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.Sites, Microsoft.Graph.Files

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EmailDataJson,

    [Parameter(Mandatory = $false)]
    [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# =============================================================================
# CONFIGURATION
# =============================================================================

function Get-AutomationVariableSafe {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $false)][string]$Default = ''
    )

    try {
        $value = Get-AutomationVariable -Name $Name
        if ($null -eq $value) {
            return $Default
        }
        return [string]$value
    }
    catch {
        return $Default
    }
}

$TenantId = Get-AutomationVariableSafe -Name 'TenantId'
$SiteId = Get-AutomationVariableSafe -Name 'SharePointSiteId'
$DriveId = Get-AutomationVariableSafe -Name 'SharePointDriveId'
$CustomerLookupSharePointPath = Get-AutomationVariableSafe -Name 'CustomerLookupSharePointPath' -Default 'INTERNAL/_AI_MEMORY/customer_lookup_index.json'
$EmailArchiveRootPath = Get-AutomationVariableSafe -Name 'EmailArchiveRootPath' -Default 'EMAIL_ARCHIVE'

$EmailArchiveRootPath = $EmailArchiveRootPath.Trim().TrimEnd('/')
if ($EmailArchiveRootPath -match '^(~|/|[A-Za-z]:)' -or
    $EmailArchiveRootPath -imatch 'Phoenix Ops Sharepoint Local' -or
    $EmailArchiveRootPath -imatch 'Phoenix_Local') {
    Write-Output "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] WARN: EmailArchiveRootPath appears local; defaulting to EMAIL_ARCHIVE"
    $EmailArchiveRootPath = 'EMAIL_ARCHIVE'
}

if ([string]::IsNullOrWhiteSpace($DriveId)) {
    throw 'Missing required automation variable: SharePointDriveId'
}

# Routing rules
$RoutingRules = @{
    VendorDomains = @{
        'rexel.com' = 'VENDORS/Primary/Rexel'
        'homedepot.com' = 'VENDORS/Primary/HomeDepot'
        'graybar.com' = 'VENDORS/Secondary/Graybar'
        'wesco.com' = 'VENDORS/Secondary/Wesco'
        'bordenstates.com' = 'VENDORS/Secondary/BordenStates'
        'platt.com' = 'VENDORS/Secondary/Platt'
        'generac.com' = 'VENDORS/Specialty/Generac'
        'lutron.com' = 'VENDORS/Specialty/Lutron'
        'spruce.com' = 'VENDORS/Specialty/Spruce'
    }
    CategoryRoutes = @{
        'INTERNAL' = "$EmailArchiveRootPath/By_Category/INTERNAL"
        'RECEIPT_INVOICE' = 'ACCOUNTING/Receipts'
        'CUSTOMER_SCHEDULING' = "$EmailArchiveRootPath/By_Category/CUSTOMER_SCHEDULING"
        'VENDOR' = 'VENDORS'
        'GENERAL' = "$EmailArchiveRootPath/Flagged_For_Review"
    }
}

# =============================================================================
# FUNCTIONS
# =============================================================================

function Write-Log {
    param([string]$Level, [string]$Message)
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Output "[$timestamp] ${Level}: $Message"
}

$script:CustomerLookupByEmail = @{}
$script:CustomerLookupByPhone = @{}
$script:PathExistsCache = @{}

function Convert-ToGraphPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $segments = $Path -split '/' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    return ($segments | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
}

function Get-DateSafe {
    param([object]$Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return Get-Date
    }

    try {
        return [datetime]$Value
    }
    catch {
        return Get-Date
    }
}

function Normalize-PhoneKey {
    param([string]$Phone)

    if ([string]::IsNullOrWhiteSpace($Phone)) {
        return ''
    }

    $digits = $Phone -replace '\D', ''
    if ($digits.Length -eq 11 -and $digits.StartsWith('1')) {
        $digits = $digits.Substring(1)
    }

    return $digits
}

function Get-SafeFileName {
    param([string]$FileName, [int]$MaxLength = 100)

    $base = if ([string]::IsNullOrWhiteSpace($FileName)) { 'empty' } else { $FileName }

    $safe = $base -replace '[<>:"/\\|?*]', ''
    $safe = $safe -replace '\s+', '_'
    $safe = $safe.Trim('_')

    if ([string]::IsNullOrWhiteSpace($safe)) {
        $safe = 'empty'
    }

    if ($safe.Length -gt $MaxLength) {
        $safe = $safe.Substring(0, $MaxLength)
    }

    return $safe
}

function Get-VendorFromEmail {
    param([string]$EmailAddress)

    if ([string]::IsNullOrWhiteSpace($EmailAddress) -or $EmailAddress -notmatch '@') {
        return $null
    }

    $domain = ($EmailAddress -split '@')[-1].ToLowerInvariant()

    foreach ($vendorDomain in $RoutingRules.VendorDomains.Keys) {
        if ($domain -like "*$vendorDomain") {
            return $RoutingRules.VendorDomains[$vendorDomain]
        }
    }

    return $null
}

function Load-CustomerLookupIndex {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SharePointPath
    )

    try {
        $encodedPath = Convert-ToGraphPath -Path $SharePointPath
        $uri = "https://graph.microsoft.com/v1.0/drives/$DriveId/root:/$encodedPath:/content"
        $raw = Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType HttpResponseMessage

        $jsonString = $raw.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $lookup = $jsonString | ConvertFrom-Json

        if ($lookup.by_email) {
            foreach ($prop in $lookup.by_email.PSObject.Properties) {
                $script:CustomerLookupByEmail[$prop.Name.ToLowerInvariant()] = $prop.Value
            }
        }

        if ($lookup.by_phone) {
            foreach ($prop in $lookup.by_phone.PSObject.Properties) {
                $phoneKey = Normalize-PhoneKey -Phone $prop.Name
                if ($phoneKey) {
                    $script:CustomerLookupByPhone[$phoneKey] = $prop.Value
                }
            }
        }

        Write-Log 'INFO' "Loaded customer lookup index from $SharePointPath"
    }
    catch {
        Write-Log 'WARN' "Customer lookup index not loaded: $($_.Exception.Message)"
    }
}

function Get-CustomerFolder {
    param([string]$Email, [string]$Phone)

    if ($Email) {
        $emailKey = $Email.ToLowerInvariant()
        if ($script:CustomerLookupByEmail.ContainsKey($emailKey)) {
            return $script:CustomerLookupByEmail[$emailKey]
        }
    }

    $phoneKey = Normalize-PhoneKey -Phone $Phone
    if ($phoneKey -and $script:CustomerLookupByPhone.ContainsKey($phoneKey)) {
        return $script:CustomerLookupByPhone[$phoneKey]
    }

    return $null
}

function Test-SharePointPathExists {
    param([string]$Path)

    if ($script:PathExistsCache.ContainsKey($Path)) {
        return $script:PathExistsCache[$Path]
    }

    try {
        Get-MgDriveItemByPath -DriveId $DriveId -Path $Path -ErrorAction Stop | Out-Null
        $script:PathExistsCache[$Path] = $true
        return $true
    }
    catch {
        $script:PathExistsCache[$Path] = $false
        return $false
    }
}

function Ensure-SharePointFolderPath {
    param([Parameter(Mandatory = $true)][string]$FolderPath)

    $parts = $FolderPath -split '/' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $currentPath = ''

    foreach ($part in $parts) {
        $currentPath = if ($currentPath) { "$currentPath/$part" } else { $part }

        if (Test-SharePointPathExists -Path $currentPath) {
            continue
        }

        if ($WhatIf) {
            Write-Log 'WHATIF' "Would create folder: $currentPath"
            $script:PathExistsCache[$currentPath] = $true
            continue
        }

        $encodedParent = Convert-ToGraphPath -Path ($currentPath -replace "/$([regex]::Escape($part))$", '')
        $uri = if ($encodedParent) {
            "https://graph.microsoft.com/v1.0/drives/$DriveId/root:/$encodedParent:/children"
        }
        else {
            "https://graph.microsoft.com/v1.0/drives/$DriveId/root/children"
        }

        $body = @{
            name = $part
            folder = @{}
            '@microsoft.graph.conflictBehavior' = 'rename'
        } | ConvertTo-Json -Depth 4

        Invoke-MgGraphRequest -Method POST -Uri $uri -Body $body -ContentType 'application/json' | Out-Null
        $script:PathExistsCache[$currentPath] = $true
    }
}

function New-SharePointFile {
    param(
        [string]$FolderPath,
        [string]$FileName,
        [string]$Content
    )

    $fullPath = "$FolderPath/$FileName"

    if ($WhatIf) {
        Write-Log 'WHATIF' "Would create file: $fullPath"
        return $true
    }

    try {
        Ensure-SharePointFolderPath -FolderPath $FolderPath

        $encodedPath = Convert-ToGraphPath -Path $fullPath
        $uri = "https://graph.microsoft.com/v1.0/drives/$DriveId/root:/$encodedPath:/content"

        Invoke-MgGraphRequest -Method PUT -Uri $uri -Body $Content -ContentType 'application/json; charset=utf-8' | Out-Null

        Write-Log 'SUCCESS' "Filed: $fullPath"
        return $true
    }
    catch {
        Write-Log 'ERROR' "Failed to file $fullPath : $($_.Exception.Message)"
        return $false
    }
}

function Get-RouteForEmail {
    param([object]$Email)

    $category = if ($Email.Category) { [string]$Email.Category } else { 'GENERAL' }
    $fromAddress = if ($Email.From) { [string]$Email.From } else { '' }
    $phone = if ($Email.Phone) { [string]$Email.Phone } else { '' }
    $status = if ($Email.Status) { [string]$Email.Status } elseif ($Email.DraftStatus) { [string]$Email.DraftStatus } else { '' }

    $received = Get-DateSafe -Value $Email.ReceivedDateTime
    $dateFolder = $received.ToString('yyyy-MM')

    if ($status -eq 'draft_pending_review' -or $status -eq 'draft_created') {
        return "$EmailArchiveRootPath/Flagged_For_Review"
    }

    $vendorPath = Get-VendorFromEmail -EmailAddress $fromAddress
    if ($vendorPath -and $category -eq 'VENDOR') {
        return "$vendorPath/Emails/$dateFolder"
    }

    if ($category -ne 'INTERNAL') {
        $customerEntry = Get-CustomerFolder -Email $fromAddress -Phone $phone
        if ($customerEntry) {
            $basePath = switch ($customerEntry.type) {
                'builder' { "CONSTRUCTION/Active_Builders/$($customerEntry.folder)" }
                'commercial' { "SERVICE/Commercial/$($customerEntry.folder)" }
                'residential' { "SERVICE/Residential/$($customerEntry.folder)" }
                default { $null }
            }

            if ($basePath -and (Test-SharePointPathExists -Path $basePath)) {
                return "$basePath/Emails/$dateFolder"
            }
        }
    }

    $basePath = $RoutingRules.CategoryRoutes[$category]
    if (-not $basePath) {
        $basePath = "$EmailArchiveRootPath/Flagged_For_Review"
    }

    if ($category -eq 'RECEIPT_INVOICE') {
        return "$basePath/$dateFolder"
    }

    return $basePath
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

Write-Log 'INFO' 'Starting SharePoint filing process'
if ($WhatIf) {
    Write-Log 'INFO' '*** WHATIF MODE ***'
}

# Parse input JSON
try {
    $emailDataObject = $EmailDataJson | ConvertFrom-Json

    if ($emailDataObject -is [System.Array]) {
        $emails = @($emailDataObject)
    }
    elseif ($emailDataObject.Emails) {
        $emails = @($emailDataObject.Emails)
    }
    else {
        $emails = @($emailDataObject)
    }

    Write-Log 'INFO' "Loaded $($emails.Count) emails to process"
}
catch {
    Write-Log 'ERROR' "Failed to parse email data JSON: $($_.Exception.Message)"
    exit 1
}

# Connect to Graph
Write-Log 'INFO' 'Connecting to Microsoft Graph...'
try {
    Connect-MgGraph -Identity -NoWelcome
    Write-Log 'SUCCESS' 'Connected to Graph'
}
catch {
    Write-Log 'ERROR' "Failed to connect: $($_.Exception.Message)"
    exit 1
}

Load-CustomerLookupIndex -SharePointPath $CustomerLookupSharePointPath

$results = @{
    Filed = 0
    Failed = 0
    Skipped = 0
    HaltedByFailureRule = $false
    ByCategory = @{}
    ByRoute = @{}
}

$consecutiveFailures = 0
$maxConsecutiveFailures = 3

foreach ($email in $emails) {
    if ($consecutiveFailures -ge $maxConsecutiveFailures) {
        Write-Log 'ERROR' '3 consecutive failures - stopping'
        $results.HaltedByFailureRule = $true
        break
    }

    $route = Get-RouteForEmail -Email $email
    if ([string]::IsNullOrWhiteSpace($route)) {
        $results.Skipped++
        Write-Log 'WARN' 'Skipping email due to empty route'
        continue
    }

    $received = Get-DateSafe -Value $email.ReceivedDateTime
    $dateStr = $received.ToString('yyyy-MM-dd')

    $fromAddress = if ($email.From) { [string]$email.From } else { 'unknown@unknown' }
    $fromUser = if ($fromAddress -match '@') { ($fromAddress -split '@')[0] } else { $fromAddress }

    $idSlug = if ($email.Id) { Get-SafeFileName -FileName ([string]$email.Id) -MaxLength 24 } else { 'noid' }
    $fromSlug = Get-SafeFileName -FileName $fromUser -MaxLength 20
    $subjectSlug = Get-SafeFileName -FileName ([string]$email.Subject) -MaxLength 50
    $fileName = "${dateStr}_${idSlug}_${fromSlug}_${subjectSlug}.json"

    $emailRecord = @{
        id = $email.Id
        mailbox = $email.Mailbox
        from = $email.From
        fromName = $email.FromName
        subject = $email.Subject
        receivedDateTime = $email.ReceivedDateTime
        category = $email.Category
        importance = $email.Importance
        hasAttachments = $email.HasAttachments
        isRead = $email.IsRead
        bodyPreview = $email.BodyPreview
        status = $email.Status
        draftStatus = $email.DraftStatus
        draftId = if ($email.Draft) { $email.Draft.DraftId } else { $null }
        draftFolderId = if ($email.Draft) { $email.Draft.FolderId } else { $null }
        draftExternalRecipient = if ($email.Draft) { $email.Draft.ExternalRecipient } else { $null }
        filedAt = (Get-Date).ToString('o')
        filedTo = $route
    } | ConvertTo-Json -Depth 8

    $success = New-SharePointFile -FolderPath $route -FileName $fileName -Content $emailRecord

    if ($success) {
        $results.Filed++
        $consecutiveFailures = 0

        $cat = if ($email.Category) { [string]$email.Category } else { 'GENERAL' }
        if (-not $results.ByCategory[$cat]) {
            $results.ByCategory[$cat] = 0
        }
        $results.ByCategory[$cat]++

        if (-not $results.ByRoute[$route]) {
            $results.ByRoute[$route] = 0
        }
        $results.ByRoute[$route]++
    }
    else {
        $results.Failed++
        $consecutiveFailures++
    }
}

Write-Log 'INFO' '========================================='
Write-Log 'INFO' 'Filing complete'
Write-Log 'INFO' "  Filed: $($results.Filed)"
Write-Log 'INFO' "  Failed: $($results.Failed)"
Write-Log 'INFO' "  Skipped: $($results.Skipped)"
Write-Log 'INFO' ''
Write-Log 'INFO' 'By Category:'
foreach ($cat in ($results.ByCategory.Keys | Sort-Object)) {
    Write-Log 'INFO' "  $cat : $($results.ByCategory[$cat])"
}
Write-Log 'INFO' ''
Write-Log 'INFO' 'By Route:'
foreach ($route in ($results.ByRoute.Keys | Sort-Object)) {
    Write-Log 'INFO' "  $route : $($results.ByRoute[$route])"
}
Write-Log 'INFO' '========================================='

$jsonOutput = $results | ConvertTo-Json -Depth 8 -Compress
Write-Output '---JSON_OUTPUT_START---'
Write-Output $jsonOutput
Write-Output '---JSON_OUTPUT_END---'
