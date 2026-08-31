# galaxie-db.ps1 -- wrapper de OPERACOES FECHADAS do galaxie.db (#1655, design #1653).
#   Repassa o verbo/flags para scripts/galaxie_db.py (verbos fechados; ZERO SQL cru).
#   Resolve o <memory>/galaxie.db portatil e chama o sqlite3 do stdlib Python.
#
# ASCII-only de proposito (acento/emoji quebram o parse .ps1 na codepage default do
# Windows -- mesma licao do galaxie-pat.ps1).
#
# Uso:
#   .\scripts\galaxie-db.ps1 init
#   .\scripts\galaxie-db.ps1 registrar-auto-reporte --papel mizar --contexto-kb 120
#   .\scripts\galaxie-db.ps1 consultar recibo-semanal
#
# Onde mora o .db (ordem de preferencia):
#   1) $env:GALAXIE_DB  (override explicito)
#   2) <memory>/galaxie.db, onde <memory> = %USERPROFILE%\.claude\projects\<slug>\memory
#      e <slug> = o caminho do repo com [:\/_ ] -> '-' (convencao do Claude Code).
#      NAO no cofre DPAPI: regras OPOSTAS (o cofre nunca sai da maquina; o .db restaura
#      do backup no DR -- ver docs/runbooks/dr-maquina-nova.md).

$ErrorActionPreference = 'Stop'

function Resolve-Db {
    if ($env:GALAXIE_DB) { return $env:GALAXIE_DB }
    # --git-common-dir devolve o .git do repo PRINCIPAL mesmo a partir de uma worktree
    # (o --show-toplevel devolveria a raiz da worktree -> slug/memory errados). O memory
    # dir e do PROJETO (main repo), nao da worktree.
    $common = (& git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir 2>$null)
    if (-not $common) { throw "nao achei o repo (git); defina `$env:GALAXIE_DB" }
    $topo = Split-Path $common -Parent
    $slug = ($topo -replace '[:\\/_ ]', '-')
    $mem = Join-Path $env:USERPROFILE ".claude\projects\$slug\memory"
    if (-not (Test-Path $mem)) {
        throw "memory dir nao encontrado em '$mem'. Defina `$env:GALAXIE_DB para o path do .db."
    }
    return (Join-Path $mem 'galaxie.db')
}

function Resolve-Python {
    foreach ($cand in 'python', 'python3', 'py') {
        $c = Get-Command $cand -ErrorAction SilentlyContinue
        if ($c) { return $c.Source }
    }
    throw "Python nao encontrado no PATH (o galaxie.db usa o sqlite3 do stdlib)."
}

$db = Resolve-Db
$py = Resolve-Python
$script = Join-Path $PSScriptRoot 'galaxie_db.py'

# @args = tudo que o utilizador passou (verbo + flags). O galaxie_db.py so conhece os
# verbos fechados -- verbo desconhecido erra no argparse, nao no SQL.
& $py $script --db $db @args
exit $LASTEXITCODE
