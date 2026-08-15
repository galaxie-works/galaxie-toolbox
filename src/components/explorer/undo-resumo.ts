// #967 (#898 fatia 4): helpers PUROS do resumo de undo — agrupam o UndoPlan nos
// 3 baldes (seguros/pulados/não-reversíveis) e mapeiam o CÓDIGO de motivo pra
// copy i18n. Sem React de propósito: funções puras, testáveis por `node --test`.
// Imports RELATIVOS com `.ts` (o node --test do CI não resolve o alias `@/`).
import type { UndoItemPlan, UndoMotivo, UndoPlan } from "../../lib/types.ts";

/** Os 3 baldes do preview de undo (mesma classificação de `UndoItemPlan.estado`). */
export interface BaldesUndo {
  seguros: UndoItemPlan[];
  pulados: UndoItemPlan[];
  naoReversiveis: UndoItemPlan[];
}

/**
 * Agrupa `plan.itens` por `estado` nos 3 baldes. Preserva a ordem original de
 * cada balde. Item com `estado` inesperado é ignorado (defensivo).
 */
export function agruparUndo(plan: UndoPlan): BaldesUndo {
  const baldes: BaldesUndo = { seguros: [], pulados: [], naoReversiveis: [] };
  for (const item of plan.itens) {
    if (item.estado === "seguro") baldes.seguros.push(item);
    else if (item.estado === "pulado") baldes.pulados.push(item);
    else if (item.estado === "naoReversivel") baldes.naoReversiveis.push(item);
  }
  return baldes;
}

/** Rótulos i18n dos 4 códigos de motivo (o front injeta a copy do idioma). */
export interface RotulosMotivo {
  sumiu: string;
  modificado: string;
  origemReocupada: string;
  sobrescrita: string;
}

/**
 * Mapeia o CÓDIGO de motivo → rótulo i18n. `null`/`undefined` (item seguro não
 * carrega motivo) → "". Nunca renderiza o código cru.
 */
export function rotuloMotivo(
  motivo: UndoMotivo | null | undefined,
  rotulos: RotulosMotivo,
): string {
  if (!motivo) return "";
  return rotulos[motivo];
}
