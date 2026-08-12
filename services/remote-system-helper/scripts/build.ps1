[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$CertificateSubject = '',
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
$helperRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $helperRoot '..\..')).Path
$agentManifest = Join-Path $repoRoot 'services\remote-system-agent\Cargo.toml'
$outputDirectory = Join-Path $helperRoot 'build\win32'
$delphiBin = 'C:\Program Files (x86)\Embarcadero\Studio\37.0\bin'
$rsvars = Join-Path $delphiBin 'rsvars.bat'
$dcc32 = Join-Path $delphiBin 'dcc32.exe'

if (-not (Test-Path -LiteralPath $dcc32)) {
    throw "Delphi 13 Win32 compiler not found at $dcc32"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$sourceDirectory = Join-Path $helperRoot 'src'
$testDirectory = Join-Path $helperRoot 'tests'
$serviceProject = Join-Path $sourceDirectory 'GalaxieRemoteSystem.dpr'
$protocolTests = Join-Path $testDirectory 'ProtocolTests.dpr'
$securityTests = Join-Path $testDirectory 'SecurityTests.dpr'

$dccFlags = if ($Configuration -eq 'Release') { '-B -Q -$D- -$L- -$O+ -$R+ -$Q+' } else { '-B -Q -$D+ -$L+ -$O-' }
$compileService = "call `"$rsvars`" && `"$dcc32`" $dccFlags -E`"$outputDirectory`" -N0`"$outputDirectory`" -U`"$sourceDirectory`" `"$serviceProject`""
$compileTests = "call `"$rsvars`" && `"$dcc32`" -B -Q -E`"$outputDirectory`" -N0`"$outputDirectory`" -U`"$sourceDirectory`" `"$protocolTests`""
$compileSecurityTests = "call `"$rsvars`" && `"$dcc32`" -B -Q -E`"$outputDirectory`" -N0`"$outputDirectory`" -U`"$sourceDirectory`" `"$securityTests`""

& $env:ComSpec /d /s /c $compileService
if ($LASTEXITCODE -ne 0) { throw 'Delphi service build failed' }
& $env:ComSpec /d /s /c $compileTests
if ($LASTEXITCODE -ne 0) { throw 'Delphi protocol test build failed' }
& $env:ComSpec /d /s /c $compileSecurityTests
if ($LASTEXITCODE -ne 0) { throw 'Delphi security test build failed' }

& (Join-Path $outputDirectory 'ProtocolTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Delphi protocol tests failed' }
& (Join-Path $outputDirectory 'SecurityTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Delphi security tests failed' }

$cargoArgs = @('build', '--manifest-path', $agentManifest)
if ($Configuration -eq 'Release') { $cargoArgs += '--release' }
& cargo @cargoArgs
if ($LASTEXITCODE -ne 0) { throw 'Rust worker build failed' }

$cargoProfile = if ($Configuration -eq 'Release') { 'release' } else { 'debug' }
$agentExe = Join-Path (Split-Path -Parent $agentManifest) "target\$cargoProfile\galaxie-remote-system-agent.exe"
if (-not (Test-Path -LiteralPath $agentExe)) { throw "Rust worker missing at $agentExe" }
Copy-Item -LiteralPath $agentExe -Destination (Join-Path $outputDirectory 'galaxie-remote-agent.exe') -Force

if ($CertificateSubject) {
    $signTool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe |
        Where-Object { $_.FullName -match '\\x86\\signtool\.exe$' } |
        Sort-Object FullName -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $signTool) { throw 'signtool.exe not found' }
    $binaries = @(
        (Join-Path $outputDirectory 'GalaxieRemoteSystem.exe'),
        (Join-Path $outputDirectory 'galaxie-remote-agent.exe')
    )
    foreach ($binary in $binaries) {
        & $signTool sign /n $CertificateSubject /fd SHA256 /tr $TimestampUrl /td SHA256 $binary
        if ($LASTEXITCODE -ne 0) { throw "Authenticode signing failed for $binary" }
        & $signTool verify /pa /all $binary
        if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed for $binary" }
    }
}

Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $outputDirectory 'GalaxieRemoteSystem.exe'), (Join-Path $outputDirectory 'galaxie-remote-agent.exe') |
    Format-Table -AutoSize
