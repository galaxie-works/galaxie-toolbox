import type { AppM365 } from "./apps.ts";
import {
  ORDEM_CATEGORIAS,
  type AppCatalogo,
  type CategoriaApp,
  type GrupoCategoria,
} from "./apps-catalog-core.ts";

/**
 * #827 (SU1): FONTE ÚNICA de apps do command. Funde o M365 curado (`apps.ts`,
 * rico: resumo/ícone Fluent/roteamento nativo) com o catálogo grande (`apps-catalog`,
 * ~1779 do scrape), numa taxonomia só (as 14 categorias do catálogo) e um render só.
 *
 * Lógica PURA (recebe as listas por parâmetro → sem import de JSON/alias `@/` no
 * runtime → node-testável). O `apps-unificado.ts` amarra os dados reais.
 */

/** Telas internas que o app JÁ faz nativo — o core M365 abre elas, não aba web. */
export type TelaNativa = "control-room" | "arquivos" | "agenda" | "people";

export interface AppUnificado {
  id: string;
  name: string;
  category: CategoriaApp;
  url: string;
  /** M365: URL do SVG Fluent (render direto). Catálogo: null → `<AppIcon id>` lazy. */
  fluentIcon: string | null;
  /** Subtítulo curto (só M365 curado). Catálogo: null. */
  resumo: Record<"pt-BR" | "en", string> | null;
  /** Se setado, abre a TELA INTERNA (gate no SU2), não uma aba web. */
  nativo: TelaNativa | null;
  /** Veio do M365 curado (o dedup canônico preferiu esta variante). */
  m365: boolean;
}

/** M365 curado (id) → UMA das 14 categorias do catálogo (taxonomia única). */
export const CATEGORIA_M365: Record<string, CategoriaApp> = {
  outlook: "Productivity",
  word: "Productivity",
  excel: "Productivity",
  powerpoint: "Productivity",
  onenote: "Productivity",
  onedrive: "Cloud Storage",
  teams: "Work and Business",
  sharepoint: "Cloud Storage",
  clipchamp: "Productivity",
  bookings: "Productivity",
  calendario: "Productivity",
  connections: "Work and Business",
  engage: "Work and Business",
  forms: "Productivity",
  insights: "Productivity",
  learning: "Learning",
  lists: "Productivity",
  loop: "Productivity",
  "power-pages": "Developer Tools",
  planner: "Productivity",
  "power-automate": "Developer Tools",
  "power-apps": "Developer Tools",
  sway: "Productivity",
  todo: "Productivity",
  visio: "Productivity",
  whiteboard: "Productivity",
  pessoas: "Productivity",
  admin: "Work and Business",
};

/** Core M365 que o app já faz nativo (#827 item 4) → abre a tela interna. */
export const NATIVO_M365: Record<string, TelaNativa> = {
  outlook: "control-room",
  onedrive: "arquivos",
  sharepoint: "arquivos",
  calendario: "agenda",
  pessoas: "people",
};

/**
 * Ids do catálogo Shift que DUPLICAM um app M365 curado — descartados na fusão
 * (o dedup canônico prefere a variante M365, com ícone Fluent + resumo + rota
 * nativa). Inclui a `outlook-web-app` (URL `/owa` relativa, quebrada) e a
 * `People`→Pessoas. NÃO inclui Viva Goals/Family Safety/Azure/Clarity/Copilot/
 * Vivaldi Webmail (sem equivalente curado — ficam).
 */
export const IDS_DUP_M365: ReadonlySet<string> = new Set([
  "outlook-mail",
  "outlook-web-app",
  "outlook-people",
  "outlook-calendar",
  "outlook-tasks",
  "microsoft-word",
  "microsoft-excel",
  "microsoft-powerpoint",
  "microsoft-onenote",
  "microsoft-teams",
  "microsoft-planner",
  "microsoft-forms",
  "microsoft-todo",
  "microsoft-sharepoint",
  "microsoft-power-automate",
  "microsoft-365-admin",
  "onedrive",
  "people",
  "clipchamp",
]);

function m365ParaUnificado(
  a: AppM365,
  resolverIcone: (a: AppM365) => string | undefined,
): AppUnificado {
  return {
    id: a.id,
    name: a.nome,
    category: CATEGORIA_M365[a.id] ?? "Productivity",
    url: a.url,
    fluentIcon: resolverIcone(a) ?? null,
    resumo: a.resumo,
    nativo: NATIVO_M365[a.id] ?? null,
    m365: true,
  };
}

function catalogoParaUnificado(a: AppCatalogo): AppUnificado {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    url: a.url,
    fluentIcon: null,
    resumo: null,
    nativo: null,
    m365: false,
  };
}

/**
 * Funde M365 curado + catálogo numa lista única. M365 primeiro (curadoria);
 * catálogo sem as duplicatas canônicas. `resolverIcone` mapeia o M365 pro SVG
 * Fluent (injetado pelo wrapper que tem acesso aos assets).
 */
export function unificar(
  m365: readonly AppM365[],
  catalogo: readonly AppCatalogo[],
  resolverIcone: (a: AppM365) => string | undefined,
): AppUnificado[] {
  return [
    ...m365.map((a) => m365ParaUnificado(a, resolverIcone)),
    ...catalogo
      .filter((a) => !IDS_DUP_M365.has(a.id))
      .map(catalogoParaUnificado),
  ];
}

/** Busca por nome OU categoria (lowercase). Vazio = todos. */
export function buscarUnificado(
  apps: readonly AppUnificado[],
  query: string,
): AppUnificado[] {
  const q = query.trim().toLowerCase();
  if (!q) return apps.slice();
  return apps.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q),
  );
}

/** Grupo de apps de uma categoria (mesma forma do catálogo, com AppUnificado). */
export interface GrupoUnificado extends Omit<GrupoCategoria, "apps"> {
  apps: AppUnificado[];
}

/** Agrupa por categoria na ordem canônica das 14. `filtro` opcional restringe. */
export function agruparUnificado(
  apps: readonly AppUnificado[],
  filtro?: string,
): GrupoUnificado[] {
  const base = filtro ? buscarUnificado(apps, filtro) : apps;
  const porCat = new Map<CategoriaApp, AppUnificado[]>();
  for (const app of base) {
    const lista = porCat.get(app.category);
    if (lista) lista.push(app);
    else porCat.set(app.category, [app]);
  }
  const grupos: GrupoUnificado[] = [];
  for (const categoria of ORDEM_CATEGORIAS) {
    const lista = porCat.get(categoria);
    if (lista && lista.length) grupos.push({ categoria, apps: lista });
  }
  return grupos;
}
