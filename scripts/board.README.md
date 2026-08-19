# `board.ps1` — consulta do board (Projects v2) por coluna em 1 comando

**Por quê** (#1327): o GitHub Projects v2 **não** filtra por coluna na API. Todo
sweep pagina o project inteiro (~7 páginas hoje) só pra ver uma coluna. Este
script faz essa paginação **uma vez**, guarda num cache curto e serve a coluna
pedida — o sweep vira 1 comando e a leitura é fresca no momento da escrita.

## Pré-requisitos
- `pwsh` (PowerShell 7+).
- `gh` autenticado com acesso ao board (`gh auth status`). Em sessão do time:
  `$env:GH_TOKEN = $env:GITHUB_PERSONAL_ACCESS_TOKEN`.

## Uso

```powershell
# saúde do board (contagem por coluna)
pwsh scripts/board.ps1

# uma coluna (ordenada por updatedAt desc; mostra Prio/Size/Estado/Labels)
pwsh scripts/board.ps1 -Coluna "In review"
pwsh scripts/board.ps1 -Coluna "Ready"

# saída JSON (para pipe / jq / outro script)
pwsh scripts/board.ps1 -Coluna "Ready" -Json

# progresso de um épico pelas SUB-ISSUES do GitHub (nunca regex no corpo)
pwsh scripts/board.ps1 -Epico 1008

# ignorar o cache e refazer a query
pwsh scripts/board.ps1 -Coluna "Ready" -Fresh
```

### Colunas (Status)
`Backlog` · `Ready` · `In progress` · `In review` · `Rejected` ·
`QA Approved` · `PO Approved` · `Done` · `Released to Production`.
Nome tem que ser **exato** (o filtro é igualdade). Coluna inexistente = 0 cards.

## Cache
- Arquivo: `%TEMP%\galaxie-board.json`. TTL **180 s**.
- Dentro do TTL, `-Coluna`/sem-arg servem do cache (1 leitura de disco, 0 rede).
- `-Fresh` ignora e regrava. `-Epico` **não** usa cache (query própria, sempre fresca).

## Detalhes que importam
- **Paginação por cursor** (`first:100` + `endCursor`) — pega o board inteiro, não
  os primeiros 100. Hoje são ~648 itens / 7 páginas.
- **Épico = sub-issues nativas** do GitHub (`subIssues`), não heurística de corpo
  (canon v1.11). `% Released` = sub-issues em `Released to Production` / total.
- Itens sem issue/PR (rascunho de project) são ignorados.
- IDs fixos no topo do script: project `PVT_kwHOD_4JN84BedaN`, repo
  `galaxie-works/galaxie-toolbox`.

## Teste
`scripts/board.Tests.ps1` — teste de contrato **autônomo** (sem Pester; a máquina
do time tem só 3.4 e a CI não roda PowerShell). Compara `-Coluna "In review"` com
uma paginação **manual independente** do board e falha se divergir; pula limpo
(exit 0 + SKIP) se `gh` não estiver autenticado.

```powershell
pwsh scripts/board.Tests.ps1   # exit 0 = contrato verde
```
