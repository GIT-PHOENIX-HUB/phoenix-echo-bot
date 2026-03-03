<#
.SYNOPSIS
    Phoenix Customer Processor - Dedupe and Organize ServiceTitan Customers
.DESCRIPTION
    Processes ServiceTitan customer export to:
    1. Remove duplicates (same customer, multiple jobs)
    2. Categorize (Builder vs Residential)
    3. Generate SharePoint folder structure manifest
    4. Create master customer index outputs
.NOTES
    Runtime: PowerShell 7.2
    Author: Phoenix Electric AI Team
    Version: 1.1.0
#>

param(
    [string]$InputFile,
    [string]$OutputPath = '/Users/shanewarehime/GitHub/PHOENIX_AI/Data/Customers'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ============================================================================
# CONFIGURATION
# ============================================================================

$script:KnownBuilders = @(
    'bmc', 'vail valley', 'alpine', 'construction', 'homes', 'builder',
    'development', 'properties', 'custom', 'luxury', 'aspen', 'snowmass',
    'edwards', 'avon', 'beaver creek', 'minturn', 'red cliff',
    'east west', 'triumph', 'slifer', 'berkshire', 'keller williams'
)

$script:ResidentialKeywords = @(
    'residence', 'family', 'personal', 'homeowner'
)

$script:ServiceSubfolders = @(
    'Estimates_Proposals',
    'Invoices_Payments',
    'Job_Documentation',
    'Photos_Inspections',
    'Permits_Compliance',
    'Correspondence',
    'Contracts_Agreements'
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
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-FieldValue {
    param(
        [Parameter(Mandatory = $true)][object]$Row,
        [Parameter(Mandatory = $true)][string[]]$Names
    )

    foreach ($name in $Names) {
        if ($Row.PSObject.Properties.Name -contains $name) {
            $value = $Row.$name
            if ($null -ne $value) {
                $text = [string]$value
                if (-not [string]::IsNullOrWhiteSpace($text)) {
                    return $text.Trim()
                }
            }
        }
    }

    return ''
}

function Normalize-Email {
    param([string]$Email)

    if ([string]::IsNullOrWhiteSpace($Email)) { return '' }
    return $Email.Trim().ToLowerInvariant()
}

function Normalize-PhoneNumber {
    param([string]$Phone)

    if ([string]::IsNullOrWhiteSpace($Phone)) { return '' }

    $digits = $Phone -replace '\D', ''
    if ($digits.Length -eq 10) {
        return "($($digits.Substring(0,3))) $($digits.Substring(3,3))-$($digits.Substring(6,4))"
    }

    return $Phone.Trim()
}

function Normalize-PhoneDigits {
    param([string]$Phone)

    if ([string]::IsNullOrWhiteSpace($Phone)) { return '' }
    return ($Phone -replace '\D', '')
}

function Get-SafeFolderName {
    param([string]$Name)

    $candidate = if ([string]::IsNullOrWhiteSpace($Name)) { 'UnknownCustomer' } else { $Name }
    $safeName = $candidate -replace '[\\/:*?"<>|]', '_'
    $safeName = $safeName -replace '\s+', ' '
    $safeName = $safeName.Trim()

    if ($safeName.Length -gt 50) {
        $safeName = $safeName.Substring(0, 50).Trim()
    }

    if ([string]::IsNullOrWhiteSpace($safeName)) {
        return 'UnknownCustomer'
    }

    return $safeName
}

function Get-CustomerCategory {
    param([object]$Customer)

    $name = Get-FieldValue -Row $Customer -Names @('Name', 'CustomerName')
    $businessName = Get-FieldValue -Row $Customer -Names @('BusinessName', 'CompanyName')
    $combined = "$name $businessName".ToLowerInvariant()

    foreach ($builder in $script:KnownBuilders) {
        if ($combined -match [regex]::Escape($builder)) {
            return 'BUILDER'
        }
    }

    if ($combined -match '\b(llc|inc|corp|company|co\.|construction|builders?)\b') {
        return 'BUILDER'
    }

    foreach ($keyword in $script:ResidentialKeywords) {
        if ($combined -match [regex]::Escape($keyword)) {
            return 'RESIDENTIAL'
        }
    }

    return 'RESIDENTIAL'
}

function Get-CustomerId {
    param([object]$Customer)

    $id = Get-FieldValue -Row $Customer -Names @('CustomerID', 'CustomerId', 'Id', 'ID')
    if ([string]::IsNullOrWhiteSpace($id)) {
        return ''
    }

    return $id
}

function Get-DedupKey {
    param([object]$Customer)

    $id = Get-CustomerId -Customer $Customer
    if ($id) {
        return "id:$id"
    }

    $email = Normalize-Email (Get-FieldValue -Row $Customer -Names @('Email', 'EmailAddress'))
    if ($email) {
        return "email:$email"
    }

    $name = (Get-FieldValue -Row $Customer -Names @('Name', 'CustomerName')).ToLowerInvariant()
    $phoneDigits = Normalize-PhoneDigits (Get-FieldValue -Row $Customer -Names @('Phone', 'MobilePhone', 'HomePhone'))
    if ($name -and $phoneDigits) {
        return "name-phone:$name|$phoneDigits"
    }

    $address = (Get-FieldValue -Row $Customer -Names @('Address', 'Street')).ToLowerInvariant()
    $zip = (Get-FieldValue -Row $Customer -Names @('Zip', 'PostalCode')).ToLowerInvariant()
    if ($name -or $address -or $zip) {
        return "name-addr:$name|$address|$zip"
    }

    return "fallback:$([guid]::NewGuid().ToString())"
}

function Import-CustomerData {
    param([Parameter(Mandatory = $true)][string]$Path)

    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($extension -eq '.csv') {
        return @(Import-Csv -Path $Path)
    }

    if ($extension -in @('.xlsx', '.xls')) {
        try {
            Import-Module ImportExcel -ErrorAction Stop
            return @(Import-Excel -Path $Path)
        }
        catch {
            throw "Failed to import Excel file. Install module with: Install-Module ImportExcel"
        }
    }

    throw "Unsupported input file type: $extension"
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Log -Level 'INFO' -Message '========================================='
Write-Log -Level 'INFO' -Message 'Phoenix Customer Processor v1.1.0'
Write-Log -Level 'INFO' -Message '========================================='

Ensure-Directory -Path $OutputPath

if (-not $InputFile) {
    Write-Log -Level 'INFO' -Message 'No input file provided. Creating export instructions...'

    $templateDoc = @'
# ServiceTitan Customer Export - Expected Format

Required columns (recommended):
- CustomerID
- Name
- BusinessName
- Email
- Phone
- Address
- City
- State
- Zip
- CreatedDate
- LastServiceDate
- TotalJobs
- TotalRevenue

How to export from ServiceTitan:
1. Go to CRM > Customers
2. Click Export
3. Select all relevant columns
4. Export as CSV (preferred) or Excel

Then run:
./Process-Customers.ps1 -InputFile "path/to/export.csv"
'@

    $templateFile = Join-Path $OutputPath 'CUSTOMER_EXPORT_INSTRUCTIONS.md'
    Set-Content -Path $templateFile -Value $templateDoc -Encoding utf8

    Write-Log -Level 'INFO' -Message "Created instructions at $templateFile"
    exit 0
}

if (-not (Test-Path -LiteralPath $InputFile)) {
    throw "Input file not found: $InputFile"
}

Write-Log -Level 'INFO' -Message "Reading customer data from: $InputFile"
$customers = Import-CustomerData -Path $InputFile
Write-Log -Level 'INFO' -Message "Loaded $($customers.Count) records"

if ($customers.Count -eq 0) {
    Write-Log -Level 'WARN' -Message 'No records found in input file. Exiting.'
    exit 0
}

Write-Log -Level 'INFO' -Message 'Starting deduplication...'
$customerGroups = $customers | Group-Object -Property { Get-DedupKey -Customer $_ }
Write-Log -Level 'INFO' -Message "Found $($customerGroups.Count) unique customers from $($customers.Count) records"

$uniqueCustomers = foreach ($group in $customerGroups) {
    $primary = $group.Group[0]

    $customerId = Get-CustomerId -Customer $primary
    if (-not $customerId) {
        $customerId = [guid]::NewGuid().ToString()
    }

    $name = Get-FieldValue -Row $primary -Names @('Name', 'CustomerName')
    $businessName = Get-FieldValue -Row $primary -Names @('BusinessName', 'CompanyName')
    $folderBase = if ($businessName) { $businessName } else { $name }

    [PSCustomObject]@{
        CustomerID = $customerId
        Name = $name
        BusinessName = $businessName
        Email = Normalize-Email (Get-FieldValue -Row $primary -Names @('Email', 'EmailAddress'))
        Phone = Normalize-PhoneNumber (Get-FieldValue -Row $primary -Names @('Phone', 'MobilePhone', 'HomePhone'))
        Address = Get-FieldValue -Row $primary -Names @('Address', 'Street')
        City = Get-FieldValue -Row $primary -Names @('City')
        State = Get-FieldValue -Row $primary -Names @('State', 'Province')
        Zip = Get-FieldValue -Row $primary -Names @('Zip', 'PostalCode')
        CreatedDate = Get-FieldValue -Row $primary -Names @('CreatedDate', 'CreatedOn')
        LastServiceDate = Get-FieldValue -Row $primary -Names @('LastServiceDate', 'LastJobDate')
        TotalJobs = $group.Count
        JobRecords = $group.Group.Count
        Category = Get-CustomerCategory -Customer $primary
        FolderName = Get-SafeFolderName -Name $folderBase
    }
}

Write-Log -Level 'INFO' -Message "Deduplication complete: $($uniqueCustomers.Count) unique customers"

$builders = @($uniqueCustomers | Where-Object { $_.Category -eq 'BUILDER' })
$residential = @($uniqueCustomers | Where-Object { $_.Category -eq 'RESIDENTIAL' })

Write-Log -Level 'INFO' -Message "Builders: $($builders.Count)"
Write-Log -Level 'INFO' -Message "Residential: $($residential.Count)"

Write-Log -Level 'INFO' -Message 'Generating SharePoint folder structure manifest...'

$folderStructure = @{
    Customers = @{
        Builders = @()
        Residential = @()
    }
}

foreach ($customer in $builders) {
    $folderPath = "Customers/Builders/$($customer.FolderName)_$($customer.CustomerID)"
    $folderStructure.Customers.Builders += @{
        Path = $folderPath
        CustomerID = $customer.CustomerID
        Name = $customer.Name
        Subfolders = $script:ServiceSubfolders
    }
}

foreach ($customer in $residential) {
    $folderPath = "Customers/Residential/$($customer.FolderName)_$($customer.CustomerID)"
    $folderStructure.Customers.Residential += @{
        Path = $folderPath
        CustomerID = $customer.CustomerID
        Name = $customer.Name
        Subfolders = $script:ServiceSubfolders
    }
}

$dateTag = Get-Date -Format 'yyyy-MM-dd'

$uniqueFile = Join-Path $OutputPath "customers_unique_$dateTag.json"
$csvFile = Join-Path $OutputPath "customers_unique_$dateTag.csv"
$structureFile = Join-Path $OutputPath "sharepoint_folder_structure_$dateTag.json"
$buildersFile = Join-Path $OutputPath "builders_$dateTag.csv"
$residentialFile = Join-Path $OutputPath "residential_$dateTag.csv"
$summaryFile = Join-Path $OutputPath "process_summary_$dateTag.json"

$uniqueCustomers | ConvertTo-Json -Depth 10 | Set-Content -Path $uniqueFile -Encoding utf8
$uniqueCustomers | Export-Csv -Path $csvFile -NoTypeInformation
$folderStructure | ConvertTo-Json -Depth 10 | Set-Content -Path $structureFile -Encoding utf8
$builders | Export-Csv -Path $buildersFile -NoTypeInformation
$residential | Export-Csv -Path $residentialFile -NoTypeInformation

$summary = @{
    ProcessedDate = (Get-Date).ToString('o')
    InputFile = $InputFile
    TotalRecords = $customers.Count
    UniqueCustomers = $uniqueCustomers.Count
    Builders = $builders.Count
    Residential = $residential.Count
    DuplicatesRemoved = $customers.Count - $uniqueCustomers.Count
}

$summary | ConvertTo-Json -Depth 10 | Set-Content -Path $summaryFile -Encoding utf8

Write-Log -Level 'INFO' -Message '========================================='
Write-Log -Level 'INFO' -Message 'PROCESSING COMPLETE'
Write-Log -Level 'INFO' -Message "Total Records: $($customers.Count)"
Write-Log -Level 'INFO' -Message "Unique Customers: $($uniqueCustomers.Count)"
Write-Log -Level 'INFO' -Message "Duplicates Removed: $($summary.DuplicatesRemoved)"
Write-Log -Level 'INFO' -Message "Builders: $($builders.Count)"
Write-Log -Level 'INFO' -Message "Residential: $($residential.Count)"
Write-Log -Level 'INFO' -Message '========================================='
Write-Log -Level 'INFO' -Message 'Next Steps:'
Write-Log -Level 'INFO' -Message '1. Review builders list for category accuracy'
Write-Log -Level 'INFO' -Message '2. Run SharePoint folder-creation workflow using generated manifest'
Write-Log -Level 'INFO' -Message '3. Import unique customers to the master contact system'
