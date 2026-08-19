<#
  Teste de contrato do board.ps1 (#1327) — SEM dependência de Pester.
  (a máquina do time tem só Pester 3.4; a CI não roda PowerShell — então o teste
   é um script autônomo: sai 0 se passa, 1 se falha, 0+SKIP se gh não autenticado.)

  DoD: `board.ps1 -Coluna X` devolve o MESMO conjunto de issues que a paginação
  manual do Projects v2 filtrada por Status = X.

  Rodar:  pwsh -File scripts/board.Tests.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $PSCommandPath
$board   = Join-Path $here 'board.ps1'
$project = 'PVT_kwHOD_4JN84BedaN'
$fail    = 0

function Assert-Igual {
  param($Esperado, $Obtido, [string]$Nome)
  $e = (@($Esperado) -join ','); $o = (@($Obtido) -join ',')
  if ($e -eq $o) { Write-Host "  PASS  $Nome" -ForegroundColor Green }
  else { Write-Host "  FAIL  $Nome`n        esperado: [$e]`n        obtido:   [$o]" -ForegroundColor Red; $script:fail++ }
}

function Test-GhPronto {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { return $false }
  gh auth status *> $null
  return ($LASTEXITCODE -eq 0)
}

# conjunto de issues numa coluna, pela query manual (fonte de verdade)
function Get-ColunaManual {
  param([string]$Coluna)
  $q = 'query($cursor: String){ node(id:"' + $project + '"){ ... on ProjectV2 { items(first:100, after:$cursor){ pageInfo{hasNextPage endCursor} nodes{ status:fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}} content{ ... on Issue{number} ... on PullRequest{number} } } } } } }'
  $cursor = $null; $hits = @()
  do {
    if ($cursor) { $r = gh api graphql -f query=$q -F cursor=$cursor | ConvertFrom-Json }
    else         { $r = gh api graphql -f query=$q            | ConvertFrom-Json }
    $conn = $r.data.node.items
    foreach ($n in $conn.nodes) {
      if ($n.status -and $n.status.name -eq $Coluna -and $n.content.number) { $hits += $n.content.number }
    }
    $cursor = if ($conn.pageInfo.hasNextPage) { $conn.pageInfo.endCursor } else { $null }
  } while ($cursor)
  return ($hits | Sort-Object -Unique)
}

Write-Host "board.ps1 — teste de contrato"
if (-not (Test-GhPronto)) {
  Write-Host "  SKIP  gh não autenticado (integração precisa da API do board)" -ForegroundColor Yellow
  exit 0
}

# 1) -Coluna == query manual (coluna com carga baixa e estável: In review)
$doScript = & pwsh -NoProfile -File $board -Coluna 'In review' -Json -Fresh |
  ConvertFrom-Json | ForEach-Object { $_.Numero } | Sort-Object -Unique
$manual = Get-ColunaManual -Coluna 'In review'
Assert-Igual $manual $doScript "-Coluna 'In review' == paginação manual"

# 2) coluna inexistente -> zero card
$vazio = & pwsh -NoProfile -File $board -Coluna 'Coluna Que Nao Existe' -Json |
  Where-Object { $_ -match '\S' }
Assert-Igual @() @($vazio) "coluna inexistente devolve zero card"

if ($fail -gt 0) { Write-Host "`n$fail falha(s)." -ForegroundColor Red; exit 1 }
Write-Host "`nOK — contrato verde." -ForegroundColor Green
exit 0
