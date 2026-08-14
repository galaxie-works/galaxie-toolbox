import catalogoRaw from "@/assets/apps-catalog.json";
import {
  agrupar,
  buscar,
  type AppCatalogo,
  type GrupoCategoria,
} from "@/lib/apps-catalog-core";

/**
 * #720 (SH2 · épico #717 GALAXIE Shell): catálogo de apps do command (~1795),
 * categorizado. Os dados vêm de `src/assets/apps-catalog.json` (commitado) e os
 * ícones de `public/app-icons/<id>.svg` (estáticos, ver `AppIcon`).
 *
 * Este arquivo só AMARRA o JSON grande nas funções puras do `apps-catalog-core`
 * (que é o que os testes exercitam). A UI do command (integração no
 * `navegador.tsx`) espera o SH1 do Vega — aqui é só a camada de dados/assets.
 */

export type { AppCatalogo, CategoriaApp, GrupoCategoria } from "@/lib/apps-catalog-core";
export { ORDEM_CATEGORIAS, chaveCategoria } from "@/lib/apps-catalog-core";

/** O catálogo inteiro (imutável), já tipado. */
export const APPS_CATALOGO: readonly AppCatalogo[] =
  catalogoRaw as AppCatalogo[];

/** Agrupa o catálogo por categoria (ordem canônica). `filtro` = busca opcional. */
export function appsPorCategoria(filtro?: string): GrupoCategoria[] {
  return agrupar(APPS_CATALOGO, filtro);
}

/** Busca no catálogo inteiro por nome/categoria. Vazio = catálogo inteiro. */
export function buscarApps(query: string): AppCatalogo[] {
  return buscar(APPS_CATALOGO, query);
}
