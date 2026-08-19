#requires -Version 7.0
<#
.SYNOPSIS
    #1326 — o gate de integração inteiro num comando: `pnpm gate`.

.DESCRIPTION
    O rito de integração era uma lista de 6+ comandos guardada na cabeça. O
    resultado previsível está na auditoria (§3.A.1): `test:component` não rodou
    em nenhuma integração FE de um dia inteiro, e um card andou antes do push
    landar. Conserto é ferramenta, não sermão.

    Este script ESPELHA o que o CI cobra na `pre-prod`. Ele não é o gate — o gate
    são os rulesets (`frontend/gate` + `rust` + `clippy`); isto aqui é o espelho
    local, para o vermelho aparecer antes do push, não depois.

    Canais, na ordem, e de onde cada um vem:

      tsc -b          )
      vite build      )  = `pnpm build`, passo do job `frontend / gate`
      lint            )  = `pnpm lint` (oxlint) — idem
      test            )  = `pnpm test` (node --test) — idem
      test:component  )  = idem
      test:browser       roda no CI mas NÃO bloqueia o merge; aqui roda por
                         padrão porque quebrar o browser-mode é caro de achar
                         depois (use -SkipBrowser se estiver com pressa)
      cargo           só se o diff tocar `src-tauri/**` — check + test SEM env
                      de OpenSSL (é assim que se pega vazamento de dependência)
      cargo remote    só se o diff tocar `src-tauri/src/remote*`
      cargo <crate>   só os crates de `services/` que o diff tocou
      clippy          `-D warnings` nos crates que o CI gateia e o diff tocou

    DUAS COISAS QUE O CARD NÃO PEDIU e eu incluí, com motivo:

      • `lint` — está dentro do `pnpm build`/`frontend / gate` do CI. Sem ele o
        espelho mentiria: passaria local e reprovaria no PR.
      • `clippy` — é CHECK OBRIGATÓRIO na `pre-prod`. A #1330 (release travada
        por clippy vermelho) aconteceu exatamente porque o gate local de quem
        entregou (eu) tinha check e test, mas não clippy.

.PARAMETER Only
    Roda só o canal nomeado (ex.: `test:component`). O resumo registra o que foi
    pulado — gate que pula em silêncio é pior que gate nenhum.

.PARAMETER SkipRust
    Pula todos os canais de Rust. Registrado no resumo.

.PARAMETER SkipBrowser
    Pula o `test:browser` (o único que não bloqueia merge no CI).

.PARAMETER Explicar
    Não roda nada: imprime o PLANO (um canal por linha) e sai. É o que os testes
    exercitam — a lógica que pode errar é a de decidir o que roda.

.PARAMETER Base
    Referência para o diff que decide os canais de Rust. Padrão `origin/pre-prod`.

.PARAMETER Arquivos
    Lista de arquivos para o plano, no lugar do diff real. Só para teste.
