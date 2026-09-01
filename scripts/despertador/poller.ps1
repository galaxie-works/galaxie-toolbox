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
  # acesso por PONTO: a forma $state.PSObject.Properties[$papel]?.Value devolve NULL neste pwsh
  # (bug medido 27/08: seen chegava vazio toda rodada -> dedup nunca filtrava -> lotes duplicados)
  $st = $state.$papel
  $lastMod = if ($st) { $st.lastModified } else { $null }
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
  $seen  = @(); if ($st -and $st.seenIds) { $seen = @($st.seenIds) }
  # chave de dedup = id:updated_at — o id da thread e o MESMO pra sempre por issue, entao
  # dedup por id puro deixa o papel SURDO a mencoes novas na mesma issue (bug medido 27/08:
  # 2 comentarios do PO na #1636 mencionando 5 papeis, so o 1o-da-thread foi entregue)
  $novos = @($items | Where-Object { $_.unread -and (("{0}:{1}" -f $_.id, $_.updated_at) -notin $seen) })
  if ($novos.Count -gt 0) {
    $payload = $novos | ForEach-Object {
      # url de API -> url humana aproximada (issues/pulls)
      $hurl = $_.subject.url -replace 'api\.github\.com/repos','github.com' -replace '/pulls/','/pull/'
      [pscustomobject]@{ id=$_.id; motivo=$_.reason; tipo=$_.subject.type; titulo=$_.subject.title; url=$hurl; repo=$_.repository.full_name; quando=$_.updated_at }
    }
    # lote IMUTAVEL por rodada (papel_<carimboUTC>.json): nunca anexa a arquivo existente.
    # Escreve em .tmp e renomeia — o consumidor (Porteiro) so ve arquivos completos e
    # nunca ha leitura/escrita concorrente no MESMO arquivo (fix do review P2, PR #1650).
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssfff")
    $out = Join-Path $inbox ("{0}_{1}.json" -f $papel, $stamp)
    ,@($payload) | ConvertTo-Json -Depth 4 | Set-Content -Path "$out.tmp" -Encoding UTF8
    Move-Item -Path "$out.tmp" -Destination $out -Force
    Log "$papel : +$($novos.Count) notificacao(oes) -> $(Split-Path $out -Leaf)"
    # cinto-e-suspensorio: marca a thread como LIDA no servidor apos lotear —
    # mesmo que o state.json se perca, o GitHub para de devolver o item (dedup na fonte)
    foreach($nv in $novos){
      try { Invoke-WebRequest -Method Patch -Uri "https://api.github.com/notifications/threads/$($nv.id)" -Headers $headers -UseBasicParsing | Out-Null }
      catch { Log "AVISO ${papel}: falha ao marcar lida thread $($nv.id)" }
    }
  }
  # atualiza estado (lastModified do servidor + ids vistos, janela de 200)
  $newSeen = @($seen + @($items | ForEach-Object { "{0}:{1}" -f $_.id, $_.updated_at })) | Select-Object -Unique | Select-Object -Last 200
  $lm = $resp.Headers["Last-Modified"]; if ($lm -is [array]) { $lm = $lm[0] }
  $entry = [pscustomobject]@{ lastModified = $lm; seenIds = $newSeen }
  if ($state.PSObject.Properties[$papel]) { $state.$papel = $entry } else { $state | Add-Member -NotePropertyName $papel -NotePropertyValue $entry }
}
# --- WATCHDOG DO PORTEIRO: lote na inbox ha >45 min = o Porteiro esta morto (o ScheduleWakeup
# dele morre com restart do app, e ninguem ve — medido 01/09: 4h mudo, 16 lotes represados).
# Alarme = comentario no #1606 mencionando o PO (notificacao nativa no celular dele), 1x por incidente:
# a chave do dedup e o NOME do lote mais velho (some da inbox = incidente encerrado, flag limpa).
try {
  $velho = Get-ChildItem $inbox -File -EA SilentlyContinue | Sort-Object LastWriteTime | Select-Object -First 1
  if ($velho -and ((Get-Date) - $velho.LastWriteTime).TotalMinutes -gt 45) {
    if ($state._alarmePorteiro -ne $velho.Name) {
      $tokA = & $patScript -Name polaris 2>$null
      if ($tokA) {
        $nLotes = (Get-ChildItem $inbox -File).Count
        $idadeMin = [int]((Get-Date) - $velho.LastWriteTime).TotalMinutes
        $corpo = "⏰ **[Despertador/watchdog] PORTEIRO MUDO** — lote mais velho na inbox há ${idadeMin} min ($nLotes lote(s) represados). @galaxie-works: cutuca a sessão do Porteiro (Acorda, não dorme em serviço) ou recicla-a. Alarme automático do poller; 1x por incidente."
        $hA = @{ Authorization = "Bearer $tokA"; Accept = "application/vnd.github+json" }
        Invoke-WebRequest -Method Post -Uri "https://api.github.com/repos/galaxie-works/galaxie-toolbox/issues/1606/comments" -Headers $hA -Body (@{ body = $corpo } | ConvertTo-Json) -ContentType "application/json" -UseBasicParsing | Out-Null
        Log "WATCHDOG: porteiro mudo ($idadeMin min, $nLotes lotes) — PO alertado no #1606"
      } else { Log "WATCHDOG: porteiro mudo mas sem PAT do polaris pra alertar" }
      if ($state.PSObject.Properties["_alarmePorteiro"]) { $state._alarmePorteiro = $velho.Name } else { $state | Add-Member -NotePropertyName _alarmePorteiro -NotePropertyValue $velho.Name }
    }
  } elseif (-not $velho -and $state.PSObject.Properties["_alarmePorteiro"]) { $state._alarmePorteiro = $null }
} catch { Log "AVISO watchdog: $($_.Exception.Message)" }

