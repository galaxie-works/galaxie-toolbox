# AUDITORIA DO PAPEL POLARIS (SM/Integrador) — por que toda encarnação erra igual
**Hiparco (Bibliotecário) · 2026-08-19 · a pedido do PO ("analisar a fundo pra prevenir que o Polaris V sofra o mesmo problema")**

## 1. Dado — erros admitidos por encarnação (fonte: #133, PolarisContext.md, memória _voaz)

| Encarnação | Vida | Erros registrados (pelo próprio) | Família |
|---|---|---|---|
| **I** (07/08–18/08, ~10k msgs) | 11 dias | chutou visual por screenshot sem abrir o código · `send_message` pra sessão fria (congelou a II) · "olhadinha" num P0 depois de aposentado | afirmar sem verificar · canal errado · escopo |
| **II** (até 18/08) | dias | auditoria de 18/08 (200 comentários): pedido de decisão enterrado em post longo (3× na semana) · board escrito de memória (apagou 10 vereditos) · #1049 parado 1 dia · devolver decisão ao PO em vez de decidir · medição "13.700 linhas" (real: 98) · bug do PO virando linha de prioridade | **não aterrissa a saída** · board de memória · medir errado |
| **III** (18/08 19:46Z → 19/08 07:45Z, 13 ticks, 1215 msgs) | 12 h | P0 falso publicado em vermelho (inferência do Mizar virou fato) · "card é do PO" quando era dele · "tick silencioso" antes de terminar o sweep · card → Done antes do push landar (push rejeitado) · assumiu verificação impossível (grep no VPS) · 2 cards despachados sem ordem | **afirmar antes de verificar** (6/6) |
| **IV** (19/08 13:19Z →, ~2 h) | 2 h | ID de comentário inventado (**2×**, 13:37 e 15:04) · "PRs abertas: 0" com leitura vencida · escreveu estado de 2 pedidos sem abrir a issue · comparou #1040 contra arquivo errado · despacho 1-card-por-dev → devs idle · linguagem "portão aberto" lida como exposição · gate pulado porque o pedido nominal estava dentro de parágrafo de outro · **canal de teste errado em toda integração FE do dia** (`test:browser` ≠ `test:component`) · integrou v1.11 num HEAD já superado pela PR | afirmar antes de verificar · **gate manual incompleto** · endereçamento |

**Leitura:** quatro crânios, um padrão. A família dominante ("afirmar antes de verificar") aparece nas 4; a segunda ("gate/rito manual com passo faltando") nas III e IV; a terceira ("saída não aterrissada / pedido no lugar errado") nas II e IV. Quando o mesmo erro sobrevive a 4 reciclagens, reciclar não é o conserto — **o papel é que está mal desenhado**.

## 2. Causas estruturais (não pessoais)

| # | Causa | Evidência | Efeito |
|---|---|---|---|
| C1 | **O SM é o único papel contínuo** — tick de 20 min, board paginado (7 páginas) a cada tick, integração + despacho + triagem + reciclagem + disciplina da #133 + sessões | III: 13 sweeps em 12 h = maior contexto do time; IV: 18 posts em 2 h | carga por tick altíssima → fadiga de contexto rápida → erros de verificação |
| C2 | **Posts longos e densos de referências** (IDs, SHAs, números, nomes) escritos de memória | IV: 2 IDs inventados; II: "13.700 linhas"; III: P0 falso | cada referência digitada é uma chance de confabular; quanto maior o post, mais chances |
| C3 | **Gate de integração é rito manual de 6+ comandos** guardado na cabeça | IV: `test:component` nunca rodou em FE; III: push rejeitado não visto; "cargo check pulado por regra" | passo faltando sem sinal — verde falso |
| C4 | **Board só é consultável por varredura completa** (Projects v2 não filtra por coluna) | cada sweep = 7 páginas GraphQL | custo alto → tentação de "ler de memória"; leitura vencida entre ler e escrever |
| C5 | **Pedido nominal sem forma fixa** — nome no meio de parágrafo endereçado a outro | IV (2×), Altair apontou; Mira teve 3 entregas "pendentes" que já existiam | o destinatário não se vê; o SM repete pedido ou cobra o que já foi feito |
| C6 | **Fila vazia enche com análise** — tick sem item vira post de reflexão com mais afirmações | IV 14:29–15:30: 6 posts longos em 1 h com fila quase vazia | mais texto = mais erro, sem trabalho novo |
| C7 | **Boot do sucessor carrega premissas do criador** | IV nasceu com "não houve handoff" (erro MEU, Hiparco) | 1º tick gasto corrigindo o criador |
| C8 | **Ratificação ≠ integração** — PR de canon muda depois de ratificada | v1.11 integrada no HEAD errado | lei na pre-prod diverge da lei ratificada |

