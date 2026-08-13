[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$helperRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $helperRoot 'src'
$testDirectory = Join-Path $helperRoot 'tests'
$outputDirectory = Join-Path $helperRoot 'build\qa-win32'
$delphiBin = 'C:\Program Files (x86)\Embarcadero\Studio\37.0\bin'
$rsvars = Join-Path $delphiBin 'rsvars.bat'
$dcc32 = Join-Path $delphiBin 'dcc32.exe'

if (-not (Test-Path -LiteralPath $dcc32)) {
    throw "Delphi 13 Win32 compiler not found at $dcc32"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$projects = @(
    'AdversarialProtocolTests.dpr',
    'AdversarialSecurityTests.dpr',
    'PipeIntegrationTests.dpr'
)

$failed = $false
foreach ($projectName in $projects) {
    $project = Join-Path $testDirectory $projectName
    $defines = if ($projectName -eq 'PipeIntegrationTests.dpr') { '-DREMOTE_TESTING' } else { '' }
    $compile = "call `"$rsvars`" && `"$dcc32`" -B -Q $defines -E`"$outputDirectory`" -N0`"$outputDirectory`" -U`"$sourceDirectory`" `"$project`""
    & $env:ComSpec /d /s /c $compile
    if ($LASTEXITCODE -ne 0) {
        throw "Delphi compile failed: $projectName"
    }

    $executable = Join-Path $outputDirectory ([IO.Path]::GetFileNameWithoutExtension($projectName) + '.exe')
    & $executable
    if ($LASTEXITCODE -ne 0) {
        $failed = $true
    }
}

if ($failed) {
    throw 'One or more adversarial QA suites failed'
}
