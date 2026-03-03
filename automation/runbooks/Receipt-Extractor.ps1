<#
.SYNOPSIS
    Phoenix Receipt Extractor - Extract Material Pricing from Email Receipts
.DESCRIPTION
    Processes receipt email JSON to extract:
    1. Vendor information
    2. Material keywords
    3. Pricing amounts
    4. PO / Invoice references
    Outputs files for pricebook updates and accounting reconciliation.
.NOTES
    Runtime: PowerShell 7.2
    Author: Phoenix Electric AI Team
    Version: 1.1.0
#>

[CmdletBinding()]
param(
    [string]$ReceiptsFile,
    [string]$OutputPath = '/Users/shanewarehime/GitHub/PHOENIX_AI/Data/Receipts'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ============================================================================
# VENDOR PATTERNS
# ============================================================================

$script:VendorPatterns = @{
    'Rexel' = @{
        Domain = 'rexel'
        SkuPattern = '([A-Z0-9]{6,12})'
        PricePattern = '\$[\d,]+(?:\.\d{1,2})?'
        InvoicePattern = 'Invoice[#:\s-]*(\d+)'
        POPattern = 'PO[#:\s-]*(\d+)'
    }
    'Graybar' = @{
        Domain = 'graybar'
        SkuPattern = '([A-Z0-9]{5,15})'
        PricePattern = '\$[\d,]+(?:\.\d{1,2})?'
        InvoicePattern = 'Invoice[#:\s-]*(\d+)'
        POPattern = 'Order[#:\s-]*(\d+)'
    }
    'HomeDepot' = @{
        Domain = 'homedepot'
        SkuPattern = '(\d{9})'
        PricePattern = '\$[\d,]+(?:\.\d{1,2})?'
        InvoicePattern = 'Order[#:\s-]*(\d+)'
        POPattern = ''
    }
    'Lowes' = @{
        Domain = 'lowes'
        SkuPattern = '(\d{6,9})'
        PricePattern = '\$[\d,]+(?:\.\d{1,2})?'
        InvoicePattern = 'Order[#:\s-]*(\d+)'
        POPattern = ''
    }
    'WESCO' = @{
        Domain = 'wesco'
        SkuPattern = '([A-Z0-9]{8,12})'
        PricePattern = '\$[\d,]+(?:\.\d{1,2})?'
        InvoicePattern = 'Invoice[#:\s-]*(\d+)'
        POPattern = 'PO[#:\s-]*(\d+)'
    }
    'Platt' = @{
        Domain = 'platt'
        SkuPattern = '([A-Z0-9]{6,12})'
        PricePattern = '\$[\d,]+(?:\.\d{1,2})?'
        InvoicePattern = 'Invoice[#:\s-]*(\d+)'
        POPattern = 'PO[#:\s-]*(\d+)'
    }
    'Grainger' = @{
        Domain = 'grainger'
        SkuPattern = '(\d{6,10}[A-Z]?)'
        PricePattern = '\$[\d,]+(?:\.\d{1,2})?'
        InvoicePattern = 'Order[#:\s-]*(\d+)'
        POPattern = ''
    }
}

$script:MaterialKeywords = @(
    'wire', 'cable', 'conduit', 'box', 'panel', 'breaker', 'switch',
    'outlet', 'receptacle', 'plug', 'connector', 'fitting', 'coupling',
    'clamp', 'strap', 'tape', 'lug', 'terminal', 'meter', 'disconnect',
    'transformer', 'contactor', 'relay', 'sensor', 'thermostat',
    'led', 'light', 'fixture', 'lamp', 'ballast', 'driver',
    'gfci', 'afci', 'surge', 'grounding', 'rod', 'bond'
)

# ============================================================================
# FUNCTIONS
# ============================================================================

function Write-Log {
    param(
        [Parameter(Mandatory = $true)][string]$Level,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "[$timestamp] $Level: $Message"
}

function Ensure-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -Path $Path -ItemType Directory -Force | Out-Null
    }
}

function Get-ReceiptValue {
    param(
        [Parameter(Mandatory = $true)][object]$Receipt,
        [Parameter(Mandatory = $true)][string[]]$Names,
        [object]$Default = $null
    )

    foreach ($name in $Names) {
        if ($Receipt.PSObject.Properties.Name -contains $name) {
            $value = $Receipt.$name
            if ($null -eq $value) { continue }

            if ($value -is [string]) {
                if ([string]::IsNullOrWhiteSpace($value)) { continue }
                return $value.Trim()
            }

            return $value
        }
    }

    return $Default
}

