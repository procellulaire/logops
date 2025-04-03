<#
.SYNOPSIS
    Rotates log files in a Kubernetes environment by copying large files to a backup directory,
    compressing them, and then deleting the originals.

    By Fernando Cabal - April 2nd 2025
   
    I couldn't believe my eyes when working on the field I had to open a ticket to explain the need for scripts to cleanup files on a kubernetes pods on kubernetes server
    If a system administrator can't do this, you have to wonder what they're doing; it's the most basic and essential task. Make it an Interview question lol.
    Every day, hundreds of hours are spent on tickets on this topic and operational incidents. This has to stop!
    Here's my gift to the IT world: a free, editable Powershell version 


.DESCRIPTION
    This script is designed to process log files within a Kubernetes environment, specifically targeting
    files that exceed a defined size threshold. It copies these large files to a designated backup directory,
    compresses them to save space, and then removes the original files from their source location.
    This process helps to manage log file growth, prevent disk space issues, and automate log maintenance
    in Kubernetes deployments.

.PARAMETER SourceDirectory
    The path to the directory containing the log files to be processed.  In a Kubernetes environment,
    this might be a volume mount within a pod.

.PARAMETER DestinationDirectory
    The path to the directory where the rotated log files should be stored.  In Kubernetes, this
    could be a persistent volume or a shared storage location.

.PARAMETER LogFilePath
    The path to the log file where script actions and errors will be recorded.  This should be a
    location accessible by the script within the Kubernetes environment.

.PARAMETER SizeThresholdMB
    The minimum file size in megabytes for a log file to be considered for rotation. Files larger
    than this threshold will be processed.  Defaults to 500MB.

.PARAMETER GzipLevel
    The level of gzip compression to use.  Valid values are integers from 1 (fastest, least compression)
    to 9 (slowest, best compression).  Defaults to 6.

.PARAMETER DeleteOriginal
    A switch that specifies whether the original log file should be deleted after successful copying
    and compression.  If this switch is not provided, the original files are NOT deleted.

.EXAMPLE
    Rotate-KubernetesLogs -SourceDirectory "/var/log/myapp" -DestinationDirectory "/mnt/backup/logs" -LogFilePath "/var/log/scripts/log-rotation.log" -SizeThresholdMB 1024 -GzipLevel 7 -DeleteOriginal

    Processes log files in /var/log/myapp, moves files larger than 1GB to /mnt/backup/logs, compresses them
    using gzip level 7, deletes the original files, and logs actions to /var/log/scripts/log-rotation.log.

.NOTES
    * This script is designed to run within a Kubernetes pod.
    * Ensure that the pod has appropriate volume mounts for the source and destination directories.
    * The script requires PowerShell 5.0 or later, which is typically available in Windows Server Core
    * It is recommended to schedule this script to run periodically using a Kubernetes CronJob.
    * The script will create the destination directory and log file directory if they do not exist.
    * Permissions must be set correctly on the volume mounts to allow the script to read and write files.
    * The use of a Persistent Volume (PV) and Persistent Volume Claim (PVC) is highly recommended for the
        destination directory to ensure that rotated logs are persisted across pod restarts.
#>
param(
    [Parameter(Mandatory = $true, HelpMessage = "Enter the path to the source directory containing the log files.")]
    [string] $SourceDirectory,

    [Parameter(Mandatory = $true, HelpMessage = "Enter the path to the destination directory where rotated logs will be stored.")]
    [string] $DestinationDirectory,

    [Parameter(Mandatory = $true, HelpMessage = "Enter the path to the log file.")]
    [string] $LogFilePath,

    [Parameter(HelpMessage = "Enter the minimum file size in MB for log rotation.")]
    [int] $SizeThresholdMB = 500,

    [Parameter(HelpMessage = "Enter the gzip compression level (1-9).")]
    [ValidateRange(1, 9)]
    [int] $GzipLevel = 6,

    [Parameter(HelpMessage = "Switch to delete original log files after successful processing.")]
    [switch] $DeleteOriginal
)

#region Helper Functions

