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

.EXAMPLE
  pwsh scripts/board.ps1 -Coluna "In review"
.EXAMPLE
  pwsh scripts/board.ps1            # contagem por coluna
.EXAMPLE
  pwsh scripts/board.ps1 -Epico 682 -Json
#>
[CmdletBinding()]
param(
  [string]$Coluna,
  [int]$Epico,
  [switch]$Json,
  [switch]$Fresh
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

# --- Saída ---------------------------------------------------------------------
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
