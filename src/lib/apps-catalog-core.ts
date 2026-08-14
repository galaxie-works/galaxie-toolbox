import type { Dicionario } from "@/lib/strings";

/**
 * #720 (SH2): lógica PURA do catálogo de apps (agrupar/buscar/rótulos), sem o
 * import do JSON grande — pra dar pra testar com `node --test` (o `@/` e o import
 * de JSON não resolvem lá; aqui só entra `import type`, que é stripado). O
 * `apps-catalog.ts` amarra os dados reais nestas funções.
 */

export interface AppCatalogo {
  id: string;
  name: string;
  category: CategoriaApp;
  url: string;
  /** Tem ícone local em `public/app-icons/<id>.svg`? */
  icon: boolean;
}

/** Categorias canônicas do catálogo (as strings vêm do JSON de origem). */
export type CategoriaApp =
  // #877: categoria sintética das telas próprias do GALAXIE (Bridge/Files/Remote),
  // sempre em 1º no command — NÃO vem do JSON do scrape.
  | "From GALAXIE"
  | "AI Tools"
  | "Banking and Finance"
  | "Cloud Storage"
  | "Developer Tools"
  | "Entertainment"
  | "Health and Fitness"
  | "Learning"
  | "News and Weather"
  | "Productivity"
  | "Shopping"
  | "Social"
  | "Travel"
  | "Work and Business"
  | "Miscellaneous";

/** Ordem de exibição das categorias no command. */
export const ORDEM_CATEGORIAS: readonly CategoriaApp[] = [
  "From GALAXIE", // #877: sempre primeiro
  "AI Tools",
  "Productivity",
  "Work and Business",
  "Developer Tools",
  "Cloud Storage",
  "Social",
  "Entertainment",
  "Shopping",
  "Banking and Finance",
  "News and Weather",
  "Learning",
  "Health and Fitness",
  "Travel",
  "Miscellaneous",
];

/** Chave de i18n (em `t.command`) do rótulo de cada categoria. */
const CHAVE_CATEGORIA: Record<CategoriaApp, keyof Dicionario["command"]> = {
  "From GALAXIE": "catFromGalaxie",
  "AI Tools": "catAiTools",
  "Banking and Finance": "catBanking",
  "Cloud Storage": "catCloudStorage",
  "Developer Tools": "catDeveloperTools",
  Entertainment: "catEntertainment",
  "Health and Fitness": "catHealth",
  Learning: "catLearning",
  "News and Weather": "catNews",
  Productivity: "catProductivity",
  Shopping: "catShopping",
  Social: "catSocial",
  Travel: "catTravel",
  "Work and Business": "catWork",
  Miscellaneous: "catMisc",
};

export function chaveCategoria(
  categoria: CategoriaApp
): keyof Dicionario["command"] {
  return CHAVE_CATEGORIA[categoria];
}

/** Um grupo de apps de uma categoria, na ordem de `ORDEM_CATEGORIAS`. */
export interface GrupoCategoria {
  categoria: CategoriaApp;
  apps: AppCatalogo[];
}

/**
 * Busca por nome OU categoria (lowercase simples; o catálogo é em inglês). Vazio
 * = todos.
 */
export function buscar(
  apps: readonly AppCatalogo[],
  query: string
): AppCatalogo[] {
  const q = query.trim().toLowerCase();
  if (!q) return apps.slice();
  return apps.filter(
    (a) =>
      a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)
  );
}

/**
 * Agrupa por categoria na ordem canônica. Categorias vazias saem fora. `filtro`
 * opcional restringe por nome/categoria (busca do command).
 */
export function agrupar(
  apps: readonly AppCatalogo[],
  filtro?: string
): GrupoCategoria[] {
  const base = filtro ? buscar(apps, filtro) : apps;
  const porCat = new Map<CategoriaApp, AppCatalogo[]>();
  for (const app of base) {
    const lista = porCat.get(app.category);
    if (lista) lista.push(app);
    else porCat.set(app.category, [app]);
  }
  const grupos: GrupoCategoria[] = [];
  for (const categoria of ORDEM_CATEGORIAS) {
    const lista = porCat.get(categoria);
    if (lista && lista.length) grupos.push({ categoria, apps: lista });
  }
  return grupos;
}
