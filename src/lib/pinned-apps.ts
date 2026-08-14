import type { AppCatalogo } from "@/lib/apps-catalog-core";

/**
 * #721 (SH3): estado PURO dos apps pinados no rail — lista ordenada de ids do
 * catálogo (#720). Sem React, sem persistência e sem importar o JSON do catálogo
 * (o resolver recebe o catálogo por parâmetro) — testável com `node --test` (só
 * `import type`, stripado). O slice do store + o ConfigBackend consomem daqui.
 */

/** Teto de pinados no rail (estreito; acima disso o layout sofre). */
export const MAX_PINADOS = 20;

export function estaPinado(pinados: readonly string[], id: string): boolean {
  return pinados.includes(id);
}

/** Alterna o pin de um id, preservando a ordem (novo vai pro fim). Respeita o cap. */
export function alternarPin(pinados: readonly string[], id: string): string[] {
  if (pinados.includes(id)) return pinados.filter((p) => p !== id);
  if (pinados.length >= MAX_PINADOS) return pinados.slice();
  return [...pinados, id];
}

/** Remove um id (idempotente). */
export function removerPin(pinados: readonly string[], id: string): string[] {
  return pinados.filter((p) => p !== id);
}

/**
 * Resolve os ids pinados nos apps do `catalogo`, na ORDEM dos pinados. Ids órfãos
 * (app saiu do catálogo) são descartados — o rail nunca mostra um pin quebrado.
 * O caller passa `APPS_CATALOGO` (do apps-catalog.ts), mantendo isto puro.
 */
export function resolverPinados(
  pinados: readonly string[],
  catalogo: readonly AppCatalogo[]
): AppCatalogo[] {
  const porId = new Map(catalogo.map((a) => [a.id, a]));
  const out: AppCatalogo[] = [];
  for (const id of pinados) {
    const app = porId.get(id);
    if (app) out.push(app);
  }
  return out;
}