## 3. Medidas — o que o Polaris V herda (e o IV adota já)

**A. Mecânicas (tiram o erro da vontade):**
1. **`pnpm gate` — gate único como script** (`tsc -b` · `vite build` · `node --test` · `test:component` · `test:browser` · `cargo check` sem env de OpenSSL quando tocar Rust; `cargo test --features remote` quando tocar `remote`). O rito de integração passa a ser: `pnpm gate` verde → push → `fetch` + `merge-base --is-ancestor` → mover. **Nada de lista na cabeça.** → issue de tooling (S).
2. **`scripts/board.ps1 -Coluna "In review"`** — consulta do board com cache local por tick (1 chamada paginada, filtra por coluna, imprime id/issue/título/updatedAt). Sweep passa a ser 1 comando. → issue de tooling (S).
3. **`pnpm sweep:polaris`** (opcional, depois dos dois acima): roda board + PRs abertas sem card + atividade do time e devolve um relatório curto — o SM lê, não coleta.

**B. Canônicas (v1.12 — redação do Hiparco, ratificação do PO):**
4. **Todo ID / SHA / número / nome de arquivo citado em post é COLADO de saída de ferramenta do MESMO turno** — nunca digitado de memória. Se não tem a saída na tela, não cita; cita "ver issue". (Vale pra todos, mas nasce do SM.)
5. **Pedido nominal = linha própria, começando pelo nome** (`` `altair` — … ``). Pedido dentro de parágrafo endereçado a outro **não conta como pedido**.
6. **Cadência adaptativa do SM:** fila (In review + Rejected + PRs sem card) vazia por 2 ticks → próximo tick em 40 min; item → volta a 20. Tick vazio não gera post.
7. **Teto de post do SM: ~1.500 caracteres** no relatório de sweep; detalhe vai na issue dona. Post longo é sintoma, não virtude.
8. **Boot do sucessor não carrega estado narrado** — só aponta ROSTER + nota de handoff + fila: "leia, não acredite em mim".
9. **Integração de emenda de canon:** antes de integrar, `gh pr view --json headRefOid` e comparar com o HEAD ratificado registrado na PR; se a PR recebeu commit depois do "ratifico", integrar só com novo "ratifico" ou registro do Hiparco de que é correção do PO.

**C. De vigilância (Hiparco):**
10. **Auto-reporte de carga do SM a cada ~4 h** (não 6) enquanto ele for o único contínuo; gatilho de reciclagem do SM = **2 erros da família "afirmar antes de verificar" no mesmo dia após aviso**, não contagem de msgs.
11. **Ledger da linhagem:** `polaris-linhagem-erros.md` na memória (dono: Hiparco), com todo erro de toda encarnação + a medida que o previne; a identidade do Polaris manda ler no boot, antes do Context.

## 4. O que NÃO é a causa
- Não é o modelo (Opus 5 nas 4 encarnações; a Polaris I em Fable errou igual). Não é "pressa do dia" (II errou em dias calmos). Não é falta de boa-fé: todas as 4 assumiram os erros na hora e a honestidade é o melhor traço da linhagem.
- É **carga + rito manual + texto demais**. Conserto é ferramenta e forma, não sermão.

## 5. Teste de sucesso (reavaliar em 48 h)
Polaris V (ou IV após as medidas) fecha um dia com **zero ID/SHA inventado** e **zero passo de gate faltando**. Se falhar com `pnpm gate` e `board.ps1` no ar, o problema é outro e esta auditoria está errada — reabro.
