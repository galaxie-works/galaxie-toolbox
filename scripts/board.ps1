<#
.SYNOPSIS
  Consulta o board (GitHub Projects v2) do GALAXIE por COLUNA em um comando.

.DESCRIPTION
  #1327 — o Projects v2 não filtra por coluna via API: todo sweep pagina o
  project inteiro. Este script faz essa paginação UMA vez (cursor), guarda em
  cache curto e serve a coluna pedida — o sweep vira 1 comando e a leitura é
  fresca no momento da escrita.

  Pré-requisito: `gh` autenticado (`$env:GH_TOKEN` ou `gh auth login`).

.PARAMETER Coluna
  Nome exato da coluna (Status): Backlog · Ready · In progress · In review ·
  Rejected · QA Approved · PO Approved · Done · Released to Production.
  Omitido = contagem por coluna (saúde do board).

.PARAMETER Epico
  Número de uma issue-épico: lista as sub-issues (GitHub sub-issues, NUNCA regex
  no corpo — canon v1.11) com a coluna de cada uma e o % Released.

.PARAMETER Json
  Emite JSON em vez de tabela.

.PARAMETER Fresh
  Ignora o cache e refaz a query.

.PARAMETER Inconsistentes
  #1464 — modo de RECONCILIAÇÃO (consumido pela Groomer na saúde ~2×/dia): lista os
  cards onde a issue está CLOSED mas a coluna NÃO é terminal, classificando cada um em
  "ficou pra tras (orfao)" (Backlog/Ready/In progress/In review) ou "a frente (fechado
  sem/antes do gate)" (Done/QA Approved/PO Approved/Rejected). SÓ lista — não move nada
  (mover é do dono; canon §2). Reaproveita a paginação do board (nenhuma query nova).

.PARAMETER FixtureFile
  #1464 — hook de TESTE: caminho de um JSON de itens (mesmo shape do Get-BoardItems) que
  substitui a query real no modo -Inconsistentes. Permite testar a classificação offline
  (sem gh/rede). Uso interno do board.Tests.ps1.

.EXAMPLE
  pwsh scripts/board.ps1 -Coluna "In review"
.EXAMPLE
  pwsh scripts/board.ps1            # contagem por coluna
.EXAMPLE
  pwsh scripts/board.ps1 -Epico 682 -Json
.EXAMPLE
  pwsh scripts/board.ps1 -Inconsistentes    # rede de reconciliação da Groomer
#>
[CmdletBinding()]
param(
  [string]$Coluna,
  [int]$Epico,
  [switch]$Json,
  [switch]$Fresh,
  [switch]$Inconsistentes,
  [string]$FixtureFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectId = 'PVT_kwHOD_4JN84BedaN'   # users/galaxie-works/projects/3
$Owner = 'galaxie-works'
$Repo = 'galaxie-toolbox'
$CacheFile = Join-Path ([System.IO.Path]::GetTempPath()) 'galaxie-board.json'
$CacheMaxAgeSec = 180

$gh = (Get-Command gh -ErrorAction SilentlyContinue)
if (-not $gh) { throw 'gh não encontrado no PATH.' }

function Invoke-GhGraphQL {
  param([string]$Query, [hashtable]$Vars = @{})
  $args = @('api', 'graphql', '-f', "query=$Query")
  foreach ($k in $Vars.Keys) { $args += @('-F', "$k=$($Vars[$k])") }
  $out = & gh @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "gh graphql falhou: $out" }
  return ($out | ConvertFrom-Json)
}

