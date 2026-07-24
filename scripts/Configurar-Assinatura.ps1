<#
.SYNOPSIS
    Configura a chave de assinatura do atualizador do GALAXIE Toolbox.

.DESCRIPTION
    Gera o par de chaves com senha, grava a chave publica no tauri.conf.json,
    guarda a chave privada onde voce escolher, publica os segredos no GitHub e
    commita a mudanca. Cada etapa pergunta antes de agir.

    A SENHA nunca passa por parametro de linha de comando (apareceria na lista
    de processos) nem fica no historico: quem pede a senha e o proprio CLI do
    Tauri, e depois o script pede de novo, sem eco, so para publicar o segredo.

.NOTES
    Rode a partir da raiz do repositorio ou de qualquer lugar - o script se
    localiza sozinho.
#>

[CmdletBinding()]
param(
    [string] $Repositorio = "galaxie-works/galaxie-toolbox"
)

$ErrorActionPreference = "Stop"

# --- aparencia -------------------------------------------------------------
function Titulo($t) {
    Write-Host ""
    Write-Host "  $t" -ForegroundColor Magenta
    Write-Host "  $('-' * $t.Length)" -ForegroundColor DarkGray
}
function Ok($t)     { Write-Host "  [ok] $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Erro($t)   { Write-Host "  [x]  $t" -ForegroundColor Red }
function Nota($t)   { Write-Host "       $t" -ForegroundColor DarkGray }

function Confirmar($pergunta) {
    $r = Read-Host "  $pergunta [s/N]"
    return ($r -eq "s" -or $r -eq "S")
}

# Read-Host devolve o texto cru: quem cola um caminho do Explorer traz as aspas
# junto, e ai o PowerShell tenta usar `"G` como nome de unidade.
function LimparCaminho($texto) {
    if ($null -eq $texto) { return "" }
    $t = $texto.Trim()
    if ($t.Length -ge 2) {
        if (($t[0] -eq '"' -and $t[-1] -eq '"') -or ($t[0] -eq "'" -and $t[-1] -eq "'")) {
            $t = $t.Substring(1, $t.Length - 2)
        }
    }
    return $t.Trim()
}

Write-Host ""
Write-Host "  GALAXIE Toolbox - assinatura do atualizador" -ForegroundColor White

# --- 0. onde estamos -------------------------------------------------------
$raiz = Split-Path -Parent $PSScriptRoot
$conf = Join-Path $raiz "src-tauri\tauri.conf.json"

if (-not (Test-Path $conf)) {
    Erro "Nao achei src-tauri\tauri.conf.json a partir de $raiz"
    Nota "Coloque este script em <repo>\scripts\ e rode de novo."
    exit 1
}
Ok "Repositorio local: $raiz"

# --- 1. pre-requisitos -----------------------------------------------------
Titulo "1. Pre-requisitos"

$temGh = $null -ne (Get-Command gh -ErrorAction SilentlyContinue)
if ($temGh) {
    Ok "GitHub CLI encontrado"
} else {
    Aviso "GitHub CLI (gh) nao encontrado - a etapa dos segredos sera pulada"
    Nota "Instale com: winget install GitHub.cli"
}

if ($temGh) {
    gh auth status 2>&1 | Out-Null
    if ($?) {
        Ok "GitHub CLI autenticado"
    } else {
        Aviso "GitHub CLI nao autenticado - rode: gh auth login"
        $temGh = $false
    }
}

# --- 2. onde guardar a chave privada ---------------------------------------
Titulo "2. Chave privada"

Write-Host "  A chave privada assina cada atualizacao. Se ela sumir, nenhuma"
Write-Host "  versao futura consegue se assinar como sucessora, e quem ja"
Write-Host "  instalou fica preso na versao atual. Nao existe recuperacao."
Write-Host ""

$padrao = Join-Path $HOME ".galaxie\galaxie-updater.key"
Nota "Pode colar o caminho com ou sem aspas."
$destino = LimparCaminho (Read-Host "  Onde salvar? (Enter para $padrao)")
if ([string]::IsNullOrWhiteSpace($destino)) { $destino = $padrao }

$pasta = Split-Path -Parent $destino
if ([string]::IsNullOrWhiteSpace($pasta)) {
    Erro "Informe o caminho completo do arquivo, incluindo a pasta."
    exit 1
}

# A unidade tem que existir: em caminho de rede ou OneDrive nao montado, o
# New-Item falharia com uma mensagem bem menos clara do que esta.
$unidade = Split-Path -Qualifier $pasta -ErrorAction SilentlyContinue
if ($unidade -and -not (Test-Path "$unidade\")) {
    Erro "A unidade $unidade nao existe ou nao esta acessivel."
    Nota "Caminho recebido: $destino"
    exit 1
}

if (-not (Test-Path $pasta)) {
    try {
        New-Item -ItemType Directory -Force -Path $pasta -ErrorAction Stop | Out-Null
        Ok "Pasta criada: $pasta"
    } catch {
        Erro "Nao consegui criar a pasta: $pasta"
        Nota $_.Exception.Message
        exit 1
    }
} else {
    Ok "Pasta: $pasta"
}

# Pasta sincronizada guarda a chave na nuvem e em toda maquina que sincroniza.
# Com senha esta defensavel, mas vale saber.
if ($pasta -match "OneDrive|Dropbox|Google Drive") {
    Aviso "Essa pasta e sincronizada: a chave sera replicada para a nuvem"
    Nota "Com senha forte esta aceitavel, mas o gerenciador de senhas e melhor."
}

if (Test-Path $destino) {
    Aviso "Ja existe uma chave em $destino"
    if (-not (Confirmar "Sobrescrever? Isso invalida atualizacoes ja publicadas")) {
        Nota "Mantendo a chave existente."
        $gerar = $false
    } else {
        $gerar = $true
    }
} else {
    $gerar = $true
}

# --- 3. gerar --------------------------------------------------------------
if ($gerar) {
    Titulo "3. Gerando o par de chaves"
    Write-Host "  O Tauri vai pedir uma SENHA duas vezes. Escolha uma senha forte"
    Write-Host "  e guarde junto com a chave - as duas sao necessarias para assinar."
    Write-Host ""

    Push-Location $raiz
    try {
        pnpm tauri signer generate -w $destino -f
        if (-not $?) { throw "o gerador retornou erro" }
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $destino)) { Erro "A chave nao foi criada."; exit 1 }
    Ok "Chave privada: $destino"
    Ok "Chave publica: $destino.pub"
} else {
    Titulo "3. Gerando o par de chaves"
    Nota "Pulado."
}

# --- 4. chave publica no tauri.conf.json -----------------------------------
Titulo "4. Chave publica no aplicativo"

$arquivoPub = "$destino.pub"
if (-not (Test-Path $arquivoPub)) {
    Erro "Nao achei $arquivoPub"
    exit 1
}

# O arquivo .pub JA vem em base64 (e o texto minisign codificado). Usar como
# esta: codificar de novo geraria uma chave que o app rejeita silenciosamente,
# e o sintoma seria "nunca encontra atualizacao", dificil de rastrear.
$publica = (Get-Content $arquivoPub -Raw).Trim()

if ($publica -notmatch '^[A-Za-z0-9+/=]+$') {
    Erro "O conteudo de $arquivoPub nao parece base64. Abortando para nao gravar chave invalida."
    exit 1
}

# Substituicao cirurgica: reescrever o JSON inteiro no PowerShell 5.1 mexeria
# na formatacao e escaparia os acentos do arquivo todo.
$json = Get-Content $conf -Raw
$novo = [Regex]::Replace($json, '("pubkey"\s*:\s*")[^"]*(")', "`${1}$publica`${2}")

if ($novo -eq $json) {
    Aviso "A chave publica no tauri.conf.json ja era essa (ou o campo nao existe)"
} else {
    # -Encoding utf8 no PowerShell 5.1 grava COM BOM, e o BOM quebra parsers
    # que leem o JSON como UTF-8 puro. WriteAllText com UTF8Encoding($false)
    # grava sem BOM em qualquer versao.
    [System.IO.File]::WriteAllText($conf, $novo, (New-Object System.Text.UTF8Encoding $false))
    Ok "tauri.conf.json atualizado"
}

# --- 5. segredos no GitHub -------------------------------------------------
Titulo "5. Segredos no GitHub ($Repositorio)"

if (-not $temGh) {
    Nota "Pulado: GitHub CLI indisponivel."
} elseif (-not (Confirmar "Publicar a chave e a senha como segredos do repositorio?")) {
    Nota "Pulado a pedido."
} else {
    Get-Content $destino -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo $Repositorio
    if ($?) { Ok "TAURI_SIGNING_PRIVATE_KEY publicado" } else { Erro "Falhou ao publicar a chave" }

    Write-Host ""
    Write-Host "  Digite a MESMA senha que voce informou ao Tauri (nao aparece na tela)."
    $senhaSegura = Read-Host "  Senha" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaSegura)
    try {
        $senha = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        # Por stdin, e nao por --body: parametro apareceria na lista de processos.
        $senha | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo $Repositorio
        if ($?) { Ok "TAURI_SIGNING_PRIVATE_KEY_PASSWORD publicado" } else { Erro "Falhou ao publicar a senha" }
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        Remove-Variable senha -ErrorAction SilentlyContinue
    }
}

