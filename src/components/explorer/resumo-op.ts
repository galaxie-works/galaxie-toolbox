// #898 (fatia 2): quando uma op de copy/move TERMINA (success/error/canceled/
// partial), a linha dela na activity-dropdown vira um RESUMO imutável e legível —
// o "histórico de sessão". Este helper é PURO (sem React) e testável por
// `node --test`: recebe a op terminal + os rótulos i18n já resolvidos e devolve
// `{ titulo, subtitulo }`. Só as linhas TERMINAIS usam isto; as ATIVAS seguem com
// o render de sempre (controles + arquivo atual).
// Import relativo (com `.ts`, padrao do repo — ver `operacao.ts`/`caminho.ts`):
// o gate roda este helper por `node --test`, que NAO resolve o alias `@/`. O
// `formatBytes` continua sendo o util PURO de sempre (sem React).
import { formatBytes } from "../../lib/utils.ts";

import type { OpAtiva } from "./progresso-panel";

/** Os textos i18n de que o resumo precisa (montados no componente a partir de
 *  `t.arquivos.*`). Participios em pt flexionam em numero, por isso ha forma
 *  singular e plural separadas por tipo. */
export interface RotulosResumo {
  /** Sucesso de copia — plural ("Copiados {n} {arq}") e singular ("Copiado {n} {arq}"). */
  copiados: string;
  copiadoUm: string;
  /** Sucesso de mover — plural ("Movidos {n} {arq}") e singular ("Movido {n} {arq}"). */
  movidos: string;
  movidoUm: string;
  /** Cancelamento por tipo ("Cancelado: copia de {n} {arq}" / "... movimentacao de ..."). */
  canceladoCopia: string;
  canceladoMove: string;
  /** Falha por tipo ("Falha ao copiar {n} {arq}" / "Falha ao mover {n} {arq}"). */
  falhaCopia: string;
  falhaMove: string;
  /** Parcial ("Parcial: {done} de {total} {arq}") — o prefixo ja vem na string. */
  parcial: string;
  /** Subtitulo de destino ("→ {destino}"). */
  paraDestino: string;
  /** Substantivo do arquivo: singular vs plural (troca por numero). */
  arquivoUm: string;
  arquivos: string;
}

/** `preencher`-like local (mantem o helper puro, sem depender do `.tsx` do idioma). */
function preencher(
  texto: string,
  valores: Record<string, string | number>,
): string {
  return texto.replace(/\{(\w+)\}/g, (bruto, chave) => {
    const v = valores[chave];
    return v == null ? bruto : String(v);
  });
}

/**
 * Monta o resumo imutavel de uma op TERMINAL para a activity-dropdown.
 *
 * - Contagem: `filesTotal` para success/canceled/error; para partial usa
 *   `filesDone` de `filesTotal`. Se `filesTotal` for 0, o substantivo cai no
 *   plural ("arquivos").
 * - Singular/plural: o substantivo e o participio (em pt) trocam por `n === 1`.
 * - Subtitulo: preferimos o destino ("→ {destino}"); sem destino, cai no total
 *   de bytes processados (`formatBytes`).
 * - Status ativo (inProgress/paused) nao deveria chegar aqui; devolve um fallback
 *   coerente (o proprio substantivo) so pra manter a funcao total.
 */
export function montarResumoOp(
  op: OpAtiva,
  r: RotulosResumo,
): { titulo: string; subtitulo: string } {
  const p = op.progresso;
  const total = p.filesTotal;
  const done = p.filesDone;

  // Substantivo por numero (guard: 0 → plural).
  const substantivo = (n: number) => (n === 1 ? r.arquivoUm : r.arquivos);

  const subtitulo =
    op.destino && op.destino.length > 0
      ? preencher(r.paraDestino, { destino: op.destino })
      : formatBytes(p.processedBytes);

  const arq = substantivo(total);

  let titulo: string;
  switch (p.status) {
    case "success":
      if (op.tipo === "copy") {
        titulo = preencher(total === 1 ? r.copiadoUm : r.copiados, {
          n: total,
          arq,
        });
      } else {
        titulo = preencher(total === 1 ? r.movidoUm : r.movidos, {
          n: total,
          arq,
        });
      }
      break;
    case "canceled":
      titulo = preencher(
        op.tipo === "copy" ? r.canceladoCopia : r.canceladoMove,
        { n: total, arq },
      );
      break;
    case "error":
      titulo = preencher(op.tipo === "copy" ? r.falhaCopia : r.falhaMove, {
        n: total,
        arq,
      });
      break;
    case "partial":
      titulo = preencher(r.parcial, {
        done,
        total,
        arq: substantivo(total),
      });
      break;
    default:
      // Status ativo (nao usado) — fallback coerente pra manter a funcao total.
      titulo = arq;
      break;
  }

  return { titulo, subtitulo };
}