#>
[CmdletBinding()]
param(
    [string]$Only,
    [switch]$SkipRust,
    [switch]$SkipBrowser,
    [switch]$Explicar,
    [string]$Base = "origin/pre-prod",
    [string[]]$Arquivos
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot

# Crates de services/ que o CI roda `cargo test`.
$CRATES_SERVICES = @(
    "remote-capabilities", "remote-transport", "remote-net",
    "remote-capture", "remote-system-agent", "remote-signaling",
    "remote-broker-client"
)
# Crates que o CI gateia com `clippy -D warnings` (ci.yml, job `clippy`).
# `src-tauri` NAO entra: e divida pre-existente, fora do gate por decisao do
# time — o espelho nao pode ser mais duro que o CI, senao ninguem usa.
$CRATES_CLIPPY = @("remote-signaling", "remote-transport", "remote-capabilities", "remote-broker-client")

<#
.SYNOPSIS
    Decide os canais a partir da lista de arquivos tocados + flags. PURA — é o
    que os testes exercitam.
#>
function Planejar {
    param(
        [string[]]$Tocados,
        [string]$Only,
        [bool]$SemRust,
        [bool]$SemBrowser
    )
    $plano = [System.Collections.Generic.List[hashtable]]::new()

    $add = {
        param($nome, $cmd, $dir)
        $plano.Add(@{ nome = $nome; cmd = $cmd; dir = $dir })
    }

    & $add "tsc" "pnpm exec tsc -b" $null
    & $add "vite build" "pnpm exec vite build" $null
    & $add "lint" "pnpm lint" $null
    & $add "test" "pnpm test" $null
    & $add "test:component" "pnpm test:component" $null
    if (-not $SemBrowser) { & $add "test:browser" "pnpm test:browser" $null }

    if (-not $SemRust) {
        $tocaTauri = $Tocados | Where-Object { $_ -like "src-tauri/*" }
        $tocaRemote = $Tocados | Where-Object { $_ -like "src-tauri/src/remote*" }
        if ($tocaTauri) {
            & $add "cargo check" "cargo check" "src-tauri"
            & $add "cargo test" "cargo test" "src-tauri"
        }
        if ($tocaRemote) {
            & $add "cargo check --features remote" "cargo check --features remote" "src-tauri"
            & $add "cargo test --features remote" "cargo test --features remote" "src-tauri"
        }
        foreach ($crate in $CRATES_SERVICES) {
            if ($Tocados | Where-Object { $_ -like "services/$crate/*" }) {
                & $add "cargo test ($crate)" "cargo test" "services/$crate"
            }
        }
        foreach ($crate in $CRATES_CLIPPY) {
            if ($Tocados | Where-Object { $_ -like "services/$crate/*" }) {
                & $add "clippy ($crate)" "cargo clippy --all-targets -- -D warnings" "services/$crate"
            }
        }
    }

    if ($Only) {
        # Filtrar com cast para List quebra quando sobra UM item (o PowerShell
        # tenta construir a List por propriedade em vez de enumerar). Loop e
        # explicito e nao tem esse canto.
        $filtrado = [System.Collections.Generic.List[hashtable]]::new()
        foreach ($c in $plano) { if ($c.nome -eq $Only) { $filtrado.Add($c) } }
        $plano = $filtrado
    }
    return $plano
}

function ArquivosDoDiff {
    param([string]$Base)
    # Le git sem deixar falha derrubar o gate: no PowerShell 7.4+ o
    # `$PSNativeCommandUseErrorActionPreference` transforma exit != 0 de comando
    # nativo em excecao, e aqui a falha (base inalcancavel) e caso ESPERADO.
    $ler = {
        # NAO chamar de $Args: e variavel AUTOMATICA do PowerShell e o parametro
        # colide silenciosamente (o gate rodava Rust a toa por causa disso).
        param([string[]]$Argumentos)
        try {
            $anterior = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $r = & git -C $raiz @Argumentos 2>$null
            if ($LASTEXITCODE -ne 0) { return @() }
            return @($r)
        } catch {
            return @()
        } finally {
            $ErrorActionPreference = $anterior
        }
    }

    # A arvore de AGORA conta: trabalho ainda nao commitado tem de escolher os
    # canais igual (foi assim que este proprio script rodou Rust a toa na
    # primeira vez que eu o usei).
    $tocados = @()
    $tocados += & $ler @("diff", "--name-only", "$Base...HEAD")
    $tocados += & $ler @("diff", "--name-only", "--cached")
    $tocados += & $ler @("diff", "--name-only")
    $tocados = @($tocados | Where-Object { $_ } | Select-Object -Unique)

    if ($tocados.Count -eq 0) {
        # Nada em lugar nenhum: ou a base e inalcancavel, ou a worktree esta
        # limpa. Assume que tocou Rust — errar pro lado de rodar demais custa
        # minutos; pular canal em silencio e o defeito que este card fecha.
        return @("src-tauri/src/lib.rs")
    }
    return $tocados
}

# ── Plano ────────────────────────────────────────────────────────────────────
$tocados = if ($Arquivos) { $Arquivos } else { ArquivosDoDiff -Base $Base }
# `@(...)` obrigatorio: o `return` do PowerShell desenrola a lista, e com UM
# canal o `$plano` viraria um hashtable — onde `.Count` devolve o numero de
# CHAVES (3), nao 1. Seria um "nenhum canal a rodar" mentiroso.
$plano = @(Planejar -Tocados $tocados -Only $Only -SemRust:$SkipRust.IsPresent -SemBrowser:$SkipBrowser.IsPresent)

if ($Explicar) {
    foreach ($c in $plano) { Write-Output $c.nome }
    exit 0
}

if ($plano.Count -eq 0) {
    [Console]::Error.WriteLine("[gate] nenhum canal a rodar. -Only '$Only' nao casa com nenhum canal conhecido.")
    exit 2
}

# ── Execução ─────────────────────────────────────────────────────────────────
$pulados = @()
if ($SkipRust) { $pulados += "rust (-SkipRust)" }
if ($SkipBrowser) { $pulados += "test:browser (-SkipBrowser)" }
if ($Only) { $pulados += "todos menos '$Only' (-Only)" }

$resultados = @()
$vermelho = $null

foreach ($canal in $plano) {
    $dir = if ($canal.dir) { Join-Path $raiz $canal.dir } else { $raiz }
    Write-Host "▶ $($canal.nome)" -ForegroundColor Cyan
    $t0 = Get-Date

    # Rust roda SEM env de OpenSSL de proposito: e assim que vazamento de
    # dependencia aparece (licao #809).
    $salvos = @{}
    if ($canal.cmd -like "cargo*") {
        foreach ($v in "OPENSSL_DIR", "OPENSSL_NO_VENDOR", "OPENSSL_LIB_DIR", "OPENSSL_INCLUDE_DIR") {
            $salvos[$v] = [Environment]::GetEnvironmentVariable($v)
            [Environment]::SetEnvironmentVariable($v, $null)
        }
    }

    $saida = & {
        Push-Location $dir
        try { Invoke-Expression "$($canal.cmd) 2>&1" } finally { Pop-Location }
    }
    $ok = $LASTEXITCODE -eq 0

    foreach ($v in $salvos.Keys) { [Environment]::SetEnvironmentVariable($v, $salvos[$v]) }

    $seg = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    $resultados += [pscustomobject]@{ Canal = $canal.nome; Resultado = $(if ($ok) { "ok" } else { "FALHOU" }); Segundos = $seg }

    if (-not $ok) {
        $vermelho = $canal.nome
        # A saida CRUA do canal que falhou nao pode ser engolida (AC).
        Write-Host ""
        Write-Host "─── saída de '$($canal.nome)' ───" -ForegroundColor Red
        $saida | ForEach-Object { Write-Host $_ }
        break
    }
}

# ── Resumo ───────────────────────────────────────────────────────────────────
Write-Host ""
$resultados | Format-Table -AutoSize | Out-String | Write-Host
if ($pulados) { Write-Host "PULADOS: $($pulados -join ' · ')" -ForegroundColor Yellow }

if ($vermelho) {
    [Console]::Error.WriteLine("[gate] VERMELHO em '$vermelho'. Os canais seguintes nao rodaram.")
    exit 1
}

Write-Host "[gate] verde nos $($resultados.Count) canais." -ForegroundColor Green
if ($pulados) {
    Write-Host "[gate] atencao: houve canal pulado (acima). Verde parcial nao e verde." -ForegroundColor Yellow
}
exit 0
