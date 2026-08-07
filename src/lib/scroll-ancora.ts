// #611: scroll-anchoring ao prepender e-mail novo na lista virtualizada+agrupada.
//
// Quando o poll do #603 detecta e-mail novo e o usuário está vendo a inbox
// própria, os novos são PREPENDADOS no topo da lista (`setMensagens`). Numa
// lista virtualizada, prepender no índice 0 empurra o `start` (offset absoluto)
// de TODAS as linhas existentes pra baixo pela soma das alturas dos novos — mas
// o `scrollTop` do container não muda, então o conteúdo visível "pula" pra
// baixo. Pra manter o mesmo conteúdo em vista, compensamos o `scrollTop` pela
// diferença de offset de uma linha-ÂNCORA (a primeira mensagem visível, id
// estável) entre o commit anterior e o atual.
//
// Esta é a matemática pura (sem DOM/virtualizer), pra ser testável no
// `node --test`. A cola com o virtualizer/`listaRef` vive no MessageList.

/** Snapshot de uma linha-âncora num commit: id estável da mensagem, seu offset
 * absoluto (`start`) na lista virtual e o `scrollTop` do container naquele
 * momento. */
export type Ancora = { id: string; start: number; scrollTop: number };

/**
 * Novo `scrollTop` pra manter a âncora fixa no viewport após um prepend — ou
 * `null` quando não há nada a compensar.
 *
 * Retorna `null` se:
 * - não há âncora do commit anterior (1º render / troca de lista);
 * - o usuário está no topo (`noTopo`) — aí deixamos o e-mail novo aparecer;
 * - a âncora sumiu da lista atual (`startAtual` indefinido — ex.: troca de
 *   pasta, lista recarregada com outros ids);
 * - a âncora NÃO desceu (`delta <= 0`) — ou seja, não houve prepend acima dela
 *   (lista encolheu/estável; esse caso é tratado por outro efeito).
 *
 * Quando há prepend acima da âncora (`delta > 0`), o novo `scrollTop` é o antigo
 * somado ao deslocamento, cancelando exatamente o "pulo". Como `start` vem do
 * próprio virtualizer (mesmas estimativas), a compensação é exata mesmo com
 * linhas prependadas ainda não medidas.
 */
export function scrollTopReancorado(
  ancora: Ancora | null,
  startAtual: number | undefined,
  opts: { noTopo: boolean },
): number | null {
  if (!ancora || opts.noTopo) return null;
  if (startAtual === undefined) return null;
  const delta = startAtual - ancora.start;
  if (delta <= 0) return null;
  return ancora.scrollTop + delta;
}