function Write-Log {
    <#
    .SYNOPSIS
        Writes a message to the log file and to the console.

    .DESCRIPTION
        This function writes a message to the specified log file using the PowerShell logging mechanism
        and also displays the message on the console.  It handles different log levels (Information, Warning,
        Error) and formats the output consistently.

    .PARAMETER Message
        The message to be written to the log.

    .PARAMETER Level
        The log level of the message.  Valid values are:
        -   Information (default)
        -   Warning
        -   Error

    .PARAMETER NoClobber
        Prevents the log file from being overwritten.

    .EXAMPLE
        Write-Log -Message "Starting log rotation." -Level Information

        Writes an informational message to the log file and console.

    .EXAMPLE
        Write-Log -Message "Failed to copy file." -Level Error

        Writes an error message to the log file and console.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, HelpMessage = "Enter the message to be written to the log.")]
        [string] $Message,

        [Parameter(HelpMessage = "Enter the level of the log message (Information, Warning, Error).")]
        [ValidateSet("Information", "Warning", "Error")]
        [string] $Level = "Information",

        [switch] $NoClobber
    )

    # Create log directory if it does not exist
    $LogDir = Split-Path -Path $LogFilePath -Parent
    if (-not (Test-Path -Path $LogDir -PathType Container)) {
        try {
            New-Item -Path $LogDir -ItemType Directory -Force | Out-Null
        }
        catch {
            Write-Warning "Failed to create log directory: $($_.Exception.Message)"
            # Continue, the script might still work if it already has the directory.
        }
    }

    # Determine the appropriate log function and write to log
    $LogFunction = Switch ($Level) {
        "Information" { $PSBoundParameters.Remove("Level"); Write-Information }
        "Warning"     { $PSBoundParameters.Remove("Level"); Write-Warning     }
        "Error"       { $PSBoundParameters.Remove("Level"); Write-Error       }
        Default       { $PSBoundParameters.Remove("Level"); Write-Information } #Should never reach here, but default
    }
    try{
        $LogFunction @PSBoundParameters

         # Also write to file.
        Add-Content -Path $LogFilePath -Value ("{0} - {1} - {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message)  -NoClobber:$NoClobber
    }
    catch
    {
       Write-Warning "Error writing to log file $($LogFilePath): $($_.Exception.Message)"
    }
}

function Get-FileSizeMB {
    <#
    .SYNOPSIS
        Gets the size of a file in megabytes.

    .DESCRIPTION
        This function calculates the size of a file in megabytes.  It handles cases where the file does
        not exist and includes error handling.

    .PARAMETER FilePath
        The path to the file.

    .RETURNS
        The size of the file in megabytes as a float, or 0 if the file does not exist or an error occurs.

    .EXAMPLE
        $size = Get-FileSizeMB -FilePath "C:\Logs\MyLogFile.log"
        Write-Host "File size: $size MB"
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, HelpMessage = "Enter the path to the file.")]
        [string] $FilePath
    )

    try {
        if (Test-Path -Path $FilePath -PathType Leaf) {
            $FileSize = (Get-Item -Path $FilePath).Length / (1MB)
            return $FileSize
        }
        else {
            Write-Log -Message "File not found: $FilePath" -Level Warning
            return 0
        }
    }
    catch {
        Write-Log -Message "Error getting file size for $FilePath: $($_.Exception.Message)" -Level Error
        return 0
    }
}

function Compress-File {
    <#
    .SYNOPSIS
        Compresses a file using gzip.

    .DESCRIPTION
        This function compresses a file using the gzip algorithm.  It handles file operations and
        includes error handling.

    .PARAMETER InputFile
        The path to the input file.

    .PARAMETER OutputFile
        The path to the output (compressed) file.

    .PARAMETER Level
        The gzip compression level (1-9).

    .RETURNS
        $true if the compression is successful, $false otherwise.

    .EXAMPLE
        $compressed = Compress-File -InputFile "C:\Logs\MyLogFile.log" -OutputFile "C:\Backup\MyLogFile.log.gz" -Level 7
        if ($compressed) {
            Write-Host "File compressed successfully."
        }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, HelpMessage = "Enter the path to the input file.")]
        [string] $InputFile,

        [Parameter(Mandatory = $true, HelpMessage = "Enter the path to the output (compressed) file.")]
        [string] $OutputFile,

        [Parameter(Mandatory = $false, HelpMessage = "Enter the gzip compression level (1-9).")]
        [ValidateRange(1, 9)]
        [int] $Level = 6
    )

    try {
        # Create the output directory if it does not exist
        $OutDir = Split-Path -Path $OutputFile -Parent
        if ($OutDir -and -not (Test-Path -Path $OutDir -PathType Container))
        {
            New-Item -Path $OutDir -ItemType Directory -Force | Out-Null
        }

        Add-Type -AssemblyName "System.IO.Compression.FileSystem" #Load the assembly

        $InputStream  = New-Object -TypeName System.IO.FileStream -ArgumentList $InputFile, ([System.IO.FileMode]::Open), ([System.IO.FileAccess]::Read), ([System.IO.FileShare]::Read)
        $OutputStream = New-Object -TypeName System.IO.FileStream -ArgumentList $OutputFile, ([System.IO.FileMode]::Create), ([System.IO.FileAccess]::Write), ([System.IO.FileShare]::None)
        $GzipStream     = New-Object -TypeName System.IO.Compression.GZipStream -ArgumentList $OutputStream, ([System.IO.Compression.CompressionMode]::Compress), $false
        $GzipStream.Level = $Level  # Set the compression level

        $InputStream.CopyTo($GzipStream)
        $GzipStream.Dispose()
        $OutputStream.Close()
        $InputStream.Close()

        Write-Log -Message "Successfully compressed $InputFile to $OutputFile with level $Level" -Level Information
        return $true
    }
    catch {
        Write-Log -Message "Error compressing file $InputFile: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Copy-File {
    <#
    .SYNOPSIS
        Copies a file from source to destination.

    .DESCRIPTION
        This function copies a file from a source path to a destination path.  It handles directory
        creation and includes error handling.

    .PARAMETER SourceFile
        The path to the source file.

    .PARAMETER DestinationFile
        The path to the destination file.

    .RETURNS
        $true if the copy is successful, $false otherwise.

    .EXAMPLE
        $copied = Copy-File -SourceFile "C:\Logs\MyLogFile.log" -DestinationFile "D:\Backup\MyLogFile.log"
        if ($copied) {
            Write-Host "File copied successfully."
        }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, HelpMessage = "Enter the path to the source file.")]
        [string] $SourceFile,

        [Parameter(Mandatory = $true, HelpMessage = "Enter the path to the destination file.")]
        [string] $DestinationFile
    )

    try {
        # Ensure the destination directory exists
        $DestDir = Split-Path -Path $DestinationFile -Parent
        if (-not (Test-Path -Path $DestDir -PathType Container)) {
            New-Item -Path $DestDir -ItemType Directory -Force | Out-Null
        }

        Copy-Item -Path $SourceFile -Destination $DestinationFile -Force
        Write-Log -Message "Successfully copied $SourceFile to $DestinationFile" -Level Information
        return $true
    }
    catch {
        Write-Log -Message "Error copying file $SourceFile to $DestinationFile: $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Delete-File {
    <#
    .SYNOPSIS
        Deletes a file.

    .DESCRIPTION
        This function deletes a file at the specified path.  It includes error handling.

    .PARAMETER FilePath
        The path to the file to delete.

    .RETURNS
        $true if the deletion is successful, $false otherwise.

    .EXAMPLE
        $deleted = Delete-File -FilePath "C:\Backup\MyLogFile.log"
        if ($deleted) {
            Write-Host "File deleted successfully."
        }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, HelpMessage = "Enter the path to the file to delete.")]
        [string] $FilePath
    )

    try {
        Remove-Item -Path $FilePath -Force
        Write-Log -Message "Successfully deleted file: $FilePath" -Level Information
        return $true
    }
    catch {
        Write-Log -Message "Error deleting file $FilePath: $($_.Exception.Message)" -Level Error
        return $false
    }
}

