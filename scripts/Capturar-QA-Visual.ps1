param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("atoms", "onedrive-my-files")]
  [string]$Scenario,

  [string]$BaseUrl = "http://127.0.0.1:1420",
  [string]$OutputDirectory = "artifacts/qa-visual",
  [string]$Prefix = "",
  [string]$Email = "qa@example.com"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputPath = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  $OutputDirectory
} else {
  Join-Path $repoRoot $OutputDirectory
}
$null = New-Item -ItemType Directory -Force -Path $outputPath

$pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpm) {
  $pnpm = Get-Command pnpm -ErrorAction Stop
}

try {
  $response = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing -TimeoutSec 5
  if ($response.StatusCode -ne 200) {
    throw "preview respondeu HTTP $($response.StatusCode)"
  }
} catch {
  throw "Preview indisponivel em $BaseUrl. Rode 'pnpm dev -- --host 127.0.0.1' antes da captura. $($_.Exception.Message)"
}

$session = "galaxie-qa-visual-$PID"
$agentBrowserPackage = "agent-browser@0.33.2"

function Invoke-AgentBrowser {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$CommandArgs
  )

  $arguments = @(
    "--silent",
    "dlx",
    $agentBrowserPackage,
    "--session",
    $session
  ) + $CommandArgs

  & $pnpm.Source @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "agent-browser falhou: $($CommandArgs -join ' ')"
  }
}

function Get-AgentBrowserSnapshot {
  $snapshotPath = Join-Path (
    [System.IO.Path]::GetTempPath()
  ) "galaxie-qa-snapshot-$PID.json"
  $arguments = @(
    "--silent",
    "dlx",
    $agentBrowserPackage,
    "--session",
    $session,
    "snapshot",
    "-i",
    "--json"
  )

  try {
    & $pnpm.Source @arguments > $snapshotPath
    if ($LASTEXITCODE -ne 0) {
      throw "agent-browser falhou ao capturar snapshot"
    }
    return (Get-Content -Raw $snapshotPath | ConvertFrom-Json)
  } finally {
    Remove-Item -LiteralPath $snapshotPath -ErrorAction SilentlyContinue
  }
}

function Set-DarkMode {
  param([bool]$Dark)

  $snapshot = Get-AgentBrowserSnapshot
  $isDark = $snapshot.data.snapshot -match 'switch "Toggle light and dark theme" \[checked=true'
  if ($isDark -ne $Dark) {
    Invoke-AgentBrowser @(
      "find", "role", "switch", "click",
      "--name", "Toggle light and dark theme"
    )
    Invoke-AgentBrowser @("wait", "300")
  }
}

function Scroll-RoleIntoView {
  param(
    [string]$Role,
    [string]$Name
  )

  $snapshot = Get-AgentBrowserSnapshot
  $target = $snapshot.data.refs.PSObject.Properties |
    Where-Object {
      $_.Value.role -eq $Role -and $_.Value.name -eq $Name
    } |
    Select-Object -First 1

  if (-not $target) {
    throw "Elemento de foco nao encontrado: role=$Role name=$Name"
  }
  Invoke-AgentBrowser @("scrollintoview", "@$($target.Name)")
}

$scenarios = @{
  "atoms" = @{
    Steps = @()
    ReadyText = "Customize"
    Focus = $null
  }
  "onedrive-my-files" = @{
    Steps = @(
      @{ Args = @("find", "role", "button", "click", "--name", "M365 Copilot") },
      @{ Args = @("find", "role", "link", "click", "--name", "OneDrive") },
      @{ Args = @("find", "role", "tab", "click", "--name", "My files") }
    )
    ReadyText = "OneDrive usage"
    Focus = @{ Role = "button"; Name = "OneDrive usage" }
  }
}

$namePrefix = if ([string]::IsNullOrWhiteSpace($Prefix)) {
  $Scenario
} else {
  "$Prefix-$Scenario"
}

try {
  Write-Host "Abrindo $BaseUrl..."
  Invoke-AgentBrowser @("open", $BaseUrl)
  Invoke-AgentBrowser @("set", "viewport", "1440", "1000")
  Write-Host "Entrando no mock..."
  Invoke-AgentBrowser @(
    "find", "role", "textbox", "fill",
    "--name", "Work email", $Email
  )
  Invoke-AgentBrowser @(
    "find", "role", "button", "click",
    "--name", "Sign in with Microsoft"
  )
  Invoke-AgentBrowser @("wait", "--text", "Customize")

  $definition = $scenarios[$Scenario]
  Write-Host "Navegando para o cenario '$Scenario'..."
  foreach ($step in $definition.Steps) {
    Invoke-AgentBrowser $step.Args
  }
  Invoke-AgentBrowser @("wait", "--text", $definition.ReadyText)

  if ($definition.Focus) {
    Scroll-RoleIntoView -Role $definition.Focus.Role -Name $definition.Focus.Name
  }

  Write-Host "Capturando tema claro..."
  Set-DarkMode -Dark $false
  $lightPath = Join-Path $outputPath "$namePrefix-light.png"
  Invoke-AgentBrowser @("screenshot", $lightPath)

  Write-Host "Capturando tema escuro..."
  Set-DarkMode -Dark $true
  if ($definition.Focus) {
    Scroll-RoleIntoView -Role $definition.Focus.Role -Name $definition.Focus.Name
  }
  $darkPath = Join-Path $outputPath "$namePrefix-dark.png"
  Invoke-AgentBrowser @("screenshot", $darkPath)

  Write-Host "QA visual capturada:"
  Write-Host "- light: $lightPath"
  Write-Host "- dark:  $darkPath"
  Write-Host "Anexe os dois PNGs a PR de UI; nao os adicione ao commit."
} finally {
  try {
    Invoke-AgentBrowser @("close")
  } catch {
    Write-Warning "Nao foi possivel fechar a sessao ${session}: $($_.Exception.Message)"
  }
}
