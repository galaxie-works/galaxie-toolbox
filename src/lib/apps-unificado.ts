import { APPS, urlIcone } from "@/lib/apps";
import { APPS_CATALOGO } from "@/lib/apps-catalog";
import {
  agruparUnificado,
  unificar,
  type AppUnificado,
  type GrupoUnificado,
} from "@/lib/apps-unificado-core";

/**
 * #827 (SU1): a FONTE ÚNICA de apps do command, materializada. Amarra o M365
 * curado (`APPS` + ícones Fluent via `urlIcone`) e o catálogo (`APPS_CATALOGO`)
 * na lógica pura do `apps-unificado-core`. É o que o `navegador.tsx` renderiza —
 * uma lista, uma taxonomia (14 categorias), um componente de item.
 */

export type {
  AppUnificado,
  GrupoUnificado,
  TelaNativa,
} from "@/lib/apps-unificado-core";

/** Lista única (M365 curado primeiro, catálogo sem as duplicatas canônicas). */
export const APPS_UNIFICADOS: readonly AppUnificado[] = unificar(
  APPS,
  APPS_CATALOGO,
  urlIcone,
);

/** Agrupa a lista única por categoria (ordem canônica). `filtro` = busca opcional. */
export function appsUnificadosPorCategoria(filtro?: string): GrupoUnificado[] {
  return agruparUnificado(APPS_UNIFICADOS, filtro);
}
