// #678: modelo de seleção do painel de conteúdo — âncora + faixa (range) sobre a
// ORDEM VISÍVEL (array de caminhos já ordenado). Puro/testável de propósito (sem
// React, sem alias de import), pra o `node --test` carregar direto. A regra de
// ouro é a do Explorer do Windows: shift sempre estende a faixa a partir da
// ÂNCORA (não do último clique), então recomputa do zero a cada shift — encolher
// a faixa voltando em direção à âncora funciona naturalmente.

export interface EstadoSelecao {
  /** Caminhos selecionados (chave = FsEntry.path). */
  selecionados: Set<string>;
  /** Início da faixa: onde o shift ancora. Null quando nada foi selecionado. */
  ancora: string | null;
  /** Foco do teclado / último item tocado. */
  cursor: string | null;
}

export const SELECAO_VAZIA: EstadoSelecao = {
  selecionados: new Set<string>(),
  ancora: null,
  cursor: null,
};

function dentro(paths: string[], index: number): boolean {
  return index >= 0 && index < paths.length;
}

/**
 * Clique simples (ou seta sem modificador): seleciona só o item, e ele vira
 * âncora e cursor.
 */
export function selecionarUnico(paths: string[], index: number): EstadoSelecao {
  if (!dentro(paths, index)) return SELECAO_VAZIA;
  const path = paths[index];
  return { selecionados: new Set([path]), ancora: path, cursor: path };
}

/**
 * Ctrl/Cmd+clique: alterna o item na seleção e MOVE a âncora pra ele (o próximo
 * shift passa a ancorar aqui). Cursor também vai pro item.
 */
export function alternar(
  estado: EstadoSelecao,
  paths: string[],
  index: number,
): EstadoSelecao {
  if (!dentro(paths, index)) return estado;
  const path = paths[index];
  const selecionados = new Set(estado.selecionados);
  if (selecionados.has(path)) selecionados.delete(path);
  else selecionados.add(path);
  return { selecionados, ancora: path, cursor: path };
}

/**
 * Shift+clique e Shift+seta: seleciona a FAIXA [âncora … index] (inclusive),
 * mantendo a âncora e levando o cursor pro item clicado. Sem âncora prévia,
 * degrada pra seleção única (e ancora ali). Substitui a seleção pela faixa
 * (comportamento do Explorer; ctrl+shift aditivo fica pra outra story).
 */
export function selecionarFaixa(
  estado: EstadoSelecao,
  paths: string[],
  index: number,
): EstadoSelecao {
  if (!dentro(paths, index)) return estado;
  if (estado.ancora === null) return selecionarUnico(paths, index);
  const a = paths.indexOf(estado.ancora);
  if (a < 0) return selecionarUnico(paths, index);
  const lo = Math.min(a, index);
  const hi = Math.max(a, index);
  const selecionados = new Set(paths.slice(lo, hi + 1));
  return { selecionados, ancora: estado.ancora, cursor: paths[index] };
}

/**
 * #748 (marquee): aplica a seleção do retângulo de arrasto. `indices` = itens
 * sob o retângulo, na ORDEM VISÍVEL (ascendente). `base` = seleção de ANTES do
 * arrasto — no modo `aditivo` (Ctrl/Shift durante o drag) o retângulo SOMA à
 * base em vez de substituir; senão, a seleção passa a ser só o retângulo. Âncora
 * vai pro 1º item do retângulo (ou preserva a da base, no aditivo); cursor vai
 * pro último. Retângulo vazio + não-aditivo → limpa (clique-arrasto no vazio).
 */
export function selecionarRetangulo(
  base: EstadoSelecao,
  paths: string[],
  indices: number[],
  opts?: { aditivo?: boolean },
): EstadoSelecao {
  const aditivo = opts?.aditivo ?? false;
  const selecionados = aditivo
    ? new Set(base.selecionados)
    : new Set<string>();
  let primeiro: string | null = null;
  let ultimo: string | null = null;
  for (const i of indices) {
    if (!dentro(paths, i)) continue;
    const path = paths[i];
    selecionados.add(path);
    if (primeiro === null) primeiro = path;
    ultimo = path;
  }
  return {
    selecionados,
    ancora: aditivo ? (base.ancora ?? primeiro) : primeiro,
    cursor: ultimo ?? (aditivo ? base.cursor : null),
  };
}

/** Seleção total (Ctrl+A): todos entram; âncora/cursor no primeiro item. */
export function selecionarTudo(
  paths: string[],
  estado: EstadoSelecao,
): EstadoSelecao {
  if (paths.length === 0) return SELECAO_VAZIA;
  return {
    selecionados: new Set(paths),
    ancora: paths[0],
    cursor: estado.cursor ?? paths[0],
  };
}
