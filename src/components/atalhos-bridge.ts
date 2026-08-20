import type { ShortcutDefinition } from "@/components/ui/shortcut";
import type { Dicionario } from "@/lib/strings";

/**
 * #1060 (UX7/UX18): catálogo CENTRAL dos atalhos de teclado do Bridge — fonte
 * ÚNICA, espelhando o padrão do Explorer (`explorer/atalhos.ts`). Antes a ajuda
 * (`atalhos-ajuda.tsx`) era uma lista mantida à mão que divergia da realidade
 * (listava `/`… e OMITIA o `F`/Filtro). Agora TANTO a ajuda ("?") QUANTO os
 * tooltips das ações icon-only (via `ShortcutDefinition`) leem daqui, e um teste
 * de cross-check (`lumen-1060-atalhos-bridge-cross-check.test.ts`) reprova
 * qualquer atalho do catálogo sem handler real.
 *
 * Módulo PURO (só `import type`) — stripado no `node --test`, testável/reusável.
 *
 * `combos` = alternativas equivalentes de EXIBIÇÃO (cada combo é a sequência de
 * teclas na ordem mostrada). `fonte` diz ONDE o combo é cabeado, e é o que o
 * cross-check usa pra saber onde procurar o handler:
 *  - "central"  → o `aoTeclar` global do `control-room` (a maioria);
 *  - "filters"  → o listener próprio do `<Filters enableShortcut>` (reui) — o
 *                 `F`/Filtro (tecla única, sem passar pelo `aoTeclar`);
 *  - "editor"   → keymap DENTRO do editor de e-mail (contenteditable) — o
 *                 keymap central não alcança (Ctrl+K link, Ctrl+Shift+L lista);
 *  - "nativo"   → gesto de mouse (Shift+clique) — não é `e.key`.
 */

export type CategoriaAtalhoBridge =
  | "navegacao"
  | "selecao"
  | "acoes"
  | "formatacao"
  | "geral";

export type FonteAtalhoBridge = "central" | "filters" | "editor" | "nativo";

export interface AtalhoBridge {
  id: string;
  categoria: CategoriaAtalhoBridge;
  /** Alternativas equivalentes; cada uma é uma sequência de teclas (exibição). */
  combos: string[][];
  /** Chave i18n do rótulo (em `t.controlRoom`). */
  rotulo: keyof Dicionario["controlRoom"];
  /** Onde o atalho é cabeado (guia o cross-check). */
  fonte: FonteAtalhoBridge;
  /**
   * Definição pro tooltip/aria-label das ações icon-only (`ShortcutTooltip` /
   * `shortcutAccessibleLabel`). Presente só onde há um botão com dica — é o que
   * faz os TOOLTIPS consumirem o mesmo catálogo da ajuda.
   */
  shortcut?: ShortcutDefinition;
}

/** Ordem de exibição das categorias na ajuda. */
export const ORDEM_CATEGORIAS_BRIDGE: readonly CategoriaAtalhoBridge[] = [
  "navegacao",
  "selecao",
  "acoes",
  "formatacao",
  "geral",
];

/** Título i18n de cada categoria (em `t.controlRoom`). */
export const TITULO_CATEGORIA_BRIDGE: Record<
  CategoriaAtalhoBridge,
  keyof Dicionario["controlRoom"]
> = {
  navegacao: "atalhosCatNavegacao",
  selecao: "atalhosCatSelecao",
  acoes: "atalhosCatAcoes",
  formatacao: "atalhosCatFormatacao",
  geral: "atalhosCatGeral",
};