function Get-ReceiptCollection {
    param([Parameter(Mandatory = $true)][object]$InputData)

    if ($InputData -is [System.Array]) {
        return @($InputData)
    }

    foreach ($property in @('Receipts', 'receipts', 'Emails', 'emails', 'Items', 'items', 'data')) {
        if ($InputData.PSObject.Properties.Name -contains $property) {
            $candidate = $InputData.$property
            if ($candidate -is [System.Array]) {
                return @($candidate)
            }
        }
    }

    return @($InputData)
}

function Get-DateSafe {
    param([object]$Value)

    if ($null -eq $Value) {
        return Get-Date
    }

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return Get-Date
    }

    try {
        return [datetime]$Value
    }
    catch {
        return Get-Date
    }
}

function Get-RegexCapture {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Pattern
    )

    if ([string]::IsNullOrWhiteSpace($Pattern)) {
        return $null
    }

    $match = [regex]::Match(
        $Text,
        $Pattern,
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )

    if ($match.Success -and $match.Groups.Count -gt 1) {
        return $match.Groups[1].Value.Trim()
    }

    return $null
}

function Identify-Vendor {
    param(
        [string]$FromEmail,
        [string]$Subject,
        [string]$BodyPreview
    )

    $combined = "$FromEmail $Subject $BodyPreview".ToLowerInvariant()

    foreach ($vendor in $script:VendorPatterns.Keys) {
        $domainPattern = [regex]::Escape($script:VendorPatterns[$vendor].Domain)
        if ($combined -match $domainPattern) {
            return $vendor
        }
    }

    return 'Unknown'
}

function Extract-Amounts {
    param([string]$Text)

    $amounts = @()
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $amounts
    }

    $matches = [regex]::Matches($Text, '\$[\d,]+(?:\.\d{1,2})?')
    foreach ($match in $matches) {
        $value = $match.Value -replace '[\$,]', ''
        $parsed = 0m
        $success = [decimal]::TryParse(
            $value,
            [System.Globalization.NumberStyles]::Number,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [ref]$parsed
        )

        if ($success) {
            $amounts += $parsed
        }
    }

    return $amounts
}

function Extract-PONumber {
    param(
        [string]$Text,
        [string]$Vendor
    )

    $pattern = ''
    if ($script:VendorPatterns.ContainsKey($Vendor)) {
        $pattern = [string]$script:VendorPatterns[$Vendor].POPattern
    }

    $vendorMatch = Get-RegexCapture -Text $Text -Pattern $pattern
    if ($vendorMatch) {
        return $vendorMatch
    }

    return Get-RegexCapture -Text $Text -Pattern 'PO[#:\s-]*(\d{4,15})'
}

function Extract-InvoiceNumber {
    param(
        [string]$Text,
        [string]$Vendor
    )

    $pattern = ''
    if ($script:VendorPatterns.ContainsKey($Vendor)) {
        $pattern = [string]$script:VendorPatterns[$Vendor].InvoicePattern
    }

    $vendorMatch = Get-RegexCapture -Text $Text -Pattern $pattern
    if ($vendorMatch) {
        return $vendorMatch
    }

    $invoiceMatch = Get-RegexCapture -Text $Text -Pattern 'Invoice[#:\s-]*(\d{4,15})'
    if ($invoiceMatch) {
        return $invoiceMatch
    }

    return Get-RegexCapture -Text $Text -Pattern 'Order[#:\s-]*(\d{4,15})'
}

function Extract-MaterialKeywords {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return @()
    }

    $found = @()
    $lowerText = $Text.ToLowerInvariant()

    foreach ($keyword in $script:MaterialKeywords) {
        if ($lowerText -match "\b$([regex]::Escape($keyword))\b") {
            $found += $keyword
        }
    }

    return @($found | Select-Object -Unique)
}

