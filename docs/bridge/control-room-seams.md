# Fatiamento do `control-room.tsx` — desenho dos seams

> **Desenho de arquitetura (#1019, épico #1007, auditoria #994).** Altair desenha,
> Vega executa. Medido em `46ede70`: `src/screens/control-room.tsx` = **7.692
> linhas**, 39 `useState`, 34 `useEffect`, 25 `useMemo`, 7 `useCallback`, **zero
> `React.memo`**, e 14 `useRef` só no componente de tela.
>
> Todas as faixas de linha abaixo foram conferidas no arquivo.

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