export const ATALHOS_BRIDGE: readonly AtalhoBridge[] = [
  // Navegação
  { id: "navegar", categoria: "navegacao", combos: [["↑", "↓"], ["j", "k"]], rotulo: "atalhosNavegar", fonte: "central" },
  { id: "buscar", categoria: "navegacao", combos: [["/"]], rotulo: "atalhosBuscar", fonte: "central" },
  { id: "atualizar", categoria: "navegacao", combos: [["F9"]], rotulo: "atalhosAtualizar", fonte: "central", shortcut: { key: "F9" } },
  { id: "ordenar", categoria: "navegacao", combos: [["O"]], rotulo: "atalhosOrdenar", fonte: "central", shortcut: { key: "O" } },
  // Seleção
  { id: "selecionarTudo", categoria: "selecao", combos: [["Ctrl", "A"]], rotulo: "atalhosSelecionarTudo", fonte: "central", shortcut: { key: "A", primary: true } },
  { id: "intervalo", categoria: "selecao", combos: [["Shift", "Clique"]], rotulo: "atalhosIntervalo", fonte: "nativo" },
  { id: "marcarItem", categoria: "selecao", combos: [["x"]], rotulo: "atalhosMarcarItem", fonte: "central" },
  { id: "limparSelecao", categoria: "selecao", combos: [["Esc"]], rotulo: "atalhosLimpar", fonte: "central", shortcut: { key: "Esc" } },
  // Ações
  { id: "responder", categoria: "acoes", combos: [["Ctrl", "R"]], rotulo: "atalhosResponder", fonte: "central", shortcut: { key: "R", primary: true } },
  { id: "responderTodos", categoria: "acoes", combos: [["Ctrl", "Shift", "R"]], rotulo: "atalhosResponderTodos", fonte: "central", shortcut: { key: "R", primary: true, shift: true } },
  { id: "encaminhar", categoria: "acoes", combos: [["Ctrl", "Shift", "F"]], rotulo: "atalhosEncaminhar", fonte: "central", shortcut: { key: "F", primary: true, shift: true } },
  // #538/#1060: o Filtro tem atalho de TECLA ÚNICA (F), cabeado no listener do
  // `<Filters enableShortcut shortcutKey="f">` (reui), NÃO no `aoTeclar`. Estava
  // ausente da ajuda — o achado UX18. Rótulo reusa `filtroLabel`.
  { id: "filtro", categoria: "acoes", combos: [["F"]], rotulo: "filtroLabel", fonte: "filters", shortcut: { key: "F" } },
  { id: "compor", categoria: "acoes", combos: [["c"]], rotulo: "atalhosCompor", fonte: "central", shortcut: { key: "C" } },
  { id: "lidoNaoLido", categoria: "acoes", combos: [["u"]], rotulo: "atalhosLidoNaoLido", fonte: "central", shortcut: { key: "U" } },
  { id: "sinalizar", categoria: "acoes", combos: [["s"]], rotulo: "atalhosSinalizar", fonte: "central", shortcut: { key: "S" } },
  { id: "salvarComo", categoria: "acoes", combos: [["F12"]], rotulo: "atalhosSalvarComo", fonte: "central", shortcut: { key: "F12" } },
  { id: "imprimir", categoria: "acoes", combos: [["Ctrl", "P"]], rotulo: "atalhosImprimir", fonte: "central", shortcut: { key: "P", primary: true } },
  { id: "excluir", categoria: "acoes", combos: [["Del"]], rotulo: "atalhosExcluir", fonte: "central", shortcut: { key: "Delete" } },
  { id: "fecharPreview", categoria: "acoes", combos: [["Esc"]], rotulo: "atalhosFecharPreview", fonte: "central", shortcut: { key: "Esc" } },
  // Formatação — só DENTRO do editor de e-mail (contenteditable); o keymap
  // central não os alcança (por isso `fonte: "editor"`, fora do cross-check).
  { id: "link", categoria: "formatacao", combos: [["Ctrl", "K"]], rotulo: "atalhosLink", fonte: "editor" },
  { id: "lista", categoria: "formatacao", combos: [["Ctrl", "Shift", "L"]], rotulo: "atalhosLista", fonte: "editor" },
  // Geral
  { id: "ajuda", categoria: "geral", combos: [["?"]], rotulo: "atalhosAjuda", fonte: "central" },
];

/** Um combo formatado pra exibição: `["Ctrl","C"]` → "Ctrl+C". */
export function formatarComboBridge(combo: string[]): string {
  return combo.join("+");
}

/** Um atalho por id (pro tooltip da própria ação e testes). */
export function atalhoBridgePorId(id: string): AtalhoBridge | undefined {
  return ATALHOS_BRIDGE.find((a) => a.id === id);
}

/**
 * `ShortcutDefinition` de um atalho do catálogo — fonte única dos tooltips/
 * aria-labels das ações icon-only do Bridge. Lança se o id não tiver `shortcut`
 * (erro de programação: pediram tooltip de algo que não é ação com botão).
 */
export function shortcutBridge(id: string): ShortcutDefinition {
  const a = atalhoBridgePorId(id);
  if (!a?.shortcut) {
    throw new Error(`atalhos-bridge: id "${id}" não tem ShortcutDefinition`);
  }
  return a.shortcut;
}

/** Atalhos de uma categoria, na ordem de definição. */
export function atalhosBridgeDe(categoria: CategoriaAtalhoBridge): AtalhoBridge[] {
  return ATALHOS_BRIDGE.filter((a) => a.categoria === categoria);
}

// #1019: atalhos usados por MAIS DE UM seam do Bridge (a lista de mensagens e
// a tela). Moram aqui, e não num dos dois, porque este é o catálogo — e
// porque um `.tsx` de componente que exporta constantes acende o
// `react(only-export-components)`, warning novo num repo com catraca (#1056).
export const ATALHO_SINALIZAR = shortcutBridge("sinalizar");
export const ATALHO_EXCLUIR = shortcutBridge("excluir");
export const ATALHO_LER_NAO_LIDO = shortcutBridge("lidoNaoLido");
export const ATALHO_RESPONDER = shortcutBridge("responder");
export const ATALHO_RESPONDER_TODOS = shortcutBridge("responderTodos");
export const ATALHO_ENCAMINHAR = shortcutBridge("encaminhar");
export const ATALHO_FECHAR_PREVIEW = shortcutBridge("fecharPreview");
export const ATALHO_SALVAR_COMO = shortcutBridge("salvarComo");
export const ATALHO_IMPRIMIR = shortcutBridge("imprimir");
