# Explorer — pastas na árvore vs. na lista (RECOMENDAÇÃO PRO PO)

> **Status:** recomendação de arquitetura/UX do @Altair para o **#991**. O Wagner
> decide; o @Vega implementa depois da decisão. **Não implementado.**
> Pergunta original: *"se a gente exibe as pastas e subpastas no painel esquerdo,
> elas não deveriam estar na view da direita e vice-versa?"*

## 1. Recomendação em uma linha

**Não esconder pastas da lista — nem por padrão, nem como modo novo.** Entregar
"só arquivos" como **chip do filtro que já está sendo construído** (#984), e tratar
a dor real (densidade) com a **ordenação do #990**, que já está na fila. Motivo:
esconder pastas hoje **quebra três coisas que só existem na lista** — e duas delas
não têm substituto na árvore.

## 2. O que eu fui conferir antes de recomendar

### 2.1 A árvore é lazy e **não segue** a navegação
`arvore.tsx:134-139`: o estado `open` nasce só com as 4 raízes (This PC, nuvem,
rede, acesso rápido) e **só muda quando o usuário clica no expansor** (`aoAbrir`).
**Não existe efeito que expanda a árvore até o `currentPath`.** As pastas filhas só
são carregadas ao expandir (`arvore.tsx:149-176`, `listarDir` guardando apenas
`isDir`).

**Consequência direta:** navegando por **breadcrumb**, **busca**, **duplo-clique na
lista**, **Acesso rápido** ou caminho digitado, a árvore continua **colapsada** —
as subpastas do diretório atual **não estão visíveis nela**. Esconder as pastas da
lista nesse estado deixa as subpastas **invisíveis e inalcançáveis** até o usuário
expandir a árvore manualmente. A premissa "as pastas já estão à esquerda" **é falsa
na maior parte dos caminhos de navegação**.

### 2.2 Operação de pasta **só existe na lista**
O menu de contexto da árvore (`arvore.tsx:388-395`) oferece **apenas fixar/desafixar
no Acesso rápido**. Copiar, mover, renomear, excluir, propriedades — tudo isso vive
no menu da **lista** (`menu-contexto.tsx`). Sem pasta na lista, **a pasta deixa de
ser operável**: não dá pra renomear nem excluir uma pasta sem construir um menu de
contexto completo na árvore (trabalho novo, não previsto em nenhuma issue).

### 2.3 Drag-drop **ainda não existe** (mas é o gesto que se perde)
Não há `onDrop`/`onDragOver`/`dataTransfer` no `content-pane.tsx` nem no
`explorer-shell.tsx` — arrastar arquivo pra dentro de pasta **não está implementado
hoje**. Então esconder pastas **não quebra** nada agora; mas fecha a porta do gesto
mais natural de todo file manager (arrastar item **sobre a linha da pasta**), que
passaria a exigir mirar na árvore lazy — alvo menor e frequentemente colapsado.

## 3. O ponto que reenquadra o pedido

O incômodo do Wagner tem **duas causas diferentes** misturadas:

| Causa | É verdade? | Já tem solução na fila? |
|---|---|---|
| **Densidade** — pasta densa (Downloads, 3.485 itens) enterra o que interessa | **Sim** | **Sim: #990** — hoje `ordenar.ts:59` força pasta-antes-de-arquivo **e a direção não inverte isso**; o #990 mistura pelo critério (Data desc = recente primeiro) |
| **Redundância** — "a mesma pasta aparece nos dois lados" | **Só quando a árvore está expandida** (§2.1) | — |

A **densidade** é a dor de verdade, e ela **já está endereçada** por uma issue
pronta pra codar. A **redundância** é aparente: árvore e lista têm papéis
diferentes — a árvore responde *"onde eu estou / pra onde posso ir"* (hierarquia,
persistente), a lista responde *"o que tem aqui / no que eu posso agir"* (conteúdo,
operável). Nenhum file manager de referência (Explorer, Finder, Nautilus, Dolphin)
esconde pastas da lista, e não é conservadorismo: é porque a lista é a superfície
de **ação**, não só de leitura.

**Recomendação de sequência: fazer o #990 primeiro e re-olhar.** Há uma boa chance
de a queixa evaporar quando os arquivos recentes pararem de ficar soterrados —
e aí a gente não paga por uma mudança de paradigma que não era necessária.

## 4. Se o Wagner ainda quiser a opção, o COMO (em ordem de preferência)

**(A) Recomendado — "só arquivos" vira chip do filtro #984.**
O épico #984 já prevê a fatia **"só-pasta/arquivo"**. Então isso **não é feature
nova**: é uma opção do mecanismo que já vai existir, com o affordance que o usuário
já vai conhecer (chip visível + "limpar"). Ganhos: **estado explícito e visível**
(o usuário sabe por que a pasta sumiu), reversível num clique, zero paradigma novo,
zero código novo de navegação. Default: **mostrar pastas**.

**(B) Meio-termo — grupo "Pastas (N)" colapsável no topo da lista.**
Mantém pastas operáveis e visíveis, mas colapsáveis em pasta densa; o estado
persiste por diretório. Custa um agrupamento no `content-pane` e conversa com o
#990 (o grupo colapsado não atrapalha a ordenação misturada). **Só vale se o #990
não resolver** — senão é complexidade sem dor.

**(C) Não recomendado — esconder por padrão quando a árvore está aberta.**
É a proposta original, e é a pior das três: comportamento **condicional a um estado
de UI** (árvore aberta/fechada) é imprevisível — a mesma pasta mostra conteúdo
diferente dependendo de algo que o usuário mexeu sem relação. Exige, antes de
existir: auto-expansão da árvore até o `currentPath` (§2.1) **e** menu de contexto
completo na árvore (§2.2). É o caminho mais caro e o mais fácil de o usuário achar
que é bug.

## 5. Perguntas objetivas pro Wagner

1. Topa **fazer o #990 primeiro e reavaliar** o #991 depois? (recomendação forte)
2. Se sim e a queixa persistir: **(A)** chip "só arquivos" no filtro — de acordo?
3. Tem algum fluxo teu em que tu **navegas pela árvore e nunca pela lista**? Se sim,
   isso muda o peso do §2.1 e eu revejo — é o único cenário em que o (C) faria sentido.

## 6. Resumo
Esconder pastas da lista resolveria uma redundância que **só existe com a árvore
expandida**, ao custo de: subpastas invisíveis nos caminhos de navegação mais comuns
(árvore não auto-expande), pastas não-operáveis (menu de pasta só existe na lista) e
o gesto de drag-drop futuro. A dor real é **densidade**, e ela já tem dono (#990).
Recomendo **manter o padrão**, entregar "só arquivos" como **chip do filtro #984** se
ainda fizer falta, e **reavaliar depois do #990**.
