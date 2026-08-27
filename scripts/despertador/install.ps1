# GALAXIE Despertador — instalador (DR / maquina nova)
# Recria a metade-gratis do Despertador a partir do repo. Rodar como o USUARIO que opera o time
# (DPAPI do cofre e por-usuario; a task DEVE rodar como esse usuario — como SYSTEM o cofre nao abre).
$ErrorActionPreference = "Stop"
$dest = "G:\galaxie_development\despertador"

# 1. estrutura
foreach($d in @($dest, "$dest\inbox", "$dest\entregues")){ New-Item -ItemType Directory -Force -Path $d | Out-Null }

# 2. poller (copiado do repo — fonte de verdade)
Copy-Item (Join-Path $PSScriptRoot "poller.ps1") (Join-Path $dest "poller.ps1") -Force
Copy-Item (Join-Path $PSScriptRoot "BOOT-PORTEIRO.md") (Join-Path $dest "BOOT-PORTEIRO.md") -Force

# 3. sessoes.json (mapa papel -> session_id ccd) — TEMPLATE se nao existir; preencher com os ids REAIS
$sess = Join-Path $dest "sessoes.json"
if (-not (Test-Path $sess)) {
  $tpl = [ordered]@{ "_instrucoes" = "Preencher com session_id ccd de CADA papel (list_sessions). Atualizar A CADA reciclagem (canon 7)." }
  foreach($p in @("polaris","mira","altair","castor","pollux","mizar","alcor","lumen","iris","atlas","hiparco")){ $tpl[$p] = "" }
  $tpl | ConvertTo-Json | Set-Content -Path $sess -Encoding UTF8
  Write-Host "sessoes.json criado como TEMPLATE - preencher os ids." -ForegroundColor Yellow
}

# 4. task agendada (5 em 5 min, usuario atual)
schtasks /Create /TN "GALAXIE-Despertador" /TR "pwsh -NoProfile -ExecutionPolicy Bypass -File $dest\poller.ps1" /SC MINUTE /MO 5 /F | Out-Null
Write-Host "Task 'GALAXIE-Despertador' registrada (5 min)." -ForegroundColor Green

# 5. checklist do que o script NAO consegue fazer (maquina nova = cofre morto)
Write-Host @"

=== FALTA FAZER NA MAO (DPAPI nao sobrevive a formatacao) ===
1. COFRE: emitir PAT novo em cada conta galaxie-<papel> (escopos: repo + notifications + workflow)
   e gravar rodando  scripts\galaxie-pat.ps1  SEM argumentos: abre o loop interativo
   que pede o PAT de cada papel (cola+Enter; Enter vazio pula). Com -Name o script LE, nao grava.
2. PORTEIRO: abrir sessao 'Porteiro' (Haiku 4.5, cwd = repo) e colar BOOT-PORTEIRO.md
3. sessoes.json: preencher com os session_id ccd atuais (list_sessions)
4. PROTOCOLO DE AMANHECER: apos qualquer reboot/fechar o app, dar um toque no Porteiro
   (o ScheduleWakeup e session-only e morre com o app)
"@ -ForegroundColor Cyan
