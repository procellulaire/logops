<#
.SYNOPSIS
    Retrieves Office 365 infrastructure information and detailed Entra ID configuration using the Microsoft Graph API.
    By Fernando Cabal - 02 April 2025
    
.DESCRIPTION
    This script uses the Microsoft Graph API to gather information about your Office 365 environment
    and Entra ID (Azure AD) configuration.  It retrieves details about domains, users, groups,
    applications, and authentication methods.  This information can be helpful for auditing,
    reporting, and troubleshooting.

.NOTES
    * Requires the Microsoft.Graph.Authentication and Microsoft.Graph modules to be installed.
    * You must have appropriate permissions in your Azure AD tenant to run this script.
    * The script uses interactive authentication, so you will be prompted to sign in.
    * For production use, consider using a managed identity or service principal with certificate authentication.
    * The script handles errors and logs them to the console.

.EXAMPLE
    Get-Office365InfraAndEntraIDInfo.ps1 | Out-File -FilePath "O365Config.txt" -Encoding "UTF8"

    Retrieves Office 365 infrastructure and Entra ID information and saves it to the O365Config.txt file.

.EXAMPLE
    Get-Office365InfraAndEntraIDInfo.ps1

    Retrieves Office 365 infrastructure and Entra ID information and displays it in the console.
#>
[CmdletBinding()]
param()

# Install Microsoft.Graph modules (if not already installed)
try {
    Write-Host "Checking for Microsoft.Graph modules..." -ForegroundColor Cyan
    Get-Module -Name Microsoft.Graph.Authentication -ListAvailable -ErrorAction SilentlyContinue
    if (-not $?) {
        Write-Host "Installing Microsoft.Graph.Authentication module..." -ForegroundColor Cyan
        Install-Module -Name Microsoft.Graph.Authentication -Scope CurrentUser -Force -ErrorAction Stop
    }
    Get-Module -Name Microsoft.Graph -ListAvailable -ErrorAction SilentlyContinue
     if (-not $?) {
        Write-Host "Installing Microsoft.Graph module..." -ForegroundColor Cyan
        Install-Module -Name Microsoft.Graph -Scope CurrentUser -Force -ErrorAction Stop
    }
    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
    Import-Module Microsoft.Graph -ErrorAction Stop
}
catch {
    Write-Error "Failed to install or import Microsoft.Graph modules: $($_.Exception.Message)"
    exit
}

#region Authentication

# Connect to Microsoft Graph
try {
    Write-Host "Connecting to Microsoft Graph..." -ForegroundColor Cyan
    Connect-MgGraph -Scopes "Application.Read.All", "Application.ReadWrite.All", "Directory.Read.All", "Directory.ReadWrite.All", "Domain.Read.All", "Group.Read.All", "Group.ReadWrite.All", "User.Read.All", "User.ReadWrite.All", "AuditLog.Read.All" -ErrorAction Stop
}
catch {
    Write-Error "Failed to connect to Microsoft Graph: $($_.Exception.Message)"
    exit
}
#endregion Authentication