# --- Todos os itens do board (paginado por cursor), com cache curto ------------
function Get-BoardItems {
  if (-not $Fresh -and (Test-Path $CacheFile)) {
    $age = (New-TimeSpan -Start (Get-Item $CacheFile).LastWriteTimeUtc -End ([DateTime]::UtcNow)).TotalSeconds
    if ($age -lt $CacheMaxAgeSec) {
      return (Get-Content -Raw -LiteralPath $CacheFile | ConvertFrom-Json)
    }
  }
  $query = @'
query($project: ID!, $cursor: String) {
  node(id: $project) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          status: fieldValueByName(name: "Status")   { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          size:   fieldValueByName(name: "Size")      { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          prio:   fieldValueByName(name: "Priority")  { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            __typename
            ... on Issue {
              number title state url updatedAt
              labels(first: 20) { nodes { name } }
            }
            ... on PullRequest { number title state url updatedAt }
          }
        }
      }
    }
  }
}
'@
  $items = [System.Collections.Generic.List[object]]::new()
  $cursor = $null
  do {
    $vars = @{ project = $ProjectId }
    if ($cursor) { $vars['cursor'] = $cursor }
    $page = Invoke-GhGraphQL -Query $query -Vars $vars
    $conn = $page.data.node.items
    foreach ($n in $conn.nodes) {
      $c = $n.content
      if (-not $c -or -not $c.number) { continue }   # item sem issue/PR (draft) — ignora
      $labels = @()
      if ($c.PSObject.Properties.Name -contains 'labels' -and $c.labels) {
        $labels = @($c.labels.nodes | ForEach-Object { $_.name })
      }
      $items.Add([pscustomobject]@{
        Numero    = $c.number
        Titulo    = $c.title
        Tipo      = $c.__typename
        Estado    = $c.state
        Coluna    = if ($n.status) { $n.status.name } else { '—' }
        Size      = if ($n.size)   { $n.size.name }   else { '' }
        Prio      = if ($n.prio)   { $n.prio.name }   else { '' }
        Labels    = ($labels -join ',')
        AtualizadoUtc = $c.updatedAt
        Url       = $c.url
      })
    }
    $cursor = if ($conn.pageInfo.hasNextPage) { $conn.pageInfo.endCursor } else { $null }
  } while ($cursor)

  # persiste o cache (best-effort)
  try { $items | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $CacheFile -Encoding UTF8 } catch {}
  return $items
}

# --- Sub-issues de um épico (GitHub sub-issues, nunca regex no corpo) ----------
function Get-EpicoSubIssues {
  param([int]$Numero)
  $query = @'
query($owner: String!, $repo: String!, $num: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    issue(number: $num) {
      title
      subIssues(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title state url
          projectItems(first: 3) {
            nodes { status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } }
          }
        }
      }
    }
  }
}
'@
  $subs = [System.Collections.Generic.List[object]]::new()
  $cursor = $null
  do {
    $vars = @{ owner = $Owner; repo = $Repo; num = $Numero }
    if ($cursor) { $vars['cursor'] = $cursor }
    $page = Invoke-GhGraphQL -Query $query -Vars $vars
    $conn = $page.data.repository.issue.subIssues
    foreach ($s in $conn.nodes) {
      $col = '—'
      if ($s.projectItems.nodes.Count -gt 0 -and $s.projectItems.nodes[0].status) {
        $col = $s.projectItems.nodes[0].status.name
      }
      $subs.Add([pscustomobject]@{
        Numero = $s.number; Titulo = $s.title; Estado = $s.state; Coluna = $col; Url = $s.url
      })
    }
    $cursor = if ($conn.pageInfo.hasNextPage) { $conn.pageInfo.endCursor } else { $null }
  } while ($cursor)
  return $subs
}

