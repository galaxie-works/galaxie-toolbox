import type { Dicionario } from "@/lib/strings";

/**
 * #733: catálogo CENTRAL dos atalhos de teclado do Explorer — fonte única (não
 * hardcoded espalhado). O handler de teclas (`aoTeclar` no content-pane) e a
 * legenda/tooltip consomem daqui. Módulo PURO (só `import type`, stripado no
 * `node --test`) — testável e reusável.
 *
 * `combos` = alternativas equivalentes (ex.: Voltar = Alt+← OU Backspace). Cada
 * combo é a lista de teclas na ordem de exibição. Teclas especiais usam os nomes
 * canônicos ("Ctrl","Shift","Alt","Enter","Esc","Del","F2"...,"↑","←","→","↓",
 * "Home","End", "Clique"/"Arrastar" pros combos com mouse).
 */

export type CategoriaAtalho =
  | "navegacao"
  | "selecao"
  | "operacoes"
  | "visualizacao";

export interface Atalho {
  id: string;
  categoria: CategoriaAtalho;
  /** Alternativas equivalentes; cada uma é uma sequência de teclas. */
  combos: string[][];
  /** Chave i18n do rótulo (em `t.atalhos`). */
  rotulo: keyof Dicionario["atalhos"];
}

/** Ordem de exibição das categorias na legenda. */
export const ORDEM_CATEGORIAS_ATALHO: readonly CategoriaAtalho[] = [
  "navegacao",
  "selecao",
  "operacoes",
  "visualizacao",
];

export const ATALHOS: readonly Atalho[] = [
  // Navegação
  { id: "abrir", categoria: "navegacao", combos: [["Enter"]], rotulo: "abrir" },
  { id: "voltar", categoria: "navegacao", combos: [["Alt", "←"], ["Backspace"]], rotulo: "voltar" },
  { id: "avancar", categoria: "navegacao", combos: [["Alt", "→"]], rotulo: "avancar" },
  { id: "pastaAcima", categoria: "navegacao", combos: [["Alt", "↑"]], rotulo: "pastaAcima" },
  { id: "mover", categoria: "navegacao", combos: [["↑"], ["↓"], ["←"], ["→"]], rotulo: "mover" },
  { id: "extremos", categoria: "navegacao", combos: [["Home"], ["End"]], rotulo: "extremos" },
  // Seleção
  { id: "selecionarTudo", categoria: "selecao", combos: [["Ctrl", "A"]], rotulo: "selecionarTudo" },
  { id: "alternarItem", categoria: "selecao", combos: [["Ctrl", "Clique"]], rotulo: "alternarItem" },
  { id: "intervalo", categoria: "selecao", combos: [["Shift", "Clique"], ["Shift", "←/→/↑/↓"]], rotulo: "intervalo" },
  { id: "limparSelecao", categoria: "selecao", combos: [["Esc"]], rotulo: "limparSelecao" },
  // Operações
  { id: "renomear", categoria: "operacoes", combos: [["F2"]], rotulo: "renomear" },
  { id: "lixeira", categoria: "operacoes", combos: [["Del"]], rotulo: "lixeira" },
  { id: "excluirPerm", categoria: "operacoes", combos: [["Shift", "Del"]], rotulo: "excluirPerm" },
  { id: "copiar", categoria: "operacoes", combos: [["Ctrl", "C"]], rotulo: "copiar" },
  { id: "recortar", categoria: "operacoes", combos: [["Ctrl", "X"]], rotulo: "recortar" },
  { id: "colar", categoria: "operacoes", combos: [["Ctrl", "V"]], rotulo: "colar" },
  { id: "novaPasta", categoria: "operacoes", combos: [["Ctrl", "Shift", "N"]], rotulo: "novaPasta" },
  { id: "atualizar", categoria: "operacoes", combos: [["F5"]], rotulo: "atualizar" },
  // Visualização
  { id: "verDetalhes", categoria: "visualizacao", combos: [["Ctrl", "1"]], rotulo: "verDetalhes" },
  { id: "verLista", categoria: "visualizacao", combos: [["Ctrl", "2"]], rotulo: "verLista" },
  { id: "verGrade", categoria: "visualizacao", combos: [["Ctrl", "3"]], rotulo: "verGrade" },
  { id: "ocultos", categoria: "visualizacao", combos: [["Ctrl", "H"]], rotulo: "ocultos" },
  { id: "filtro", categoria: "visualizacao", combos: [["Ctrl", "F"]], rotulo: "filtro" },
  // #950 (audit de consistência): abrir/fechar o painel de detalhes (Alt+P, à
  // moda do Explorer do Windows). A ação já existe (`onToggleInspector`); faltava
  // só o atalho + tooltip.
  { id: "preview", categoria: "visualizacao", combos: [["Alt", "P"]], rotulo: "preview" },
  // #968: foco na busca recursiva (Ctrl+E, à moda do Explorer do Windows). O
  // Ctrl+F fica com o FILTRO in-folder; o Ctrl+E com a BUSCA recursiva da navbar.
  { id: "focoBusca", categoria: "visualizacao", combos: [["Ctrl", "E"]], rotulo: "focoBusca" },
];

/** Um combo formatado pra exibição: `["Ctrl","C"]` → "Ctrl+C". */
export function formatarCombo(combo: string[]): string {
  return combo.join("+");
}

/** Um atalho por id (pro tooltip da própria ação mostrar o `<kbd>`, #733 rework). */
export function atalhoPorId(id: string): Atalho | undefined {
  return ATALHOS.find((a) => a.id === id);
}

/** Atalhos de uma categoria, na ordem de definição. */
export function atalhosDe(categoria: CategoriaAtalho): Atalho[] {
  return ATALHOS.filter((a) => a.categoria === categoria);
}
