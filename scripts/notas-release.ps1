#requires -Version 7.0
<#
.SYNOPSIS
    Resolve as notas de uma release a partir do arquivo VERSIONADO do repo.

.DESCRIPTION
    #1270. O `latest.json` (feed do updater) e o corpo da release no repo de
    distribuição têm de sair da MESMA fonte — canon §6.7. Antes, o
    `release.yml` gravava `notes = "GALAXIE <tag>"` (placeholder) e o corpo do
    dist era um texto fixo: toda release nascia sem changelog, e o Deploy
    Manager corrigia o `latest.json` na mão depois (v0.45.1, 18/08).

    Fonte única: `docs/releases/<tag>.md`, commitado JUNTO do bump de versão,
    dentro da tag. Sem o arquivo, este script FALHA — de propósito. Um default
    silencioso é exatamente o defeito que o #1270 fecha: o placeholder passava
    despercebido até um usuário abrir o modal de update e não ver nada.

.PARAMETER Tag
    Tag da release, no formato vX.Y.Z (ex.: v0.46.0).

.PARAMETER Raiz
    Raiz do repositório. Padrão: o diretório-pai de `scripts/`.

.PARAMETER Saida
    Se informado, grava as notas neste arquivo (UTF-8) além de imprimi-las.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Tag,
    [string]$Raiz,
    [string]$Saida
)

$ErrorActionPreference = "Stop"

if (-not $Raiz) { $Raiz = Split-Path -Parent $PSScriptRoot }

# Falha por stderr + exit 1, nao por `throw`: o `throw` do PowerShell embrulha a
# mensagem no formatador de excecao e a multi-linha vira parede. Quem esta
# cortando release le isto no log do Actions -- tem de ser legivel de primeira.
function Parar([string]$mensagem) {
    [Console]::Error.WriteLine($mensagem)
    exit 1
}

if ($Tag -notmatch '^v\d+\.\d+\.\d+') {
    Parar "[release] Tag invalida: '$Tag'. Esperado vX.Y.Z (ex.: v0.46.0)."
}

$relativo = "docs/releases/$Tag.md"
$arquivo = Join-Path $Raiz $relativo

if (-not (Test-Path -LiteralPath $arquivo)) {
    Parar @"
[release] Notas da release NAO encontradas: $relativo

Este job falha AQUI, antes do build, de proposito. O corpo da release e o campo
'notes' do latest.json (o texto que o modal de update mostra ao usuario) saem
DESTE arquivo. Publicar sem ele produziria uma release muda -- foi o que
aconteceu na v0.45.1 e teve de ser corrigido na mao.

Como resolver:
  1. Escreva o changelog em linguagem de usuario:
       git log <tag-anterior>..$Tag --oneline
  2. Salve em $relativo
  3. Commite JUNTO do bump de versao, dentro da tag $Tag
  4. Rode a release de novo

Dono do ritual: Deploy Manager (canon SS6).
"@
}

$texto = (Get-Content -LiteralPath $arquivo -Raw -Encoding utf8).Trim()

if ([string]::IsNullOrWhiteSpace($texto)) {
    Parar @"
[release] Notas da release VAZIAS: $relativo

O arquivo existe mas nao tem conteudo. Um arquivo vazio publicaria uma release
muda do mesmo jeito que o placeholder antigo -- por isso tambem falha.

Escreva o changelog em linguagem de usuario e commite dentro da tag $Tag.
"@
}

if ($Saida) {
    Set-Content -LiteralPath $Saida -Value $texto -Encoding utf8
}

Write-Output $texto