# --- #1464: reconciliação (issue CLOSED × coluna ativa) ------------------------
# Predicado por ESTADO×COLUNA (não por "veio de Closes") — pega tanto o auto-close no
# merge quanto o close explícito sem commit (o @Altair mediu os dois). Função pura:
# recebe os itens (do board ou de um fixture) e devolve os inconsistentes, classificados.
# Nenhuma coluna fica indefinida (fecha o vão apontado pelo @Altair) — o que não é
# terminal nem cai nas duas classes conhecidas vira "sem coluna/desconhecida".
function Select-Inconsistentes {
  param([object[]]$Items)
  # As colunas terminais do board. Hoje só existe "Released to Production" (medi as 9
  # opções de Status); "Closed - sem entrega" entra por fidelidade ao predicado do card
  # e à prova de futuro — simplesmente nunca casa enquanto a coluna não existir.
  $terminais = @('Released to Production', 'Closed - sem entrega')
  $atras  = @('Backlog', 'Ready', 'In progress', 'In review')
  $frente = @('Done', 'QA Approved', 'PO Approved', 'Rejected')
  $out = [System.Collections.Generic.List[object]]::new()
  foreach ($it in $Items) {
    if ($it.Estado -ne 'CLOSED') { continue }        # OPEN em qualquer coluna: consistente (AC3)
    if ($terminais -contains $it.Coluna) { continue } # CLOSED terminal: consistente (AC3)
    $classe =
      if     ($atras  -contains $it.Coluna) { 'ficou pra tras (orfao)' }          # AC1
      elseif ($frente -contains $it.Coluna) { 'a frente (fechado sem/antes do gate)' } # AC2
      else                                  { 'sem coluna/desconhecida' }
    $out.Add([pscustomobject]@{
      Numero = $it.Numero
      Coluna = $it.Coluna
      Estado = $it.Estado
      Classe = $classe
      Titulo = $it.Titulo
      Url    = $it.Url
    })
  }
  return $out
}

# --- Saída ---------------------------------------------------------------------
if ($Inconsistentes) {
  # FixtureFile (teste) substitui a query real; senão reaproveita a paginação do board.
  $fonte = if ($FixtureFile) { @(Get-Content -Raw -LiteralPath $FixtureFile | ConvertFrom-Json) }
           else              { Get-BoardItems }
  $inc = Select-Inconsistentes -Items $fonte
  if ($Json) { $inc | ConvertTo-Json -Depth 5; return }
  if ($inc.Count -eq 0) {
    Write-Host "Reconciliacao: 0 cards inconsistentes (issue CLOSED x coluna ativa)." -ForegroundColor Green
    return
  }
  Write-Host "Reconciliacao: $($inc.Count) card(s) inconsistente(s) — issue CLOSED x coluna ativa:"
  $inc | Sort-Object Classe, Numero | Format-Table Numero, Coluna, Estado, Classe, Titulo -AutoSize
  return
}

if ($Epico) {
  $subs = Get-EpicoSubIssues -Numero $Epico
  if ($Json) { $subs | ConvertTo-Json -Depth 5; return }
  $total = $subs.Count
  $released = @($subs | Where-Object { $_.Coluna -eq 'Released to Production' }).Count
  $pct = if ($total) { [math]::Round(100.0 * $released / $total) } else { 0 }
  Write-Host "Épico #$Epico — $released/$total Released ($pct%)"
  $subs | Sort-Object Coluna | Format-Table Numero, Coluna, Estado, Titulo -AutoSize
  return
}

$items = Get-BoardItems

if (-not $Coluna) {
  # visão de saúde: contagem por coluna
  $counts = $items | Group-Object Coluna | Sort-Object Count -Descending |
    ForEach-Object { [pscustomobject]@{ Coluna = $_.Name; Cards = $_.Count } }
  if ($Json) { $counts | ConvertTo-Json; return }
  $counts | Format-Table -AutoSize
  Write-Host "Total: $($items.Count) cards · cache $CacheFile"
  return
}

$daColuna = @($items | Where-Object { $_.Coluna -eq $Coluna } |
  Sort-Object { [datetime]$_.AtualizadoUtc } -Descending)
if ($Json) { $daColuna | ConvertTo-Json -Depth 5; return }
if ($daColuna.Count -eq 0) {
  Write-Host "Coluna '$Coluna' — 0 cards (ou nome de coluna inválido)."
  return
}
$daColuna | Format-Table Numero, Prio, Size, Estado, Labels, Titulo -AutoSize
Write-Host "$($daColuna.Count) cards em '$Coluna' · por updatedAt desc · cache $CacheFile"
