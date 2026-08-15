// #898 (fatia 3 / #966): contador de atividades NÃO VISTAS no sino da
// activity-dropdown. "Não vista" = op que surgiu (por opId) DESDE a última vez
// que o painel foi aberto. Abrir o painel marca todas as ops atuais como vistas
// (o contador zera); ops novas que chegam com o painel fechado voltam a contar.
// Lógica PURA (sem React) — o componente guarda o conjunto de vistos em estado e
// chama estes helpers; testável por `node --test`.
import type { OpAtiva } from "./progresso-panel";

/** Quantas ops atuais AINDA não foram vistas (opId fora do conjunto `vistos`). */
export function calcularNaoVistas(
  ops: readonly OpAtiva[],
  vistos: ReadonlySet<number>,
): number {
  let n = 0;
  for (const op of ops) if (!vistos.has(op.opId)) n++;
  return n;
}

/** Conjunto "tudo visto agora": os opIds de todas as ops atuais. Usado quando o
 *  painel abre (ou enquanto está aberto) pra marcar o estado como visto. */
export function marcarTodasVistas(ops: readonly OpAtiva[]): Set<number> {
  return new Set(ops.map((o) => o.opId));
}
