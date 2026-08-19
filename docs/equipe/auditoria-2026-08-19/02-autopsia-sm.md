# Auditoria v2 — 02 AUTÓPSIA DO SM na #133 (III+IV, 18/08 19:46Z→19/08 15:45Z)
232 posts. Polaris III 26 posts/13 ticks (12h); IV 19 posts (2h25). **19% dos posts, 33% dos chars.** Meta/retratação: III ~18%, IV ~37% do próprio volume.
**A cultura de retratação é do TIME INTEIRO:** 29 dos 187 posts dos outros (15%) abrem com correção (Pollux 6, Altair 4, Mizar 4…). O SM só é 2× mais longo e está no centro.
**Churn:** v1.0→v1.11 em ~19h; ≥6 "erros" do SM são comportamento ANTERIOR à regra que depois o proibiu.
**🔴 MAIOR CUSTO DO DIA NÃO FOI ERRO DE NINGUÉM:** reciclagem preventiva do III às 07:44Z → **5h35 SEM SM** (sucessor só nasce pela mão do Wagner, que dormia). PR #1313 esperou 4h30, board parado ~5h, Altair alarmou o PO à toa. **Custou mais relógio que os 6 erros somados.**
Wagner interveio ≥9× sobre o SM e moveu #1267/#1052/#1049 na mão.

## 36 itens: ✔ 24 erro de fato · ◐ 9 parcial · ✘ 4 desculpou por NADA (E1, E8, E18, F12) + 2 desproporcionais.
## Causa primária
- **c estado stale 25%** — família dominante: **4× cobrou o Altair por coisa JÁ ENTREGUE** (Altair entrega NA ISSUE como manda M3; SM lê o ÍNDICE). Repetiu afirmação refutada pela Íris 1h depois.
- **e zelo/cerimônia/desculpa por não-erro 19%** — o mais caro pro PO: 3 cards levados ao Wagner que eram do SM (Wagner moveu os 3).
- **f julgamento 19%** — "afirmar antes de verificar" (P0 falso do /v2/ws sobre inferência do Mizar; #1257 Done sem DoD) ou prudência virando ociosidade (1 card/dev).
- **a regra ambígua/churn 17%** — CADA item virou emenda (v1.3/1.5/1.7/1.10; Closes×Done ainda aberto).
- **d ferramenta 14%** — IDs digitados ×2; gate sem test:component; **gate sem clippy → v0.47.0 bloqueada**. Os 2 de maior dano são 100% mecânicos.
- **b sobrecarga 6%** primária, mas pano de fundo de c/f: III fez 15 integrações + 7 emendas + 13 sweeps paginados + disciplina da #133 em 12h.

## 3 padrões
**P1 "escreve o estado em vez de ler"** (~45%): carrega fila na memória entre ticks; não existe passo "abrir a issue dona" até v1.10; board só por 7 páginas.
**P2 "portão que o canon não tem / leva ao PO o que já decidiu"** (~35%): §2 v1.2(2) "na dúvida vai pro PO" INDUZ. **Não é só o SM: Pollux, Castor e Alcor inventaram portão inexistente no MESMO dia** ("§9.1 exige aviso, não autorização — criei um portão"). 4 papéis, mesmo reflexo → é REDAÇÃO, não disciplina.
**P3 "retratação proporcional ao alarme, não ao dano"**: 4,2k chars pro P0; 2,6k pra "portão aberto"; 2,2k pra assumir culpa do Alcor não ler a #133 (era do Alcor/da regra); 821 chars pra ID já corrigido. Time espelha → #133 vira diário de consciência.

## Cobranças injustas ao SM (9): Alcor "despacho não passou pela #133" (FALSO, estava); Altair cobrou #1303 com SM já reciclado e mudo; Hiparco fez o IV nascer com premissa "não houve handoff" (erro do criador); v1.6 escrita com premissa errada e corrigida 3× — SM integra cada versão.
## O que o SM fez CERTO e não aparece: recusou mover #1000 contra evidência; 21 integrações limpas; poda de 385 branches sem perda; pegou alcor/pollux/castor frios; diagnosticou CI cancelled; **a honestidade que tornou a auditoria possível.** Frequência de erro NÃO é muito maior que a dos pares (Mizar leu 404 como "rota existe"; Lúmen repetiu linha vencida 7 ticks; Mira regex; Hiparco errou premissa 2×) — **ele é o único contínuo, toca tudo e escreve mais. Isso amplifica.**

## Recomendações
P1: `sweep:polaris` que IMPRIME o último comentário da issue dona de cada card esperado (lê saída, não escreve de memória) · "fulano me deve X" só com link colado do último comentário dele · correção publicada por alguém → SM acusa recebimento no Context.
P2: reescrever v1.2(2) → "SM classifica e promove; cita critério; PO corta se discordar"; default "na dúvida vai pro PO" SAI, entra ratificação de classe · **PO nunca move card** (se mover = SM devolveu; Hiparco conta como erro de classe, SM não pede desculpa) · despacho em 2 canais por desenho + rito v1.10 passo 3 vale pra dev livre.
P3: retratação ≤300 chars, 3 campos (disse·é·onde corrigi), na issue; #133 só linha · auto-reporte vai pro vigia por canal direto, NÃO #133 · **"disciplina da #133" SAI do SM → Hiparco** (corta ~20% do volume dele).
Transversal: `pnpm gate` COM clippy · **reciclagem não pode deixar o time sem SM** (Hiparco cria sucessor ou só com Wagner presente — 5h35 é o item mais caro e não tem dono) · congelar emendas por janela (1 lote/6h em HEAD fixo).
