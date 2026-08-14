#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallDirectory = (Join-Path $env:ProgramFiles 'GALAXIE\Remote')
)

$ErrorActionPreference = 'Stop'
$service = Join-Path $InstallDirectory 'GalaxieRemoteSystem.exe'
if (Test-Path -LiteralPath $service) {
    if ($PSCmdlet.ShouldProcess($service, 'Stop and unregister GALAXIE Remote SYSTEM helper')) {
        & $service --stop
        Start-Sleep -Seconds 2
        & $service --uninstall
    }
}

Write-Output "Service unregistered. Installed files remain at $InstallDirectory for recovery/audit; remove them separately if desired."