function Process-Receipt {
    param([Parameter(Mandatory = $true)][object]$Receipt)

    $emailId = [string](Get-ReceiptValue -Receipt $Receipt -Names @('EmailId', 'ID', 'Id', 'MessageId', 'id') -Default '')
    $from = [string](Get-ReceiptValue -Receipt $Receipt -Names @('From', 'from', 'Sender', 'sender', 'FromEmail', 'fromEmail') -Default '')
    $subject = [string](Get-ReceiptValue -Receipt $Receipt -Names @('Subject', 'subject') -Default '')
    $bodyPreview = [string](Get-ReceiptValue -Receipt $Receipt -Names @('BodyPreview', 'bodyPreview', 'Preview', 'preview', 'Body', 'body') -Default '')
    $dateValue = Get-ReceiptValue -Receipt $Receipt -Names @('Date', 'date', 'ReceivedDateTime', 'receivedDateTime', 'CreatedOn', 'createdOn')
    $hasAttachments = [bool](Get-ReceiptValue -Receipt $Receipt -Names @('HasAttachments', 'hasAttachments') -Default $false)

    $vendor = Identify-Vendor -FromEmail $from -Subject $subject -BodyPreview $bodyPreview
    $fullText = "$subject $bodyPreview"
    $amounts = Extract-Amounts -Text $fullText

    $processed = [ordered]@{
        EmailId = $emailId
        Vendor = $vendor
        Date = (Get-DateSafe -Value $dateValue).ToString('o')
        Subject = $subject
        From = $from
        PONumber = Extract-PONumber -Text $fullText -Vendor $vendor
        InvoiceNumber = Extract-InvoiceNumber -Text $fullText -Vendor $vendor
        Amounts = $amounts
        TotalAmount = $null
        MaterialKeywords = Extract-MaterialKeywords -Text $fullText
        HasAttachments = $hasAttachments
        NeedsManualReview = $false
        RawPreview = $bodyPreview
    }

    if ($amounts.Count -gt 0) {
        $processed.TotalAmount = ($amounts | Measure-Object -Maximum).Maximum
    }

    if (-not $processed.PONumber -and -not $processed.InvoiceNumber) {
        $processed.NeedsManualReview = $true
    }

    if ($processed.Vendor -eq 'Unknown' -or -not $processed.TotalAmount) {
        $processed.NeedsManualReview = $true
    }

    return [pscustomobject]$processed
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Log -Level 'INFO' -Message '========================================='
Write-Log -Level 'INFO' -Message 'Phoenix Receipt Extractor v1.1.0'
Write-Log -Level 'INFO' -Message '========================================='

try {
    Ensure-Directory -Path $OutputPath

    if (-not $ReceiptsFile) {
        $defaultPattern = Join-Path $OutputPath 'receipts_*.json'
        $latestFile = Get-ChildItem -Path $defaultPattern -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if ($latestFile) {
            $ReceiptsFile = $latestFile.FullName
            Write-Log -Level 'INFO' -Message "Using latest receipts file: $ReceiptsFile"
        }
        else {
            throw "No receipts file found at pattern: $defaultPattern"
        }
    }

    if (-not (Test-Path -LiteralPath $ReceiptsFile)) {
        throw "Receipts file not found: $ReceiptsFile"
    }

    Write-Log -Level 'INFO' -Message "Loading receipts from: $ReceiptsFile"
    $raw = Get-Content -LiteralPath $ReceiptsFile -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        throw "Receipts file is empty: $ReceiptsFile"
    }

    $parsed = $raw | ConvertFrom-Json -Depth 100
    $receipts = Get-ReceiptCollection -InputData $parsed
    Write-Log -Level 'INFO' -Message "Loaded $($receipts.Count) receipts"

    if ($receipts.Count -eq 0) {
        Write-Log -Level 'WARN' -Message 'No receipt records found. Exiting.'
        exit 0
    }

    $processedReceipts = @()
    $byVendor = @{}
    $totalExtractedAmount = 0m
    $processingErrors = 0

    foreach ($receipt in $receipts) {
        try {
            $processed = Process-Receipt -Receipt $receipt
            $processedReceipts += $processed

            if (-not $byVendor.ContainsKey($processed.Vendor)) {
                $byVendor[$processed.Vendor] = @{
                    Count = 0
                    TotalAmount = 0m
                    Receipts = @()
                }
            }

            $byVendor[$processed.Vendor].Count++
            if ($processed.TotalAmount -and ([decimal]$processed.TotalAmount -gt 0)) {
                $amount = [decimal]$processed.TotalAmount
                $byVendor[$processed.Vendor].TotalAmount += $amount
                $totalExtractedAmount += $amount
            }

            $byVendor[$processed.Vendor].Receipts += $processed
        }
        catch {
            $processingErrors++
            Write-Log -Level 'WARN' -Message "Failed to process receipt record: $($_.Exception.Message)"
        }
    }

    $needsReview = @($processedReceipts | Where-Object { $_.NeedsManualReview })
    $pricebookCandidates = @($processedReceipts | Where-Object {
        $_.MaterialKeywords.Count -gt 0 -and $_.TotalAmount -gt 0
    })

    $dateTag = Get-Date -Format 'yyyy-MM-dd'
    $processedFile = Join-Path $OutputPath "receipts_processed_$dateTag.json"
    $vendorFile = Join-Path $OutputPath "receipts_by_vendor_$dateTag.json"
    $csvFile = Join-Path $OutputPath "receipts_summary_$dateTag.csv"
    $reviewFile = Join-Path $OutputPath "receipts_needs_review_$dateTag.csv"
    $pricebookFile = Join-Path $OutputPath "pricebook_candidates_$dateTag.json"
    $summaryFile = Join-Path $OutputPath "extraction_summary_$dateTag.json"

    $processedReceipts | ConvertTo-Json -Depth 10 | Set-Content -Path $processedFile -Encoding utf8
    $byVendor | ConvertTo-Json -Depth 10 | Set-Content -Path $vendorFile -Encoding utf8

    $csvData = $processedReceipts | Select-Object `
        Date,
        Vendor,
        PONumber,
        InvoiceNumber,
        TotalAmount,
        @{ Name = 'Materials'; Expression = { $_.MaterialKeywords -join ', ' } },
        NeedsManualReview,
        EmailId,
        Subject

    $csvData | Export-Csv -Path $csvFile -NoTypeInformation

    if ($needsReview.Count -gt 0) {
        $needsReview | Select-Object Date, Vendor, Subject, From, PONumber, InvoiceNumber |
            Export-Csv -Path $reviewFile -NoTypeInformation
        Write-Log -Level 'WARN' -Message "$($needsReview.Count) receipts need manual review - see $reviewFile"
    }

    $pricebookCandidates | ConvertTo-Json -Depth 10 | Set-Content -Path $pricebookFile -Encoding utf8

    $summary = [ordered]@{
        ProcessedAt = (Get-Date).ToString('o')
        InputFile = $ReceiptsFile
        OutputPath = $OutputPath
        TotalReceipts = $receipts.Count
        ProcessedReceipts = $processedReceipts.Count
        ProcessingErrors = $processingErrors
        NeedsReview = $needsReview.Count
        PricebookCandidates = $pricebookCandidates.Count
        TotalExtractedAmount = [math]::Round($totalExtractedAmount, 2)
    }
    $summary | ConvertTo-Json -Depth 10 | Set-Content -Path $summaryFile -Encoding utf8

    Write-Log -Level 'INFO' -Message '========================================='
    Write-Log -Level 'INFO' -Message 'EXTRACTION COMPLETE'
    Write-Log -Level 'INFO' -Message "Total Receipts: $($receipts.Count)"
    Write-Log -Level 'INFO' -Message "Processed Receipts: $($processedReceipts.Count)"
    Write-Log -Level 'INFO' -Message "Processing Errors: $processingErrors"
    Write-Log -Level 'INFO' -Message "Total Extracted Amount: `$$([math]::Round($totalExtractedAmount, 2))"
    Write-Log -Level 'INFO' -Message "Needs Review: $($needsReview.Count)"
    Write-Log -Level 'INFO' -Message "Pricebook Candidates: $($pricebookCandidates.Count)"
    Write-Log -Level 'INFO' -Message '========================================='
    Write-Log -Level 'INFO' -Message 'BY VENDOR:'

    foreach ($vendor in ($byVendor.Keys | Sort-Object)) {
        $data = $byVendor[$vendor]
        Write-Log -Level 'INFO' -Message "  $vendor`: $($data.Count) receipts, `$$([math]::Round($data.TotalAmount, 2))"
    }

    Write-Log -Level 'INFO' -Message '========================================='
    Write-Log -Level 'INFO' -Message 'Next Steps:'
    Write-Log -Level 'INFO' -Message '1. Review receipts_needs_review CSV for manual data entry'
    Write-Log -Level 'INFO' -Message '2. Use pricebook_candidates output for pricing updates'
    Write-Log -Level 'INFO' -Message '3. Match PO/invoice numbers to ServiceTitan jobs for reconciliation'

    $result = [ordered]@{
        Status = 'Success'
        Summary = $summary
        OutputFiles = @{
            ProcessedReceipts = $processedFile
            VendorSummary = $vendorFile
            CsvSummary = $csvFile
            NeedsReview = if ($needsReview.Count -gt 0) { $reviewFile } else { $null }
            PricebookCandidates = $pricebookFile
            ExtractionSummary = $summaryFile
        }
    }

    Write-Output '---JSON_OUTPUT_START---'
    Write-Output ($result | ConvertTo-Json -Depth 10 -Compress)
    Write-Output '---JSON_OUTPUT_END---'
}
catch {
    Write-Log -Level 'ERROR' -Message "Receipt extraction failed: $($_.Exception.Message)"

    $errorResult = @{
        Status = 'Failed'
        Error = $_.Exception.Message
    }

    Write-Output '---JSON_OUTPUT_START---'
    Write-Output ($errorResult | ConvertTo-Json -Depth 10 -Compress)
    Write-Output '---JSON_OUTPUT_END---'
    exit 1
}
