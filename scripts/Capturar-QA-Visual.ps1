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

# --- Login do mock (#1274) -------------------------------------------------
# A tela de login NAO e um formulario de um passo: e uma maquina de estados
# (`src/screens/login.tsx:66`, passo provedor -> tipo de conta -> e-mail) e os
# rotulos vem do i18n (`src/lib/strings.ts`, chaves `login.*`), entao mudam com o
# idioma. O script antigo cravava UM caminho em ingles e quebrava a cada mudanca
# de forma (#1274). Este driver nao assume sequencia: a cada volta olha o que
# ESTA na tela e age. Passo novo, ordem diferente ou idioma trocado seguem
# funcionando; so falha quando nao reconhece NADA — e ai diz o que viu.
$LoginUi = @{
  # Passo 1 (provedor) e o submit do passo 3 usam o MESMO rotulo
  # (`login.continuarMicrosoft`) — o driver distingue pela presenca do campo.
  Provedor = @("Continue with Microsoft", "Continuar com a Microsoft")
  # Passo 2: o nome acessivel do botao e a CONCATENACAO titulo+descricao
  # ("Work account For your work email. Requires...") — por isso casa por
  # substring, nunca por igualdade.
  ContaTrabalho = @("Work account", "Conta de trabalho")
  # Passo 3: o rotulo vem do <label for>, mas ha implementacao de arvore de
  # acessibilidade que devolve o placeholder — os dois entram na lista.
  CampoEmail = @(
    "Work email", "E-mail corporativo",
    "you@yourcompany.com", "voce@suaempresa.com"
  )
}

function Find-LoginLabel {
  <#
    .SYNOPSIS
    Devolve o PRIMEIRO rotulo da lista presente na tela no papel pedido, ou $null.
    O valor devolvido e um substring do nome acessivel — serve direto no --name
    do agent-browser (Playwright casa nome por substring, sem diferenciar caixa).
  #>
  param(
    [Parameter(Mandatory = $true)] $Refs,
    [Parameter(Mandatory = $true)] [string]$Role,
    [Parameter(Mandatory = $true)] [string[]]$Labels
  )

  foreach ($label in $Labels) {
    $achou = $Refs | Where-Object {
      $_.Value.role -eq $Role -and
      $_.Value.name -and
      $_.Value.name.ToLowerInvariant().Contains($label.ToLowerInvariant())
    } | Select-Object -First 1
    if ($achou) { return $label }
  }
  return $null
}

function Enter-MockLogin {
  <#
    .SYNOPSIS
    Atravessa o login do mock seja qual for a forma dele. Termina quando nenhum
    controle de login sobra na tela; o `wait` do cenario e que prova que a app
    subiu de fato.
  #>
  param([int]$MaxPassos = 8)

  for ($passo = 1; $passo -le $MaxPassos; $passo++) {
    $snapshot = Get-AgentBrowserSnapshot
    $refs = $snapshot.data.refs.PSObject.Properties

    # Campo de e-mail na tela => passo final: preenche e submete.
    $campo = Find-LoginLabel -Refs $refs -Role "textbox" -Labels $LoginUi.CampoEmail
    if ($campo) {
      $submit = Find-LoginLabel -Refs $refs -Role "button" -Labels $LoginUi.Provedor
      if (-not $submit) {
        throw @"
Login do mock: achei o campo de e-mail ('$campo') mas nenhum botao de submissao
conhecido. Rotulos procurados: $($LoginUi.Provedor -join ' | ').
Se a copy mudou, atualize `$LoginUi em scripts/Capturar-QA-Visual.ps1 a partir de
src/lib/strings.ts (chaves login.*). Tela atual:
$($snapshot.data.snapshot)
"@
      }
      Invoke-AgentBrowser @("find", "role", "textbox", "fill", "--name", $campo, $Email)
      Invoke-AgentBrowser @("find", "role", "button", "click", "--name", $submit)
      continue
    }

    # Escolha de tipo de conta => segue pelo caminho corporativo (o que pede
    # e-mail; o pessoal loga direto e nao exerce o campo).
    $conta = Find-LoginLabel -Refs $refs -Role "button" -Labels $LoginUi.ContaTrabalho
    if ($conta) {
      Invoke-AgentBrowser @("find", "role", "button", "click", "--name", $conta)
      continue
    }

    # Escolha de provedor.
    $provedor = Find-LoginLabel -Refs $refs -Role "button" -Labels $LoginUi.Provedor
    if ($provedor) {
      Invoke-AgentBrowser @("find", "role", "button", "click", "--name", $provedor)
      continue
    }

    # Nada de login na tela. Na PRIMEIRA volta isso e suspeito (a pagina devia
    # abrir no login) — provavelmente o app nem carregou.
    if ($passo -eq 1) {
      throw @"
Login do mock: nenhum controle de login na primeira leitura de $BaseUrl.
Ou a app nao carregou, ou a tela de login mudou por completo. Tela atual:
$($snapshot.data.snapshot)
"@
    }
    return
  }

  throw "Login do mock: nao terminou em $MaxPassos passos — provavel laco na tela de login."
}

$scenarios = @{
  "atoms" = @{
    # #1299: a tela Atoms e `oculto: true` (#663) — nao ha caminho pela UI. A
    # porta `?tela=<id>` (so em dev) da o destino determinístico; por isso
    # `Steps` continua vazio: nao ha o que clicar, e nao deve haver.
    Tela = "atoms"
    Steps = @()
    ReadyText = "Customize"
    Focus = $null
  }
  "onedrive-my-files" = @{
    # Cenario alcancavel pela UI: segue pelos passos, sem porta (nao mexo no que
    # ja funciona — a fatia do #1299 e o destino do cenario `atoms`).
    Tela = $null
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
  $definicaoUrl = $scenarios[$Scenario]
  $url = if ($definicaoUrl.Tela) { "$BaseUrl/?tela=$($definicaoUrl.Tela)" } else { $BaseUrl }
  Write-Host "Abrindo $url..."
  Invoke-AgentBrowser @("open", $url)
  Invoke-AgentBrowser @("set", "viewport", "1440", "1000")
  Write-Host "Entrando no mock..."
  Enter-MockLogin

  $definition = $scenarios[$Scenario]
  Write-Host "Navegando para o cenario '$Scenario'..."
  foreach ($step in $definition.Steps) {
    Invoke-AgentBrowser $step.Args
  }
  # #1274: prontidao do cenario com diagnostico. Sem isto, um cenario cuja tela
  # ficou inalcancavel (ex.: produto virou `oculto: true` no NAV) morre num
  # timeout mudo que parece falha de captura — foi o que mascarou este bug.
  try {
    Invoke-AgentBrowser @("wait", "--text", $definition.ReadyText)
  } catch {
    $atual = Get-AgentBrowserSnapshot
    throw @"
Cenario '$Scenario': o login passou, mas a tela nao ficou pronta — o texto de
prontidao '$($definition.ReadyText)' nunca apareceu.
Isto NAO e falha de captura. Causas tipicas, nesta ordem:
  1. a tela do cenario ficou inalcancavel pela UI (produto `oculto: true` em
     src/lib/navegacao.ts sai do sidebar E do "Ir para" do Navigator);
  2. os passos de navegacao do cenario envelheceram (mapa `$scenarios`);
  3. o texto de prontidao mudou de copy (src/lib/strings.ts).
Tela atual:
$($atual.data.snapshot)
"@
  }

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
