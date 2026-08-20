// #1282: tipo de uma op da central de atividades + a tradução do `opKind` que o
// backend manda no evento de progresso. PURO (sem React), pra o gate rodar por
// `node --test` e pra o arquivo de componente (`progresso-panel.tsx`) não
// exportar não-componentes (lint only-export-components).

/** Tipo da op na central. "undo" veio com a metade BE (op_kind:"undo", PR #1377)
 *  — antes o undo caía no `?? "copy"` e MENTIA como cópia. */
export type TipoOp = "copy" | "move" | "undo";

/**
 * Traduz o `opKind` do backend (string do evento `fs-op-progress`) pro tipo da
 * UI. Valor conhecido → o próprio; desconhecido → `null` (o chamador cai no
 * bookkeeping do cliente / `"copy"`). É a fonte AUTORITATIVA do tipo: o payload
 * hoje carrega `opKind`, então o undo deixa de herdar "copy" por omissão.
 */
export function tipoDoEvento(opKind: string): TipoOp | null {
  return opKind === "undo" || opKind === "copy" || opKind === "move"
    ? opKind
    : null;
}
