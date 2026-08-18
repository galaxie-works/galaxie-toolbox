# Fatiamento do `control-room.tsx` — desenho dos seams

> **Desenho de arquitetura (#1019, épico #1007, auditoria #994).** Altair desenha,
> Vega executa. Medido em `46ede70`: `src/screens/control-room.tsx` = **7.692
> linhas**, 39 `useState`, 34 `useEffect`, 25 `useMemo`, 7 `useCallback`, **zero
> `React.memo`**, e 14 `useRef` só no componente de tela.
>
> Todas as faixas de linha abaixo foram conferidas no arquivo.
>
> ⚠️ **As linhas valem para `46ede70` e vão deslocar.** Quatro PRs abertas tocam este
> arquivo (`#1004`, `#1081`, `#1084`, `#1086`) e uma delas remove ~64 linhas antes do S3.
> **Execute pelos NOMES das funções** — que estão listados em cada seam; as linhas são
> orientação, não contrato. Ver §7.

---

## 0. Antes de qualquer extração: a rede de testes que o AC pressupõe **não existe**

O AC do #1019 diz *"a suíte de testes de componente existente do Bridge (…) continua
verde"*. Conferi:

- o repo tem **2** testes de componente no total — `compose/campo-pessoas.component.test.tsx`
  e `explorer/lumen-680-pointer-capture.component.test.tsx`. **Nenhum toca o Bridge.**
- o único teste que cobre o `control-room` é `lib/lumen-788-empty-folder-contract.test.ts`,
  e ele **lê o arquivo como TEXTO** (`readFileSync` + `bracedBlock`), asserindo sobre
  o bloco `async function esvaziarPasta(`. É um *tripwire estrutural*, não um teste
  de comportamento — e **quebra por construção** se aquela função mudar de arquivo.

Ou seja: **não há rede comportamental para 7.692 linhas**, e o único guarda existente
é anti-refatoração por desenho. Isso não impede o trabalho, mas impõe a disciplina:

> **Os PRs 1 a 5 são MOVIMENTO PURO.** Nenhuma edição de lógica junto de uma extração —
> nem "já que estou aqui, arrumo esse `useEffect`". O revisor tem que conseguir
> confirmar que o diff é recorte-e-cola. **Só o PR 6 muda comportamento**, e ele não
> move nada.

Essa é a única forma honesta de fazer isso sem net. O que **dá** para testar de
verdade é o núcleo do PR 6: extrair as **decisões puras** do hook para `.ts` sem React
(`node --test` não carrega `.tsx`) e testá-las direto — mesmo padrão que já usamos no
`validar_hello`/`decidir_acao` do Remote.

**Gates estruturais — impacto conferido:** `lumen-botoes-ast` e `lumen-i18n-hardcoded`
varrem por `globSync("src/**/*.tsx")` com allowlist por `caminho::trecho`, e
**nenhum dos dois tem entrada de `control-room`** — movimento puro não os afeta.
Só o `lumen-788` está acoplado (§6).

---

## 1. Os 6 seams

Cada bloco abaixo é **contíguo** no arquivo: move inteiro, sem costura.

| # | Arquivo-alvo | O que vai (linhas) | Depende do store? |
|---|---|---|---|
| **S1** | `components/bridge/corpo-html.tsx` | `CorpoHtml` **351-608**, `textoAviso` **609-631**, `ModalLinkSeguro` **632-711**, `CorpoMensagem` **712-739** | **não** |
| **S2** | `components/bridge/folder-sidebar.tsx` | **1054-2439**: helpers de pasta (`rotuloPasta`, `podeMarcarTodasLidas`, `podeEsvaziar`, `podeCriarSubpasta`, `ehPastaCustom`, `subarvoreIds`, `achatarPastas`), `DialogNomePasta`, `iniciaisDeEmail`, `AvatarCaixa`, `SeletorCaixa`, `DialogAdicionarCaixa`, `FolderSidebar` | sim |
| **S3** | `components/bridge/message-list.tsx` | **2512-4434**: `SeletorDataFiltro`, `periodoChave`, `SubmenuMover`, `ItensMenuEmail`, `MessageList` | sim |
| **S4** | `components/bridge/message-detail.tsx` | **4435-5657**: `LinhaPessoas`, `dataCurta`, `recencia`, `porMes`, `InsightsRemetentePopover`, `BadgeAutenticacao`, `PreviewEmailAninhado`, `MessageDetail` | sim |
| **S5** | `hooks/use-lista-mensagens.ts` (+ `.ts` puro ao lado) | bloco de paginação/cache/poll do `ControlRoomScreen` e seus refs (§4) | sim |
| **S6** | `components/bridge/evento-dialog.tsx` | **5658-6258**: `badgeResposta`, `EventoParticipantePill`, `EventoDialog` | sim |

**S6 não estava no AC** — e devia estar. `EventoDialog` é o 5º componente de porte de
módulo do arquivo, e é **agenda**, não e-mail: é o domínio mais fácil de separar de
todos. Recomendo incluir; se o PO preferir cortar escopo, corta este, não os outros.

Sobra no `control-room.tsx`: helpers de data do topo (297-350), os vazios/ilustrações
(`IlustracaoCards`, `IlustracaoCalendario`, `PastaVazia`, `AgendaVazia`, `AgendaErro`,
`BotaoExcluir`, `DicaSomenteLeitura`, `MultiSelecaoContexto`, `descricaoErroEscrita`)
e o `ControlRoomScreen`. **Estimativa: ~1.400 linhas**, de 7.692.

---

## 1-bis. Helper compartilhado: o furo que a `Vega` achou no S6/S3 (nota de 2026-08-18)

**O desenho original listava S6 e S3 sem esta dependência. Era omissão minha.** A `Vega` bateu nela ao começar o S6 e resolveu certo, com um enabler; registro aqui porque **vale para todo seam que ainda falta**, não só para esses dois.

### A armadilha

`EventoDialog` (S6) e `MessageList` (S3) usavam `faixaHora`/`quandoCurto`, que por sua vez usavam `comZ` — e o `comZ` era usado em ~9 pontos do próprio `control-room`. Isso cria uma escolha em que as duas saídas óbvias são ruins:

- **levar o helper junto com o seam** → rouba dos outros ~9 consumidores;
- **deixar o helper e importar de volta** → `control-room` ↔ seam, **dependência circular**.

**A saída é a terceira: o helper sobe para `lib/` ANTES do seam descer.** Foi o que o enabler fez (`src/lib/data-email.ts`, PR #1171, integrado em `b93c49c`); hoje o `control-room` importa dele (`control-room.tsx:292`).

### A regra, generalizada

> **Antes de extrair um seam, listar o que ele consome que o resto do arquivo também consome. Todo helper compartilhado vira PR-enabler próprio, ANTES — e o enabler é movimento puro, revisável como recorte-e-cola.**

Isso é o mesmo princípio do PR-de-movimento-puro da §5, um nível abaixo: o enabler é o *pré*-movimento que impede o ciclo.

### ⚠️ O que o enabler NÃO resolveu — medido em `b93c49c`

Extrair para `lib/` desfez o ciclo, **mas a duplicação continua**. Há **três** `comZ` na árvore hoje, e uma delas não é a mesma função:

| Onde | Assinatura | Situação |
|---|---|---|
| `src/lib/data-email.ts:14` | `comZ(iso): string` | **canônica** — o `control-room` importa daqui |
| `src/components/agenda/agenda-view.tsx:226` | `comZ(iso): string` | **duplicata literal** — corpo idêntico |
| `src/screens/atoms.tsx:67` | `comZ(iso): **Date**` | **homônimo com outro tipo de retorno** — e testa com `/Z$/` em vez de `endsWith` |

A terceira é a perigosa: **mesmo nome, contrato diferente.** Quem for "deduplicar por nome" troca um `Date` por um `string`. O `tsc` pega (as chamadas quebram na hora), então não é risco de runtime — é risco de alguém desistir no meio e deixar meia-migração.

**É a mesma classe do `iniciais` (#1023, 11 implementações divergentes da mesma coisa).** Não bloqueia os seams; fica registrado para quem fizer a convergência — e a ordem certa é a mesma: **um helper canônico, depois os consumidores, nunca o inverso.**


## 2. As 30 props do `MessageList` — o diagnóstico é outro

O card trata como "lista plana de 30 props". Lendo o componente, a causa é diferente:
**`MessageList` já consome o store direto** (`selecionados`, `msgSel`,
`selecionarMensagem`, `alternarSelecionado`, `limparSelecao`, `selecionarTudo`…). O
mesmo vale pro `MessageDetail` (`leitorDetalhe`, `leitorSeguranca`, `composeModo`).

Ou seja, **as props não são a superfície de dados — são a superfície de COMANDO**.
Agrupar por assunto não resolve; agrupar por **dono da ação**, sim:

```ts
/** Ações sobre mensagem — IDÊNTICAS no MessageList e no MessageDetail hoje. */
export interface AcoesMensagem {
  onFlag: (id: string, novo: boolean) => void;
  onExcluir: (ids: string[]) => void | Promise<void>;
  onMarcarLido: (id: string, lido: boolean) => void;
  onSalvarComo: (ids: string[], formato: FormatoSalvar) => void;
  onImprimir: (ids: string[]) => void;
}

/** Dados da lista corrente. */
export interface EstadoLista {
  titulo: string; mensagens: EmailItem[] | null; erroLeitura?: string;
  pastaId: string; pastaTipo: string;
  carregandoMais: boolean; temMais: boolean; ativo?: boolean;
}

/** Destino de "Mover para…". */
export interface DestinosMover {
  pastas: PastaDestino[]; carregando: boolean;
  onAbrir: () => void;
  onMover: (ids: string[], destino: string, rotulo: string) => void;
}

/** Teclas que agem no LEITOR (handle imperativo) ou no PAI. */
export interface AtalhosLeitor {
  onResponder: () => void; onResponderTodos: () => void;
  onEncaminhar: () => void; onAbrirMaisAcoes: () => void; onCompor: () => void;
}
```

**O ganho que importa não é a contagem — é o `AcoesMensagem` ser UM tipo
compartilhado.** Hoje as mesmas 5 ações estão declaradas duas vezes, em dois lugares;
divergir uma assinatura é erro silencioso até o runtime.

Sobram soltas: `onRefresh`, `onEsvaziar`, `onCarregarMais`, `filtrosOcultos`,
`envioBloqueado`. Ficam props diretas — agrupar as 5 restantes só para "fechar em 4
objetos" seria agrupamento cosmético.

### `t` e `idioma` saem das props

**21 assinaturas** neste arquivo recebem `t: ReturnType<typeof useIdioma>["t"]` como
prop, contra **5** que chamam `useIdioma()` local. Como todos os componentes grandes já
assinam o store, chamar o hook dentro deles não muda o perfil de re-render de forma
relevante — e elimina uma classe inteira de "esqueci de passar o `t`".

Tradeoff honesto: componente que hoje é puro-de-props passa a depender de contexto de
idioma; se algum dia alguém quiser renderizá-lo isolado num snapshot, precisa do
provider. Vale o preço.

---

## 3. `React.memo` só depois — e só onde medir mostrar

Zero `React.memo` hoje. **Não memoizar junto da extração.** Memoização com props
instáveis (as ~15 callbacks acima, criadas inline) não faz nada além de custar
comparação. A ordem é: extrair → estabilizar as callbacks com `useCallback` no dono →
**aí** medir e memoizar `MessageList`/`MessageDetail`. Fora dessa ordem é teatro.

---

## 4. Os refs-espelho — 4 deles não devem ser movidos, devem **morrer**

14 `useRef` no `ControlRoomScreen`. Não são uma categoria só:

| Grupo | Refs | Destino |
|---|---|---|
| **Identidade da consulta** | `pastaSelRef` `:6432`, `caixaAtivaRef` `:6439`, `ordenarRef` `:6441`, `ordemDescRef` `:6443` | **eliminar** — ver abaixo |
| Paginação/cache | `carregandoMaisRef` `:6430`, `carregadosRef` `:6436`, `mensagensRef` `:6447`, `recargaAnteriorRef` `:6458`, `deletadasRef` `:6461`, `ultimoVistoRef` `:6588` | encapsular no `use-lista-mensagens` |
| Árvore de pastas | `subpastasPedidasRef` `:6498` | vai com **S2** |
| Callback-mais-recente | `marcarLidoRef` `:6922` | some se a callback virar estável (`useCallback` no dono) |
| Imperativo/UI | `detalheRef` `:6427`, `filtroPastaRef` `:7384` | ficam na tela |

### Por que os 4 primeiros morrem

O padrão real é guarda de resposta velha, feita **campo a campo**:

```ts
// :6507
if (caixaAtivaRef.current !== caixaPedido) return;
// :6511  — o MESMO retorno, guardado de novo
if (caixaAtivaRef.current !== caixaPedido) return;
// :7318  — e outra vez, 800 linhas adiante, em outra função
if (caixaAtivaRef.current !== caixaPedido) return;
```

Três sítios repetem a mesma guarda, um deles bem longe dos outros dois.

A identidade da consulta é `(caixa, pasta, ordenar, ordemDesc)`. Espelhar cada campo
em um ref e conferir um a um significa que **toda função assíncrona nova precisa
lembrar de guardar os quatro** — e a pergunta "guardei todos?" não tem resposta
mecânica. É a mesma forma do problema que resolvemos no Esc do Explorer: N guardas
concorrentes trocados por **um resolvedor**.

**Decisão: um token de geração.**

```ts
const chave = `${caixa}|${pasta}|${ordenar}|${ordemDesc}`;
const geracaoRef = useRef(0);
// ao mudar a chave: geracaoRef.current++
// em TODO retorno assíncrono, uma linha só:
if (minhaGeracao !== geracaoRef.current) return;   // resposta velha, descarta
```

4 refs viram 1, a guarda vira uma linha, e o campo novo (um filtro a mais amanhã) entra
na chave sem tocar em nenhum ponto de retorno. **Esta é a única mudança de
comportamento do plano inteiro — por isso ela é um PR sozinho (§5, PR 6).**

`deletadasRef` (13 usos) e `carregandoMaisRef` (12) são os mais entrelaçados: são o
estado real da paginação disfarçado de ref. Encapsulados no hook, param de vazar.

---

## 5. Ordem dos PRs — risco crescente

| PR | Seam | Natureza | Risco |
|---|---|---|---|
| 1 | **S1** `corpo-html` | movimento puro | mínimo — não toca store |
| 2 | **S6** `evento-dialog` | movimento puro | baixo — domínio separado (agenda) |
| 3 | **S4** `message-detail` | movimento puro | médio — handle imperativo cruza a fronteira |
| 4 | **S2** `folder-sidebar` | movimento puro | médio — leva `subpastasPedidasRef` |
| 5 | **S3** `message-list` | movimento + agrupamento de props (§2) | alto — maior superfície |
| 6 | **S5** `use-lista-mensagens` + token de geração | **mudança de comportamento** | alto — sozinho, nunca junto de um move |

Começar pelo S1/S6 não é timidez: são os que provam a disciplina de movimento puro com
diff pequeno, antes de aplicá-la onde ela é difícil de revisar.

---

## 6. Consequências que mordem

1. **`lumen-788` está acoplado ao arquivo.** Ele exige `async function esvaziarPasta(`
   dentro de `control-room.tsx`. Enquanto os PRs 1-5 forem movimento puro e
   `esvaziarPasta` ficar na tela, ele passa. **Se algum PR mover essa função, o teste
   tem que ser reapontado NO MESMO PR** — senão o gate quebra e ninguém entende por quê.
2. **As 9 supressões de `exhaustive-deps` realocadas do #1016** caem assim (linhas
   conferidas): `2556, 3248, 3286, 3664, 3686` **+ a inerte `3215`** estão dentro do
   **S3**; `6405, 6422, 7291, 7346` ficam com a **tela/S5**. Triar **dentro do seam que
   é dono da linha**, nunca num passe separado — passe separado colide com a extração.
3. **`EventoDialog` é agenda dentro do arquivo de e-mail.** Se ficar fora do escopo,
   registre a dívida; não deixe implícito.
4. **`useIdioma` local** (§2) é a única mudança que toca todos os seis arquivos. Fazer
   **dentro de cada extração**, não num PR "de i18n" no fim.

---

## 7. Trava do arquivo e ordem com as PRs abertas

Medi os hunks de `screens/control-room.tsx` em **todas** as PRs abertas no momento do
desenho:

| PR | Hunks | Seam atingido |
|---|---|---|
| **#1086** (#1016) | `:534`, `:3212` | **S1**, **S3** |
| **#1084** (#1059) | `:50`, `:4035`, `:5594`, `:5889` | **S3**, **S4**, **S6** |
| **#1081** (#1058) | `:17`, `:2441` (**-66 linhas**), `:2535`, `:3802` | fronteira **S2/S3**, **S3** |
| **#1004** (#912) | `:1954` | **S2** |
| **#1088** (#1060) | `:126`, `~:2866-2910` (constantes `ATALHO_*`) | **S3** |

**Todo seam menos o S5 tem PR pendente em cima**, e o **S3 é disputado por quatro**. Consequências:

1. **As 4 entram antes do PR1 da extração.** Não existe "começo pelo S1 enquanto o resto
   drena" — o S1 já colide com o #1086, e o S3 é disputado por três PRs de dois autores.
2. **A partir do PR1, o arquivo fica travado para outras raias** até a extração terminar.
   Quem precisar tocar `control-room.tsx` nesse intervalo entra antes do PR1 ou espera.
3. **O #1088 encolhe o S3.** Depois dele, os 15 `ShortcutDefinition` inline
   (`:2866-2910`) viram `shortcutBridge("id")` apontando pro catálogo declarativo — o
   bloco de atalhos deixa de ser conteúdo do seam e vira consumo de um módulo. A
   extração fica mais limpa **depois** daquele PR, não apesar dele.
4. **Um seam por vez, cada um sobre `feat` já integrado.** Não empilhar os 6. Torre em
   base congelada transforma cada rebase num diff que ninguém confere como recorte-e-cola
   — e é justamente essa conferência que substitui a rede de testes ausente (§0).

---

## 9. S0 — enabler de componentes compartilhados: **a ideia está certa, a lista de membros não** (2026-08-18, `fe68d11`)

A `Vega` parou o S3 ao achar uma teia de UI-helpers e propôs um enabler `message-shared.tsx` com 8 itens, perguntando se bate com o desenho. **Parar em vez de commitar uma extração circular foi a decisão certa** — e é a mesma forma do enabler de data (#1171), que funcionou.

Fui medir os 8 antes de responder. **Seis não deveriam entrar.**

| Item | Usos reais | Onde caem | Veredito |
|---|---:|---|---|
| `AgendaVazia` (`:530`) | **0** | — | ⛔ **código morto** |
| `AgendaErro` (`:546`) | **0** | — | ⛔ **código morto** |
| `PastaVazia` (`:337`) | 1 | `:3500` | vai com o seam do ponto de uso |
| `MultiSelecaoContexto` (`:484`) | 1 | `:6533` | vai com o seam do ponto de uso |
| `SubmenuMover` (`:2140`) | 2 | `:1405`, `:2291` | decidir quando o seam dono sair |
| `DicaSomenteLeitura` (`:451`) | 6 | `:4715`–`:4768` | ❌ **todos num bloco de 53 linhas** |
| `descricaoErroEscrita` (`:473`) | 10 | `:5618`–`:6071` | ❌ concentrado em ~450 linhas |
| `BotaoExcluir` (`:362`) | 4 | `:515`, `:3057`, `:3444`, `:5872` | ✅ **o único genuinamente espalhado** |

### O critério — e ele não é contagem de usos

> **"Compartilhado" não é quantas vezes o helper é usado. É os usos caírem em seams DIFERENTES.**

`DicaSomenteLeitura` tem **6 usos** e é a coisa **mais local do arquivo**: os seis vivem dentro de 53 linhas. Pela contagem, seria o campeão do módulo compartilhado; pela distribuição, ele pertence **inteiro** a um seam só. `descricaoErroEscrita` é o mesmo caso, com 10 usos numa faixa de 450 linhas.

### Por que isso importa mais do que parece

Um `message-shared.tsx` com os 8 vira **gaveta de bagunça**: um módulo que existe porque a extração foi difícil, não porque os itens pertencem juntos. Todo seam passaria a importar de lá, e a gaveta viraria um **acoplamento novo no lugar do que a gente está desmontando** — com a agravante de parecer arrumação.

É a mesma patologia da categoria `Miscellaneous` do catálogo (#1162): *"diversos" não é uma categoria, é a ausência de uma* — e é sempre a de pior qualidade por item.

### O que eu recomendo

1. **Apagar** `AgendaVazia` e `AgendaErro`. São órfãos — quase certamente ficaram para trás quando o **S6** levou o `EventoDialog` para `bridge/evento-dialog.tsx`. **Extração que deixa órfão é dívida do próprio movimento**; vale conferir isso ao fim de cada seam, não só neste.
2. **`BotaoExcluir` é o único candidato real a compartilhado.** Com um membro só, não justifica um módulo novo: cabe num arquivo de componente do Bridge que já exista, ou espera um segundo membro aparecer.
3. **`DicaSomenteLeitura` e `descricaoErroEscrita` descem junto com o seam que os usa** — são locais, não compartilhados.
4. **`PastaVazia` e `MultiSelecaoContexto`** vão com o seam do respectivo ponto de uso.
5. **`SubmenuMover`** fica para quando o seam dono for extraído.

**Resultado: o S3 provavelmente não precisa de um S0.** Precisa que cada helper desça com o seam certo — e que dois sejam apagados. Se depois de S3/S4 sobrar mais de um item genuinamente cruzado, aí o módulo compartilhado nasce **com evidência**, não por precaução.

> Regra que fica: **módulo compartilhado nasce quando o segundo consumidor de seam diferente aparece — nunca antes.**

---

## 9-bis. A `Vega` corrigiu o meu §9 — **o critério estava certo, a minha aplicação dele estava incompleta** (2026-08-18, `5ff1488`)

No §9 eu disse que `BotaoExcluir` era **o único** membro real do enabler. Ela mediu de novo e achou **três**. Conferi cada um antes de aceitar:

| Membro | Onde cruza | Verificado |
|---|---|---|
| `BotaoExcluir` | S3 + `MultiSelecaoContexto` | ✅ eu já tinha |
| `SubmenuMover` (`:2140`) | uso em **`:1405`** (FolderSidebar/S2) **+** dentro do `ItensMenuEmail` (`:2238`, que desce pro S3 em `:3851`/`:3882`) | ✅ **cruza S2 e S3** |
| `PastaDestino` (`:680`, **tipo**) | `:1111` (S2) + `:2151` (props do SubmenuMover) + `:2263` (props do ItensMenuEmail) | ✅ **tipo compartilhado** |

### Os dois furos da minha análise

**1. Eu adiei a pergunta que o meu próprio critério fazia.** Sobre o `SubmenuMover` escrevi *"2 usos — decidir quando o seam dono for extraído"*. Mas o critério que eu mesmo enunciei é **"os usos caem em seams diferentes?"** — e responder isso era exatamente o trabalho. Ela foi ver de qual seam é cada uso; eu parei antes.

**2. Eu só medi símbolo de runtime.** Componentes e funções. **Não olhei tipos** — e `PastaDestino` é um tipo. Isso não é detalhe: **tipo compartilhado é justamente o que evita a referência circular** entre dois seams que trocam a mesma estrutura. Sem ele no módulo, o S3 importaria do control-room de volta, que é o ciclo que o enabler existe para não criar.

> **Emenda ao critério do §9:** *"compartilhado = usos em seams diferentes"* vale para **tipos também**, e o tipo costuma ser o membro **mais** necessário — ele é a fronteira que impede o ciclo, não só código reaproveitado.

### O que continua de pé

O corte que o §9 fez **sobrevive inteiro**: `DicaSomenteLeitura` (6 usos em 53 linhas), `descricaoErroEscrita` (10 usos em ~450 linhas), `PastaVazia` e `MultiSelecaoContexto` (1 uso cada) **ficaram fora** e descem com o seu seam. Dos 8 propostos originalmente, **3 entram e 5 saem** — não virou gaveta.

E os dois mortos (`AgendaVazia`/`AgendaErro`) já foram apagados no PR #1203, com a cascata que eu não tinha visto: `IlustracaoCalendario` e o import `CalendarClock` também eram órfãos. **−82 linhas.**
