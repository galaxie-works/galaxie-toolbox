# galaxie-oauth.ps1 — cofre local dos client_secret do OAuth da plataforma (#1549).
#
#   Sem -Name   -> REGISTRA: pede cada segredo que falta (digitacao OCULTA).
#   Com -Name   -> LE: devolve o segredo daquele provedor (pro env do servico).
#   -Listar     -> mostra QUAIS existem (nunca o valor).
#
# Mesmo padrao do scripts/galaxie-pat.ps1: DPAPI por-utilizador, arquivo .dat
# fora do repo. O cofre NUNCA e versionado; so este script vai pro git.
#
# ⚠️ POR QUE DPAPI E NAO UM .env: o DPAPI cifra com a credencial do utilizador
# Windows logado. Um .env e texto claro — quem ler o disco (backup, sync de
# nuvem, outro utilizador da maquina) le o segredo. Com DPAPI, copiar o .dat
# para outra conta NAO o torna legivel. Ver docs/runbooks/dr-maquina-nova.md.
#
# ⚠️⚠️ ESTE COFRE E DA MAQUINA DO PO — NAO E O CAMINHO DE PRODUCAO.
# (caveat da @Mira no #1549; o furo era meu)
#
# O DPAPI e por-utilizador-e-por-maquina Windows. Os `client_secret` sao
# consumidos pelo `platform-*`, que corre num container LINUX na VPS — o .dat
# copiado para la e lixo. Este script resolve "onde o PO guarda os segredos com
# seguranca" e o dev local; NAO resolve a entrega ao servidor.
#
# Em PRODUCAO segue-se o precedente que ja existe na nossa VPS (medido em
# /docker/galaxie-remote/): segredo em ficheiro modo 0440 + docker `secrets:`,
# e a app recebe o CAMINHO, nunca o valor:
#
#     secrets:
#       oauth_microsoft: { file: ./secrets/oauth_microsoft }
#     environment:
#       GALAXIE_OAUTH_MICROSOFT_SECRET_FILE: /run/secrets/oauth_microsoft
#
# 🔑 O sufixo _FILE nao e cosmetica: o env carrega um CAMINHO, entao o segredo
# NAO aparece num `docker inspect`, num dump de ambiente, nem no ambiente
# herdado por um processo filho. Entrega ate a VPS = raia do Alcor/Atlas.
param(
  [string]$Name,
  [switch]$Listar
)

$ErrorActionPreference = 'Stop'

# Os provedores que precisam de segredo. O `microsoft` cobre TAMBEM o
# `microsoft-personal`: e a MESMA app do Entra, com dois redirect_uri (#1549).
$Provedores = @('microsoft', 'google')

$dir = Join-Path $env:LOCALAPPDATA 'galaxie-oauth'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Caminho([string]$p) { Join-Path $dir "$p.dat" }

# ---- LISTAR (nunca imprime valor) ----
if ($Listar) {
  foreach ($p in $Provedores) {
    $f = Caminho $p
    $existe = Test-Path $f
    $quando = if ($existe) { (Get-Item $f).LastWriteTimeUtc.ToString('yyyy-MM-dd HH:mmZ') } else { '-' }
    '{0,-20} {1,-12} {2}' -f $p, $(if ($existe) { 'registado' } else { 'EM FALTA' }), $quando
  }
  return
}

# ---- LER ----
if ($Name) {
  if ($Provedores -notcontains $Name) {
    throw "provedor '$Name' desconhecido. Esperados: $($Provedores -join ', ')"
  }
  $f = Caminho $Name
  if (-not (Test-Path $f)) {
    throw "segredo de '$Name' nao registado. Corre o script sem -Name primeiro."
  }
  $secure = (Get-Content -Raw $f).Trim() | ConvertTo-SecureString
  return [System.Net.NetworkCredential]::new('', $secure).Password
}

# ---- REGISTRAR ----
# Enter vazio = pula (nao apaga o que ja existe). Substituir exige confirmacao
# explicita: um segredo que funciona nao se perde por engano num re-run.
foreach ($p in $Provedores) {
  $f = Caminho $p
  if (Test-Path $f) {
    $r = Read-Host "[$p] JA existe. Escreve SUBSTITUIR para trocar (Enter pula)"
    if ($r -ne 'SUBSTITUIR') { Write-Host "[$p] mantido."; continue }
  }
  # -AsSecureString: NAO ecoa no ecra nem fica no buffer da consola.
  $secure = Read-Host "[$p] cola o client_secret (fica oculto)" -AsSecureString
  if ($secure.Length -eq 0) { Write-Host "[$p] vazio — pulado."; continue }
  ConvertFrom-SecureString $secure | Set-Content -NoNewline -Encoding ascii $f
  Write-Host "[$p] guardado em $f"
}

Write-Host ''
Write-Host 'Feito. Confere com:  .\scripts\galaxie-oauth.ps1 -Listar'
Write-Host 'Dev local le com:    $env:GALAXIE_OAUTH_MICROSOFT_SECRET = & .\scripts\galaxie-oauth.ps1 -Name microsoft'
Write-Host 'Em PRODUCAO nao e assim: docker secrets + ..._SECRET_FILE (ver o cabecalho deste ficheiro).'