#region Helper Functions
function Get-EntraIDInfo {
    <#
    .SYNOPSIS
        Retrieves and formats Entra ID information.

    .DESCRIPTION
        This function retrieves various Entra ID configuration details, including tenant information,
        domains, users, groups, applications, and authentication methods, and formats them
        into a PowerShell object.

    .RETURNS
        A PowerShell object containing the Entra ID information.
    #>
    [CmdletBinding()]
    param()
    $EntraIDInfo = [Ordered]@{
        Tenant          = $null
        Domains         = @()
        Users           = @()
        Groups          = @()
        Applications    = @()
        AuthMethods     = @()
        AuditLogs       = @()
    }

     # Get Tenant Information
    try {
        $EntraIDInfo.Tenant = Get-MgOrganization | Select-Object -Property DisplayName, Id, Country, StreetAddress, City, State, PostalCode | ConvertTo-Json -Compress
    }
    catch{
         Write-Warning "Error retrieving tenant information: $($_.Exception.Message)"
    }

    # Get Domains
    try {
        $EntraIDInfo.Domains = Get-MgDomain | Select-Object -Property DomainName, IsDefault, IsVerified | ConvertTo-Json -Compress
    }
    catch {
        Write-Warning "Error retrieving domains: $($_.Exception.Message)"
    }

    # Get Users
    try {
        $EntraIDInfo.Users = Get-MgUser -All | Select-Object -Property DisplayName, UserPrincipalName, Mail, UserType, AccountEnabled | ConvertTo-Json -Compress
    }
    catch {
        Write-Warning "Error retrieving users: $($_.Exception.Message)"
    }

    # Get Groups
    try {
        $EntraIDInfo.Groups = Get-MgGroup -All | Select-Object -Property DisplayName, Mail, GroupTypes, MailEnabled, SecurityEnabled | ConvertTo-Json -Compress
    }
    catch {
        Write-Warning "Error retrieving groups: $($_.Exception.Message)"
    }

    # Get Applications
    try {
       $EntraIDInfo.Applications = Get-MgApplication -All | Select-Object -Property DisplayName, AppId, SignInAudience, PublisherDomain | ConvertTo-Json -Compress
    }
    catch
    {
        Write-Warning "Error retrieving applications : $($_.Exception.Message)"
    }

    # Get Authentication Methods
    try{
        $EntraIDInfo.AuthMethods = Get-MgPolicyAuthenticationMethodPolicy | ConvertTo-Json -Compress
    }
    catch{
        Write-Warning "Error retrieving Authentication methods : $($_.Exception.Message)"
    }

    # Get Audit Logs
    try
    {
        $EntraIDInfo.AuditLogs = Get-MgAuditLogDirectoryAudit -All | Select-Object -Property ActivityDateTime, OperationType, UserId, TargetResources, InitiatedBy | ConvertTo-Json -Compress
    }
    catch{
        Write-Warning "Error retrieving Audit Logs : $($_.Exception.Message)"
    }
    return $EntraIDInfo
}

function Get-Office365Info {
    <#
    .SYNOPSIS
        Retrieves and formats Office 365 infrastructure information.

    .DESCRIPTION
        This function retrieves information about the Office 365 tenant, including domains and services.

    .RETURNS
        A PowerShell object containing the Office 365 information.
    #>
    [CmdletBinding()]
    param()

    $Office365Info = [Ordered]@{
        Domains = @()
    }
    # Get Domains
     try {
        $Office365Info.Domains = Get-MgDomain | Select-Object -Property DomainName, IsDefault, IsVerified, AuthenticationType | ConvertTo-Json -Compress
    }
    catch {
        Write-Warning "Error retrieving domains: $($_.Exception.Message)"
    }
    return $Office365Info
}
#endregion Helper Functions

# Main Script Logic
try {
    Write-Host "Gathering Office 365 and Entra ID information..." -ForegroundColor Cyan

    $Office365Data = Get-Office365Info
    $EntraIDData = Get-EntraIDInfo

    # Output the information
    Write-Host "Office 365 Information:" -ForegroundColor Green
    Write-Output $Office365Data | ConvertFrom-Json | Format-List
    Write-Host "
"
    Write-Host "Entra ID Information:" -ForegroundColor Green
    Write-Output $EntraIDData  | ConvertFrom-Json  | Format-List

    Write-Host "Completed gathering Office 365 and Entra ID information." -ForegroundColor Green

}
catch {
    Write-Error "An error occurred: $($_.Exception.Message)"
}
finally {
    # Disconnect from Microsoft Graph
    try {
        Disconnect-MgGraph
        Write-Host "Disconnected from Microsoft Graph." -ForegroundColor Cyan
    }
    catch {
        Write-Warning "Failed to disconnect from Microsoft Graph: $($_.Exception.Message)"
    }
}