# --- 6. limpar copias soltas -----------------------------------------------
Titulo "6. Copias soltas da chave"

$suspeitas = @()
$tmp = Join-Path $env:LOCALAPPDATA "Temp\claude"
if (Test-Path $tmp) {
    $suspeitas = Get-ChildItem -Path $tmp -Filter "*updater*.key*" -Recurse -File -ErrorAction SilentlyContinue
}

if ($suspeitas.Count -eq 0) {
    Ok "Nenhuma copia em pasta temporaria"
} else {
    Aviso "Encontrei $($suspeitas.Count) arquivo(s) de chave em pasta temporaria:"
    $suspeitas | ForEach-Object { Nota $_.FullName }
    if (Confirmar "Apagar essas copias?") {
        $suspeitas | Remove-Item -Force -Confirm:$false
        Ok "Copias apagadas"
    } else {
        Aviso "Deixadas no lugar - lembre de apagar depois"
    }
}

# --- 7. commit -------------------------------------------------------------
Titulo "7. Git"

Push-Location $raiz
try {
    $sujo = git status --porcelain src-tauri/tauri.conf.json
    if ([string]::IsNullOrWhiteSpace($sujo)) {
        Nota "Nada a commitar em tauri.conf.json."
    } else {
        git --no-pager diff --stat src-tauri/tauri.conf.json
        Write-Host ""
        if (Confirmar "Commitar e enviar a nova chave publica?") {
            git add src-tauri/tauri.conf.json
            git commit -m "chore: chave publica do atualizador"
            if ($?) {
                git push
                if ($?) { Ok "Enviado" } else { Erro "git push falhou" }
            }
        } else {
            Nota "Commit nao feito - a mudanca continua no seu diretorio."
        }
    }
} finally {
    Pop-Location
}

# --- fim -------------------------------------------------------------------
Titulo "Falta voce fazer"
Write-Host "  1. Guardar $destino no gerenciador de senhas," -ForegroundColor White
Write-Host "     junto com a senha. Esse e o backup mestre." -ForegroundColor White
Write-Host "  2. Reconstruir o aplicativo: a chave publica mudou." -ForegroundColor White
Write-Host ""
