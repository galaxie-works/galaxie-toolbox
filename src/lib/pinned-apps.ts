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
 * Resolve os ids pinados na LISTA em que eles foram criados, na ORDEM do pin.
 *
 * #1152: antes isto resolvia só contra `APPS_CATALOGO`, e o pin do command grava
 * o id da lista UNIFICADA — que tem três origens (telas GALAXIE, M365 curado e
 * catálogo). Como `outlook`, `word`, `galaxie-bridge` e companhia **não existem
 * no catálogo**, todo pin de app M365 ou de tela GALAXIE era descartado aqui, em
 * silêncio, e o rail não renderizava. A guarda contra pin quebrado engolia o
 * caso comum.
 *
 * A proteção continua: id que não existe em NENHUMA origem é descartado — o rail
 * nunca mostra pin quebrado. O que muda é que agora ele é **anunciado**
 * (`aoDescartar`), porque foi justamente o descarte mudo que escondeu este bug
 * do time até o PO reclamar.
 *
 * Genérico no item (`T extends { id: string }`) de propósito: o resolvedor não
 * precisa saber se recebe `AppCatalogo` ou `AppUnificado`, e assim segue puro e
 * testável sem importar o JSON do catálogo.
 */
export function resolverPinados<T extends { id: string }>(
  pinados: readonly string[],
  apps: readonly T[],
  aoDescartar?: (id: string) => void
): T[] {
  const porId = new Map(apps.map((a) => [a.id, a]));
  const out: T[] = [];
  for (const id of pinados) {
    const app = porId.get(id);
    if (app) out.push(app);
    else aoDescartar?.(id);
  }
  return out;
}