# --- VIGIA DE FILA (a cada ~30 min): card Ready ABERTO sem assignee = fila parada.
# A reforma aboliu o "pull" dos devs (crons); notificacao nativa so cobre trabalho ENDERECADO.
# Este bloco fabrica a notificacao que falta: card orfao novo -> lote pro SM (polaris) despachar
# (assign no card notifica o dev nativamente e o circuito renasce). Dedup por card em _fila.
try {
  $agora = (Get-Date).ToUniversalTime()
  # ConvertFrom-Json ja devolve DateTime pra string ISO; re-Parse em culture pt-BR quebra (dia/mes trocados)
  $ultimo = [datetime]::MinValue
  if ($state._filaCheckedAt) {
    if ($state._filaCheckedAt -is [datetime]) { $ultimo = $state._filaCheckedAt.ToUniversalTime() }
    else { $ultimo = [datetime]::Parse([string]$state._filaCheckedAt, [Globalization.CultureInfo]::InvariantCulture, 'AdjustToUniversal') }
  }
  if (($agora - $ultimo).TotalMinutes -ge 25) {
    $tokP = & $patScript -Name polaris 2>$null
    if ($tokP) {
      $gq = 'query($after:String){ user(login:"galaxie-works"){ projectV2(number:3){ items(first:100, after:$after){ pageInfo{hasNextPage endCursor} nodes{ fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } content{ ... on Issue { number title state labels(first:10){nodes{name}} assignees(first:3){nodes{login}} } } } } } } }'
      $hG = @{ Authorization = "Bearer $tokP"; "Content-Type" = "application/json" }
      $after = $null; $orfaos = @(); $wip = @{}
      do {
        $body = @{ query = $gq; variables = @{ after = $after } } | ConvertTo-Json -Depth 4
        $rq = Invoke-WebRequest -Method Post -Uri "https://api.github.com/graphql" -Headers $hG -Body $body -UseBasicParsing
        $rj = ($rq.Content | ConvertFrom-Json).data.user.projectV2.items
        foreach($n in $rj.nodes){
          # so card PUXAVEL: Ready, aberto, sem dono, sem 'bloqueado' e sem 'precisa design' pendente
          # ('precisa design' sem 'design ok' espera o ARQUITETO, nao um dev — furo pego no adversarial
          # da v1.21 pelo Hiparco, 31/08). WIP e checado adiante (saturacao = backpressure, nao fila parada).
          $lbls = @($n.content.labels.nodes.name)
          $aguardaDesign = ($lbls -contains "precisa design") -and ($lbls -notcontains "design ok")
          if ($n.content.number -and $n.fieldValueByName.name -eq "Ready" -and $n.content.state -eq "OPEN" -and -not @($n.content.assignees.nodes).Count -and ($lbls -notcontains "bloqueado") -and -not $aguardaDesign) {
            $orfaos += [pscustomobject]@{ num = $n.content.number; titulo = $n.content.title }
          }
          # censo de WIP: cards In progress por assignee (pro guarda de saturacao e pro snapshot no telegrama)
          if ($n.content.number -and $n.fieldValueByName.name -eq "In progress" -and $n.content.state -eq "OPEN") {
            foreach($a in @($n.content.assignees.nodes.login)){ $wip[$a] = 1 + [int]$wip[$a] }
          }
        }
        $after = $rj.pageInfo.endCursor
      } while ($rj.pageInfo.hasNextPage)
      # guarda de SATURACAO: se TODOS os devs estao em WIP >= 2, a fila esta parada por
      # backpressure saudavel (§2), nao por falta de quem puxe — sinal nenhum (furo 2 do adversarial).
      $devs = @("galaxie-castor","galaxie-pollux","galaxie-mizar","galaxie-alcor")
      $devLivre = @($devs | Where-Object { [int]$wip[$_] -lt 2 }).Count -gt 0
      $wipSnap = ($devs | ForEach-Object { "{0}={1}" -f ($_ -replace 'galaxie-',''), [int]$wip[$_] }) -join " "
      $jaAvisados = @(); if ($state._fila) { $jaAvisados = @($state._fila) }
      $novosOrfaos = @($orfaos | Where-Object { $_.num -notin $jaAvisados })
      if (-not $devLivre -and $novosOrfaos.Count -gt 0) { Log "FILA: $($novosOrfaos.Count) orfao(s) retidos — todos os devs em WIP>=2 ($wipSnap)" }
      if ($devLivre -and $novosOrfaos.Count -gt 0) {
        # destinatario = POLARIS (SM): decreto do PO 31/08 revoga o "nunca despacha card-a-card"
        # da coluna do SM para o caso FILA PARADA — fila sinalizada pelo vigia = SM atribui o dev
        # da raia e move o card. Dev-pull (§2) segue como caminho feliz de dev acordado.
        $payload = $novosOrfaos | ForEach-Object {
          [pscustomobject]@{ id="fila-$($_.num)"; motivo="fila-ready-sem-dono"; tipo="Issue"; titulo="[FILA PARADA] Ready sem dono: $($_.titulo) — DESPACHA: le a issue, atribui (assign) o dev da raia e move (decreto PO 31/08; WIP atual: $wipSnap)"; url="https://github.com/galaxie-works/galaxie-toolbox/issues/$($_.num)"; repo="galaxie-works/galaxie-toolbox"; quando=$agora.ToString("o") }
        }
        $stampF = $agora.ToString("yyyyMMddTHHmmssfff")
        $outF = Join-Path $inbox ("polaris_{0}.json" -f $stampF)
        ,@($payload) | ConvertTo-Json -Depth 4 | Set-Content -Path "$outF.tmp" -Encoding UTF8
        Move-Item -Path "$outF.tmp" -Destination $outF -Force
        Log "FILA: +$($novosOrfaos.Count) card(s) Ready sem dono -> $(Split-Path $outF -Leaf)"
      }
      # _fila: com dev livre = fotografia atual (card que ganhou dono sai; re-alerta se voltar a orfao).
      # Saturado = so INTERSECAO (mantem os ja-avisados ainda orfaos, NAO absorve os retidos — senao
      # eles nunca alertariam quando um dev liberasse)
      $novaFila = if ($devLivre) { @($orfaos | ForEach-Object num) } else { @($jaAvisados | Where-Object { $_ -in @($orfaos | ForEach-Object num) }) }
      if ($state.PSObject.Properties["_fila"]) { $state._fila = $novaFila } else { $state | Add-Member -NotePropertyName _fila -NotePropertyValue $novaFila }
      if ($state.PSObject.Properties["_filaCheckedAt"]) { $state._filaCheckedAt = $agora.ToString("o") } else { $state | Add-Member -NotePropertyName _filaCheckedAt -NotePropertyValue $agora.ToString("o") }
    } else { Log "AVISO fila: sem PAT do polaris no cofre" }
  }
} catch { Log "AVISO fila: $($_.Exception.Message)" }

$state | ConvertTo-Json -Depth 4 | Set-Content -Path $stateF -Encoding UTF8
