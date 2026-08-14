#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SourceDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'build\win32'),
    [string]$InstallDirectory = (Join-Path $env:ProgramFiles 'GALAXIE\Remote')
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$serviceSource = Join-Path $source 'GalaxieRemoteSystem.exe'
$agentSource = Join-Path $source 'galaxie-remote-agent.exe'
if (-not (Test-Path -LiteralPath $serviceSource) -or -not (Test-Path -LiteralPath $agentSource)) {
    throw 'Both signed service and worker binaries are required'
}

foreach ($binary in @($serviceSource, $agentSource)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $binary
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Galaxie Works') {
        throw "Invalid GALAXIE Authenticode signature: $binary ($($signature.Status))"
    }
}

if ($PSCmdlet.ShouldProcess($InstallDirectory, 'Install GALAXIE Remote SYSTEM helper')) {
    New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
    $acl = Get-Acl -LiteralPath $InstallDirectory
    $acl.SetAccessRuleProtection($true, $false)
    $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule('SYSTEM', 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $adminsRule = New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators', 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($systemRule)
    $acl.AddAccessRule($adminsRule)
    Set-Acl -LiteralPath $InstallDirectory -AclObject $acl

    $serviceTarget = Join-Path $InstallDirectory 'GalaxieRemoteSystem.exe'
    $agentTarget = Join-Path $InstallDirectory 'galaxie-remote-agent.exe'
    Copy-Item -LiteralPath $serviceSource -Destination $serviceTarget -Force
    Copy-Item -LiteralPath $agentSource -Destination $agentTarget -Force
    & $serviceTarget --install
    if ($LASTEXITCODE -ne 0) { throw 'Service registration failed' }
    & $serviceTarget --start
    if ($LASTEXITCODE -ne 0) { throw 'Service start failed' }
}

