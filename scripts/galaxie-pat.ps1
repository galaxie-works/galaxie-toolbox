# galaxie-pat.ps1
#   No -Name  -> REGISTER: percorre os papeis e pede o PAT de cada (cola+Enter; Enter vazio = pula).
#   With -Name -> READ: devolve o PAT do papel (para o $env:GH_TOKEN da sessao).
param([string]$Name)

$dir = Join-Path $env:LOCALAPPDATA 'galaxie-pat'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# ---- READ ----
if ($Name) {
  $file = Join-Path $dir "$Name.dat"
  if (-not (Test-Path $file)) { throw "PAT '$Name' nao registado. Corre o script sem -Name primeiro." }
  $secure = (Get-Content -Raw $file).Trim() | ConvertTo-SecureString
  return [System.Net.NetworkCredential]::new('', $secure).Password
}

# ---- REGISTER (loop) ----
$papeis = 'polaris','mira','altair','castor','pollux','mizar','alcor','lumen','iris','atlas','hiparco'

Write-Host ""
Write-Host "== Registro de PATs por papel (cifrado DPAPI - so o teu Windows decifra) ==" -ForegroundColor Cyan
Write-Host "Cola o PAT e Enter. Enter VAZIO = pula esse papel."
Write-Host ""

$feitos = 0
foreach ($p in $papeis) {
  $existe = Test-Path (Join-Path $dir "$p.dat")
  $tag = if ($existe) { " [ja existe - Enter mantem, colar sobrescreve]" } else { "" }
  $secure = Read-Host -Prompt "PAT de '$p'$tag" -AsSecureString
  if ($secure.Length -eq 0) { Write-Host "   ... pulado" -ForegroundColor DarkGray; continue }
  ($secure | ConvertFrom-SecureString) | Set-Content -Path (Join-Path $dir "$p.dat") -NoNewline -Encoding ASCII
  Write-Host "   [OK] $p salvo" -ForegroundColor Green
  $feitos++
}
Write-Host ""
Write-Host "Pronto - $feitos PAT registado(s) em $dir"
Write-Host ""