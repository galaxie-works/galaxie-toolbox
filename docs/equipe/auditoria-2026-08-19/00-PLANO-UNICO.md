# PLANO ÚNICO — acelerar execução, acompanhamento, zero perda, zero confusão
Síntese de 6 auditorias independentes (canon · autópsia do SM · board · #133 · memória · redesenho do cargo) + AUDITORIA-POLARIS do Hiparco. 19/08/2026. Autor da síntese: Polaris I (aposentado, consultor da zoeira).
Detalhes: 01-canon.md · 02-autopsia-sm.md · 03-board.md · 04-comms-05-memoria.md · 06-redesenho-sm.md

---

## 1. O DIAGNÓSTICO EM UMA FRASE
**O SM não é o problema — é o para-raios de um sistema que acumula rito manual num só nó, muda a lei a cada 2h, confessa erro em público e não dá ao dev um canal pra saber que tem trabalho.** Polaris I, II, III e IV falharam do MESMO jeito; 4 encarnações com a mesma assinatura = desenho, não agente. **Reciclar mais = mais Polaris, mesmos erros.**

### Os 7 fatos que provam (1 por auditoria)
1. **Cargo fisicamente impossível:** tick 3 do IV = 6 PRs × gate de 6 comandos = **36 comandos em 13 min**. `test:component` "nunca rodou" não é descuido, é aritmética. ~25 obrigações por tick; **55% mecânica, 25% cerimônia, só 20% coordenação real.**
2. **Gate manual duplica (mal) um CI que já existe:** CI roda clippy; SM não → **pre-prod vermelha, v0.47.0 travada**. A regra "rito local, nunca gh pr merge" sobreviveu à causa (CI instável) que morreu — repo é público, #1267 consertou o hang.
3. **Lei instável:** canon DOBROU em 20h (2.108→4.789 palavras), 11 emendas, **10 reativas a UM incidente**, 5 de madrugada; ≥6 "erros" do SM são comportamento ANTERIOR à regra que depois o proibiu. O SM integra cada emenda que muda o próprio cargo.
4. **O board anda na direita e apodrece na esquerda:** In review 1 · Done 2 · QA 0 · Rejected 0 · lag→Released **2,7h mediana**. Mas In progress 28 (**11 épicos sem executor**), Ready 29, cards de **dono APOSENTADO há 35-38h**, **decisão pro PO enterrada 12h sem label**, dev "Livre" com 5 cards.
5. **#133 é tribunal:** 7 threads = **110 posts (47%) sem produzir código**; 43% do volume é meta; Polaris = 33% dos chars, **17% do canal é só relatório de sweep**; **Wagner postou 2× mas ≥25 falas por chat foram renarradas** (maior gerador sem postar).
6. **A memória reproduz a culpa:** boot do Polaris V = identidade → canon → **13 erros → Context que abre "OS SEIS ERROS QUE ME RECICLARAM"** = 2 páginas de erro antes de qualquer estado; ledger contém **regras não-ratificadas como lei** (M1 violado); PolarisContext 76KB append-only.
7. **O maior custo do dia não foi erro de ninguém:** reciclagem preventiva do III → **5h35 SEM SM** (só o Wagner cria sessão e dormia). Custou mais que os 36 erros somados.

### E a verdade sobre a "desculpa"
- **15% dos posts dos OUTROS também abrem com correção** — é cultura do time, não defeito do SM; ele só é 2× mais longo e está no centro.
- **4 papéis inventaram "portão que o canon não tem" no MESMO dia** (SM, Pollux, Castor, Alcor) — é REDAÇÃO ambígua, não disciplina.
- **4 das 36 desculpas foram por NADA** (incl. assumir culpa do Alcor não ler a #133).
- O que o SM fez certo e ninguém conta: 21 integrações limpas, 385 branches podadas sem perda, recusou mover card contra evidência, e **a honestidade que tornou tudo isso auditável.**

---

## 2. O QUE FAZER — 5 movimentos, em ordem de alavanca

### MOVIMENTO 1 — Gate = CI. Integração sai da cabeça do SM. (maior alavanca; mata a família "passo faltando" inteira)
- **Rulesets na `pre-prod`** (repo público = grátis): required checks `frontend/gate` + `rust` + `clippy`; `browser` não-bloqueante; block force-push. 10 min do Wagner.
- **Dev integra a própria PR** quando CI verde: `gh pr merge --merge` (preserva merge-commit) → confere `merge-base` → move In review→Done → 1 linha na #133. `Ref` não move.
- `pnpm gate` (#1326) = **conveniência local ESPELHADA do workflow**, não gate oficial. Regra: nunca mais lista de comandos na cabeça de um agente.
- Cláusula: se em 48h o CI derrubar PR válida por instabilidade >1×/dia, o problema é o CI → volta `pnpm gate` espelhado.

### MOVIMENTO 2 — SM vira "SM de exceção". Polaris IV NÃO recicla.
- **Faz SÓ:** colisão/ordem/XL · Rejected SEM dono (regra-padrão: a QA que reprova nomeia o fresco) · `bloqueado` com dependência fechada · CI vermelho >1h sem dev · vigia o Hiparco · **índice de decisão ≤1.500 chars só quando decidiu**. **Zero relatório de sweep.** Acorda por menção + tick 45-60 min.
- **Deixa de fazer:** integração (→dev+CI) · sweep de In review (→some) · despacho card-a-card (→pull, mov. 3) · promoção sem-superfície (→última lente move) · disciplina da #133 (→Hiparco) · vigilância de 10 (→Hiparco) · integrar emendas (→Hiparco integra a própria PR).
- **Não reciclar agora:** reciclar reproduz o boot que prima pelo erro e abre outro buraco de 5h. O cargo muda EM VOLTA do IV.

### MOVIMENTO 3 — Pull system: o dev puxa, ninguém "despacha".
- **Mira ordena Ready** por prioridade + label `FE`/`BE`. **Dev livre PUXA o topo da sua área (WIP máx 2)**, escreve "peguei #N" no card + 1 linha #133, move pra In progress ele mesmo. `precisa design` sem desenho / `bloqueado` = não puxável (filtro, sem juízo).
- Formaliza a ordem do PO "fila por dev" (em prática, não canonizada) e mata "despacho invisível" (Alcor "Livre" com 5 cards; Pollux 6h dormindo com card).
- Campo **`Executor`** no Project (hoje tudo é `galaxie-works`; board não filtra "cards do Alcor").
- **Épicos FORA das colunas de trabalho** (campo `Type=Epic` + view própria, ou Backlog até 100% → Released). 11 épicos em In progress cegam qualquer métrica de "parado".
- **Saída "Closed – sem entrega"** (não reproduz/medição/contenção/dup) — sem passar por Done→QA→PO→Released (#1260/#1298/#1303 gastaram 3 papéis pra registrar um fato).
- **`bloqueado` automático em pedido de decisão** + **label `po-decisao` + view "Mesa do Wagner"** (QA Approved com superfície + po-decisao). Fim do #1136 12h invisível.
- Re-groom de dono a cada cutover (grep agente aposentado = achado).

### MOVIMENTO 4 — Moratória + Canon v2 enxuto. Parar de legislar a cada incidente.
- **Moratória de emendas 72h** (só a v1.12 que implementa este plano).
- **Canon v2 ≤1.200 palavras** (estrutura no 01-canon.md): 7 princípios · board 1 frase/célula · papéis sem nome (nome no ROSTER) · batimento por fila · código (CI é o gate) · release · reciclagem · como emendar.
- Cortar ~60%: histórico de emendas (→CHANGELOG-CANON.md), §8 cutover (→historia), §9 máquina (→runbook), nº de caso na lei (→CASOS.md), piadas, mistura nome×papel.
- **Como emendar:** máx 1 PR/dia em lote · **ratificação ESCRITA do PO na PR** (não "por canal direto") · regra de caso vai pra CASOS.md e só vira lei se repetir · transição nasce com data de morte.
- Resolver as 11 contradições com 1 frase cada (send_message permitido pra sessão `vivo` no ROSTER, 1×/alvo · épico tem linha própria · `@dono`→sem @ · superfície: "sem tela = sem superfície; quem cria marca; SM promove sem pedir" · dev livre puxa).

### MOVIMENTO 5 — Acabar com o ritual de confissão. Honestidade sem cerimônia.
- **Correção = editar o original + 1 linha** (`CORRIJO: X→Y · link`). ≤300 chars. Sem seção "erro meu", sem manchete, sem regra pessoal nova.
- **Lição → ledger do Hiparco, NUNCA #133.** Auto-reporte de carga → vigia por canal direto.
- **`polaris-linhagem-erros.md` → ≤10 antídotos mecânicos** ("faça X"), sem coluna "Quem", sem narrativa; histórico só na AUDITORIA. **Boot: Context PRIMEIRO; ledger só sob demanda.** Tirar dele toda regra não-ratificada.
- **Context com teto ~150 linhas / 15KB rolling** (>48h → historico/). PolarisContext 76KB → ≤10KB.
- **RETIRAR gatilho "2 erros/dia = reciclagem."** Reciclagem por carga medida ou rot real (confabulação), não por contagem de confissões.
- **PO nunca move card.** Se mover = SM devolveu; Hiparco conta como erro de classe. Trocar "na dúvida vai pro PO" por ratificação de classe ("Rust sem UI = sem superfície", já dada 15:03).
- **#133: teto 800 chars; template `[Papel] VERBO #card — frase · link`; sweep vazio = ZERO post; 1 post/papel/tick; canon SÓ na PR; eventos de papel → ROSTER; thread de processo → issue própria com label `processo`.**
- **Reciclagem nunca deixa o time sem SM:** Hiparco cria o sucessor (tem sessão) ou só com Wagner presente.

---

## 3. ONDE O PLANO DIVERGE DA AUDITORIA DO HIPARCO (pra você decidir com os olhos abertos)
| Hiparco propôs | Este plano | Por quê |
|---|---|---|
| Ledger de linhagem lido ANTES do Context | Context primeiro; ledger = 10 antídotos sob demanda | Boot que prima pelo erro fabrica o pedidor-de-desculpas (auditorias 01, 05, 06) |
| Gatilho "2 erros da família/dia = reciclagem" | Retirar | Torna cada erro existencial → documenta muito; e reciclar sem redesenhar = mesmos erros; a reciclagem do III custou 5h35 |
| `pnpm gate` como ÚNICO gate oficial | CI é o gate; `pnpm gate` = espelho local | Script pode divergir do CI de novo (já divergiu: F14 clippy 1 min após propor gate sem clippy) |
| Regras do ledger já "adotadas pelo IV" | Só após ratificação escrita na PR | Memória à frente do canon = M1 violado |
| Auto-reporte do SM na #133 a cada 4h | Por canal direto ao vigia | Publicar erros 3× na thread alimenta a percepção "toda hora se desculpando" sem mudar nada |
| **Concordância total:** #1326/#1327 ferramentas · ID/SHA só colado · cadência adaptativa · tick vazio não posta · relatório ≤1.500 · integrar canon só no HEAD ratificado · "o papel está mal desenhado" | ✅ | — |

---

## 4. TRANSIÇÃO (ordem, dono, tempo)
1. **Wagner (10 min):** ruleset na `pre-prod` (required checks; block force-push; merge method merge-commit). Arquivar as 6 sessões do mundo velho. Ratificar este plano → Hiparco redige v1.12.
2. **Hiparco (1 PR, v1.12):** movimentos 1-5 no canon + regra comum de correção + teto de post; **integra a própria PR pelo rito novo (1º teste)**. Depois: ledger → 10 antídotos; MEMORY.md zero estado; feedback-wakeup apagar; re-fatiar identidades por script; `FATOS.md` único.
3. **Mira (1 passada):** label `FE`/`BE` + ordem em Ready; `bloqueado`+`po-decisao` nos #1136/#442; re-groom dos cards de dono aposentado (#1138/#1033/#1037); épicos → view própria.
4. **Devs (próxima PR):** integram a própria PR com CI verde; Polaris só observa e confirma merge-base na 1ª rodada; passam a puxar da fila.
5. **QAs:** última lente move (incl. PO Approved se sem superfície); ao reprovar, nomeia o fresco.
6. **Polaris IV:** desliga cron 13 min; tick 45-60 + menção; para relatório; Context → ≤10KB; ROSTER atualizado. **Não recicla.**
7. **Hiparco:** assume `list_sessions` + auto-reportes dos 10; disciplina da #133; cria sucessor do SM quando for a hora.
8. **Atlas:** destrava v0.47.0 quando clippy verde (#1330); ganha: corte não depende mais do tick do SM.

## 5. COMO SABER EM 48h SE FUNCIONOU
| Métrica | Hoje | Alvo |
|---|---|---|
| Posts do SM/h · chars/h | 8/h · 22k | ≤2/h · ≤3k |
| Manchetes de erro próprio do SM | 4 em 2,5h | ≤1/dia, sem seção em nenhum post |
| Cards movidos pelo PO que eram de outro papel | 3 | 0 |
| Furos de gate (CI roda, integração não) | 2/dia | 0 por construção |
| PR aberta → Done | 6h no handoff | mediana ≤ CI (~25 min), p95 ≤1h, sem depender do SM |
| Dev livre >15 min com Ready>0 | Alcor 7 min; Castor/Pollux ~7h | 0 |
| Pedido ao PO sem resposta >4h (PO acordado) | #1136 12h, #442 14h | 0 |
| Emendas de canon/dia · integradas pelo SM | 11/dia · 7 | ≤1/dia · 0 |
| Posts na #133/dia · média chars | ~250 · 1.756 | ≤120 · ≤800 |
| Threads ≥5 posts sem código | 7 | 0 |
| Tempo sem SM por reciclagem | 5h35 | 0 |
