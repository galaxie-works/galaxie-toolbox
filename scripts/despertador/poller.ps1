# GALAXIE Despertador — metade gratis (zero tokens)
# Roda via Task Scheduler a cada 5 min. Consulta notificacoes GitHub de cada conta-papel
# e escreve payloads novos em inbox\<papel>.json para o Porteiro (sessao Haiku) despachar.
$ErrorActionPreference = "Stop"
$base   = $PSScriptRoot
$inbox  = Join-Path $base "inbox"
$stateF = Join-Path $base "state.json"
$tokF   = Join-Path $base "tokens.json"
$logF   = Join-Path $base "poller.log"
New-Item -ItemType Directory -Force -Path $inbox | Out-Null

function Log($m){ Add-Content -Path $logF -Value ("{0:u} {1}" -f (Get-Date).ToUniversalTime(), $m) }

# PATs vem do COFRE DPAPI (nunca de arquivo em texto plano).
# Interface oficial: scripts/galaxie-pat.ps1 -Name <papel> (repo); fallback C:\tmp enquanto a PR #1645 nao landa.
$patScript = @("G:\galaxie_development\galaxie-toolbox\scripts\galaxie-pat.ps1", "C:\tmp\galaxie-pat.ps1") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $patScript) { Log "ERRO: galaxie-pat.ps1 nao encontrado (repo/scripts nem C:\tmp)"; exit 1 }
$papeis = @("polaris","mira","altair","castor","pollux","mizar","alcor","lumen","iris","atlas","hiparco")
$state  = if (Test-Path $stateF) { Get-Content $stateF -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }

foreach ($papel in $papeis) {
  $tok = $null
  try { $tok = & $patScript -Name $papel 2>$null } catch { }
  if (-not $tok) { Log "AVISO ${papel}: sem PAT no cofre"; continue }
  $st = $state.PSObject.Properties[$papel]?.Value
  $lastMod = $st?.lastModified
  $headers = @{ Authorization = "Bearer $tok"; Accept = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2022-11-28" }
  if ($lastMod) { $headers["If-Modified-Since"] = $lastMod }
  try {
    $resp = Invoke-WebRequest -Uri "https://api.github.com/notifications?per_page=30" -Headers $headers -UseBasicParsing
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 304) { continue }                    # nada novo — de graca
    Log "AVISO ${papel}: HTTP $code"; continue
  }
  $items = $resp.Content | ConvertFrom-Json
  $seen  = @($st?.seenIds)
  $novos = @($items | Where-Object { $_.unread -and ($_.id -notin $seen) })
  if ($novos.Count -gt 0) {
    $payload = $novos | ForEach-Object {
      # url de API -> url humana aproximada (issues/pulls)
      $hurl = $_.subject.url -replace 'api\.github\.com/repos','github.com' -replace '/pulls/','/pull/'
      [pscustomobject]@{ id=$_.id; motivo=$_.reason; tipo=$_.subject.type; titulo=$_.subject.title; url=$hurl; repo=$_.repository.full_name; quando=$_.updated_at }
    }
    $out = Join-Path $inbox "$papel.json"
    $existing = if (Test-Path $out) { @((Get-Content $out -Raw | ConvertFrom-Json)) } else { @() }
    ($existing + $payload) | ConvertTo-Json -Depth 4 | Set-Content -Path $out -Encoding UTF8
    Log "$papel : +$($novos.Count) notificacao(oes)"
  }
  # atualiza estado (lastModified do servidor + ids vistos, janela de 200)
  $newSeen = @($seen + @($items | ForEach-Object { $_.id })) | Select-Object -Unique | Select-Object -Last 200
  $lm = $resp.Headers["Last-Modified"]; if ($lm -is [array]) { $lm = $lm[0] }
  $entry = [pscustomobject]@{ lastModified = $lm; seenIds = $newSeen }
  if ($state.PSObject.Properties[$papel]) { $state.$papel = $entry } else { $state | Add-Member -NotePropertyName $papel -NotePropertyValue $entry }
}
$state | ConvertTo-Json -Depth 4 | Set-Content -Path $stateF -Encoding UTF8