#endregion Helper Functions

# Main Script Logic
try {
    # Check if source and destination directories exist
    if (-not (Test-Path -Path $SourceDirectory -PathType Container)) {
        Write-Log -Message "Source directory does not exist: $SourceDirectory" -Level Error
        exit
    }
    if (-not (Test-Path -Path $DestinationDirectory -PathType Container)) {
        Write-Log -Message "Destination directory does not exist: $DestinationDirectory" -Level Error
        exit
    }

    Write-Log -Message "Starting log file processing from $SourceDirectory to $DestinationDirectory" -Level Information

    # Get a list of files in the source directory
    $Files = Get-ChildItem -Path $SourceDirectory -File

    foreach ($File in $Files) {
        $SourceFile = $File.FullName
        $FileSizeMB = Get-FileSizeMB -FilePath $SourceFile

        if ($FileSizeMB -gt $SizeThresholdMB) {
            Write-Log -Message "Found large file: $SourceFile ($($FileSizeMB.ToString('F2')) MB)" -Level Information

            # Create destination file name
            $DestinationFile = Join-Path -Path $DestinationDirectory -ChildPath $File.Name
            $CompressedFile  = "$DestinationFile.gz"

            # Copy the file
            $CopySuccess = Copy-File -SourceFile $SourceFile -DestinationFile $DestinationFile

            if ($CopySuccess) {
                # Compress the copied file
                $CompressSuccess = Compress-File -InputFile $DestinationFile -OutputFile $CompressedFile -Level $GzipLevel
                if ($CompressSuccess) {
                    # Delete the original file
                    if ($DeleteOriginal)
                    {
                        $DeleteSuccess = Delete-File -FilePath $DestinationFile
                        if ($DeleteSuccess) {
                            Write-Log -Message "Successfully processed $SourceFile" -Level Information
                        }
                        else {
                            Write-Log -Message "Failed to delete original file: $DestinationFile" -Level Error
                        }
                    }
                    else
                    {
                         Write-Log -Message "Successfully processed $SourceFile. Original file was not deleted as DeleteOriginal switch was not provided." -Level Information
                    }
                }
                else {
                    Write-Log -Message "Failed to compress file: $DestinationFile" -Level Error
                }
            }
            else {
                Write-Log -Message "Failed to copy file: $SourceFile" -Level Error
            }
        }
        else {
            Write-Log -Message "Skipping file: $SourceFile ($($FileSizeMB.ToString('F2')) MB) - Size is not greater than $($SizeThresholdMB)MB" -Level Information
        }
    }

    Write-Log -Message "Log file processing complete." -Level Information
}
catch {
    Write-Log -Message "An unexpected error occurred: $($_.Exception.Message)" -Level Error
    Write-Log -Message "Stack Trace: $($_.Exception.StackTrace)" -Level Error
}
