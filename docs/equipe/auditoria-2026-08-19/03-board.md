# Auditoria v2 — 03 BOARD (fluxo real, cards parados, raias) — 19/08 15:50 UTC
647 itens · pre-prod=de8c1a3 · main=e0e9f17 (v0.46.0) · pre-prod 28 commits à frente.

## Snapshot
| Coluna | n | nota |
|---|---|---|
| Backlog | 28 | 3 bloqueado |
| Ready | **29** | 9 precisa-design (8 c/ desenho) |
| In progress | **28** | **11 são ÉPICOS/meta sem executor** |
| In review | 1 | saudável |
| Done | 2 | #1260 Done SEM PR ("não reproduz") |
| QA Approved | 0 | |
| PO Approved | 3 | corte v0.47.0 BLOQUEADO (CI clippy vermelho → #1330) |
| Rejected | 0 | triagem do #1299 levou 3 min |
| Released | 556 | 213 nos últimos 7d; lag closed→Released mediana 2,7h, p90 19,7h |

**A direita do fluxo (In review/Done/QA/PO) está FINA E RÁPIDA. A gordura toda está em In progress (28) e Ready (29).** → O SM NÃO é o gargalo de fluxo. O gargalo é a ESQUERDA (épicos inflando, dono aposentado, decisão enterrada).

## Cards parados/mentindo (top)
- **#682 épico Remote** In progress 169h, 0 comentários desde 11/08; filhos S7/S8 em Ready 20h. Regra v1.11 "épico <100% fica In progress" FAZ a coluna mentir.
- **#994 + #1006-#1012** (8 épicos/meta) In progress 83-100h — containers, não execução. 39% de In progress é container → métrica "parado" cega; Mira errou 3 moves em 13 min por isso.
- **#1138** Ready 38h "é teu, Confucius" — Confucius APOSENTADO. Na real é bloqueado por crates externos. · **#1033/#1037** Ready 35h "Vega, entra no teu tracker" — Vega aposentada. **Cards de dono aposentado 35-38h sem re-groom.**
- **#1136** Ready 35h, último comentário "Decisão pedida ao Wagner — A ou B" **12h sem resposta, sem label bloqueado** (invisível).
- **#1000** In progress: Mizar parou 13:53 "preciso da direção do altair" — 2h sem resposta.
- **#1036** Ready 49h, zero comentários desde criação (mais velho da coluna, nunca tocado).
- **#1055** único precisa-design em Ready SEM desenho.
- **#1052** código em prod desde v0.42.0, card só viajou pra Released 3 dias depois. **#1303/#1298** Released SEM código nem tag (contenção/medição) — Released usado como "encerrado". **#1260** Done sem PR → vai passar Lúmen+Íris+PO+Atlas pra gatear um FATO.

Integridade OK: 0 Released c/ issue aberta · 0 PR merged c/ card em Ready · PR #1329↔#1320 coerente.

## Raias (assignee sempre galaxie-works; raia real = despacho nominal em comentário)
alcor **6** (postou "Livre, sem card" 7 min após receber 2 — despacho só na issue é INVISÍVEL) · castor 4 (ordem dada 14:13 e revogada 14:54) · mizar 4 (2 travados) · pollux 3 (dormiu 06:07→13:48 com card despachado 07:22 — #1299 6h "In progress" sem ninguém) · altair 1 + 2 pareceres pendentes · ninguém: 11 épicos. WIP real 17 cards / 4 devs, 2 travados.

## Handoffs quebrados (gargalo nomeado)
1. **Gate de integração ≠ CI** — Polaris roda tsc/vite/node/cargo check; CI roda `clippy -D warnings` → pre-prod VERMELHA desde fd3235f (#1049), v0.47.0 travada c/ 3 PO Approved. 2º furo em 1h (test:component em FE).
2. **Despacho invisível** — só na issue; dev sem watch não vê (Alcor "livre" c/ 5 cards).
3. **Decisão enterrada** — #1136 (PO 12h), #1000 (Altair 2h), sem `bloqueado`.
4. **Dono aposentado** — 3 cards 35-38h; 1º sweep pós-cutover moveu mas não re-groomou dono.
5. **Done sem código** entra na fila das QAs+Atlas: 4 colunas pra fechar "não reproduz".
6. **Épicos em In progress** (11) inflam coluna; "parado >4h" vira ruído.

## Recomendações (do auditor)
1. **`pnpm gate` = exatamente o que o CI roda** (incl. clippy -D warnings + vitest component/browser). Polaris integra SÓ com ele verde.
2. **Despacho = assignee/campo Executor no card + menção nominal na #133.** Hoje board não filtra "cards do alcor" (tudo galaxie-works). Campo `Executor` no Project resolve sem users.
3. **Épicos FORA das colunas de trabalho** — campo `Type=Epic` + view própria, ou Backlog até 100% e pulam pra Released.
4. **Saída "Closed – sem entrega"** (não reproduz/medição/contenção/dup): fecha+arquiva sem Done→QA→PO→Released.
5. **`bloqueado` automático quando há pedido de decisão** ("Decisão pedida ao X" → label + linha na hora).
6. **Re-groom de dono a cada cutover** (grep agente aposentado no último comentário = achado).
7. **Teto WIP/dev (3) com exceção registrada** + fila num lugar que o DEV lê.
8. Vigiar lag PO Approved→Released (hoje excelente 2,7h; único risco = corte travar por CI → rec. 1).
