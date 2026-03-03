<#
.SYNOPSIS
    Applies Phoenix Electric custom theme to SharePoint Online.

.DESCRIPTION
    Connects to the SharePoint Online admin center, registers/updates the
    Phoenix Electric tenant theme palette, and optionally applies it to a site.

.PARAMETER AdminUrl
    SharePoint Online admin URL.
    Example: https://phoenixelectric-admin.sharepoint.com

.PARAMETER SiteUrl
    Optional. Specific site URL to apply the theme to.
    Example: https://phoenixelectric.sharepoint.com/sites/PhoenixElectric

.PARAMETER ThemeName
    Optional. Tenant theme name. Defaults to PhoenixElectric.

.EXAMPLE
    ./Phoenix-SharePoint-Theme.ps1 -AdminUrl "https://phoenixelectric-admin.sharepoint.com"

.EXAMPLE
    ./Phoenix-SharePoint-Theme.ps1 -AdminUrl "https://phoenixelectric-admin.sharepoint.com" -SiteUrl "https://phoenixelectric.sharepoint.com/sites/PhoenixElectric"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://.+-admin\.sharepoint\.com/?$')]
    [string]$AdminUrl,

    [Parameter(Mandatory = $false)]
    [ValidatePattern('^https://.+\.sharepoint\.com/.+$')]
    [string]$SiteUrl,

    [Parameter(Mandatory = $false)]
    [string]$ThemeName = 'PhoenixElectric'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Log {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $color = switch ($Level) {
        'INFO' { 'Cyan' }
        'WARN' { 'Yellow' }
        'ERROR' { 'Red' }
        default { 'White' }
    }

    Write-Host "[$timestamp] $Level: $Message" -ForegroundColor $color
}

function Ensure-SpoModule {
    $moduleName = 'Microsoft.Online.SharePoint.PowerShell'

    if (-not (Get-Module -ListAvailable -Name $moduleName)) {
        Write-Log -Level 'WARN' -Message "Module '$moduleName' not found. Installing for current user..."
        Install-Module -Name $moduleName -Scope CurrentUser -Force -AllowClobber
    }

    Import-Module $moduleName -ErrorAction Stop
}

$phoenixTheme = @{
    themePrimary        = '#FF6B00'
    themeLighterAlt     = '#FFF9F5'
    themeLighter        = '#FFE6D6'
    themeLight          = '#FFCFB3'
    themeTertiary       = '#FF9F66'
    themeSecondary      = '#FF7519'
    themeDarkAlt        = '#E66000'
    themeDark           = '#C25100'
    themeDarker         = '#8F3C00'

    neutralLighterAlt   = '#FAF9F8'
    neutralLighter      = '#F3F2F1'
    neutralLight        = '#EDEBE9'
    neutralQuaternaryAlt= '#E1DFDD'
    neutralQuaternary   = '#D0D0D0'
    neutralTertiaryAlt  = '#C8C6C4'
    neutralTertiary     = '#A19F9D'
    neutralSecondary    = '#605E5C'
    neutralPrimaryAlt   = '#3B3A39'
    neutralPrimary      = '#323130'
    neutralDark         = '#201F1E'

    black               = '#000000'
    white               = '#FFFFFF'
}

Write-Log -Level 'INFO' -Message '========================================='
Write-Log -Level 'INFO' -Message 'Phoenix SharePoint Theme Script'
Write-Log -Level 'INFO' -Message '========================================='

try {
    Ensure-SpoModule

    Write-Log -Level 'INFO' -Message "Connecting to SharePoint admin: $AdminUrl"
    Connect-SPOService -Url $AdminUrl
    Write-Log -Level 'INFO' -Message 'Connected successfully.'

    Write-Log -Level 'INFO' -Message "Adding/updating tenant theme '$ThemeName'..."
    Add-SPOTheme -Identity $ThemeName -Palette $phoenixTheme -IsInverted $false -Overwrite
    Write-Log -Level 'INFO' -Message "Theme '$ThemeName' is registered in the tenant theme gallery."

    if ($SiteUrl) {
        $setThemeCmd = Get-Command -Name Set-SPOWebTheme -ErrorAction SilentlyContinue
        if (-not $setThemeCmd) {
            throw 'Set-SPOWebTheme cmdlet not found in current SharePoint module version.'
        }

        Write-Log -Level 'INFO' -Message "Applying theme '$ThemeName' to site: $SiteUrl"
        Set-SPOWebTheme -Theme $ThemeName -Web $SiteUrl
        Write-Log -Level 'INFO' -Message 'Site theme applied successfully.'
    }

    Write-Host ''
    Write-Log -Level 'INFO' -Message 'Available tenant themes:'
    Get-SPOTheme |
        Sort-Object -Property Name |
        ForEach-Object { Write-Host "  - $($_.Name)" }

    Write-Host ''
    Write-Log -Level 'INFO' -Message 'Done. Theme is now available in SharePoint Change the Look menu.'
}
catch {
    Write-Log -Level 'ERROR' -Message $_.Exception.Message
    exit 1
}
finally {
    try {
        Disconnect-SPOService
    }
    catch {
        # Ignore disconnect failures.
    }
}
