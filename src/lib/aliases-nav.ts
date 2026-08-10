// Navigator command — "Ir para {app}" (#656). Casa o que o usuário digita contra
// os apelidos (i18n, em strings.ts) + o rótulo de cada Tela e devolve as telas que
// batem, rankeadas (exato > prefixo > contém). Puro (sem React/i18n direto) pra ser
// testável por `node --test`; o i18n dos apelidos e o rótulo vêm por parâmetro.

import type { Tela } from "@/lib/navegacao";

/** Produtos candidatos ao "Ir para" (subconjunto de `TELAS`; fora:
 *  performance/caminhos-longos, que são ferramentas Windows, não "apps").
 *  O caller ainda filtra os `oculto` do NAV (#663 RC) antes de passar a
 *  lista pra `appsQueCasam` — aqui é só o catálogo curado + a ordem. */
export const TELAS_IR_PARA: Tela[] = [
  "control-room",
  "apps",
  "onedrive",
  "outlook",
  "atoms",
  "navegador",
  "comms",
  "astro",
  "pulsar",
  "configuracoes",
];

/** #657: sub-views do Bridge que são alvo de deep-link (People/Agenda). NÃO são
 *  `Tela`s próprias — vivem dentro do `control-room` (store `bridgeView`). */
export type SubviewBridge = "people" | "agenda";
export const SUBVIEWS_BRIDGE: SubviewBridge[] = ["people", "agenda"];

/** minúsculo + sem acento + trim — pra casar `configuracoes`↔`configurações`. */
export function normalizarTermo(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Score de um texto (rótulo + apelidos) contra `alvo` já normalizado:
 *  3 = palavra exata, 2 = prefixo, 1 = contém, -1 = nada. */
function pontuar(alvo: string, texto: string): number {
  let score = -1;
  for (const p of normalizarTermo(texto).split(/\s+/).filter(Boolean)) {
    if (p === alvo) score = Math.max(score, 3);
    else if (p.startsWith(alvo)) score = Math.max(score, 2);
    else if (p.includes(alvo)) score = Math.max(score, 1);
  }
  return score;
}

/**
 * Core do match: itens cujo texto de busca casa com `termo`, rankeados por
 * qualidade (exato > prefixo > contém), limitados a `limite`. Estável: empate
 * mantém a ordem de `itens`.
 */
export function ranquearPorAlias<T>(
  termo: string,
  itens: T[],
  texto: (item: T) => string,
  limite = 5,
): T[] {
  const alvo = normalizarTermo(termo);
  if (!alvo) return [];
  const casados: { item: T; score: number }[] = [];
  for (const item of itens) {
    const score = pontuar(alvo, texto(item));
    if (score >= 0) casados.push({ item, score });
  }
  return casados
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)
    .map((c) => c.item);
}

/**
 * Telas cujo rótulo ou apelidos casam com `termo`, rankeadas.
 * - `telas`: candidatas a considerar (o caller já filtrou os `oculto` do NAV).
 * - `aliasApps`: apelidos por Tela (string com palavras separadas por espaço).
 * - `rotulo`: nome i18n da Tela (ex.: `t.nav[TELAS[tela].titulo]`).
 */
export function appsQueCasam(
  termo: string,
  telas: Tela[],
  aliasApps: Partial<Record<Tela, string>>,
  rotulo: (tela: Tela) => string,
  limite = 5,
): Tela[] {
  return ranquearPorAlias(
    termo,
    telas,
    (tela) => `${rotulo(tela)} ${aliasApps[tela] ?? ""}`,
    limite,
  );
}

/**
 * #657: sub-views do Bridge (People/Agenda) que casam com `termo`, rankeadas.
 * - `aliasSubviews`: apelidos por sub-view (i18n).
 * - `rotulo`: nome i18n da sub-view (ex.: `t.controlRoom.peopleTitulo`).
 */
export function subviewsQueCasam(
  termo: string,
  aliasSubviews: Record<SubviewBridge, string>,
  rotulo: (view: SubviewBridge) => string,
  limite = 3,
): SubviewBridge[] {
  return ranquearPorAlias(
    termo,
    SUBVIEWS_BRIDGE,
    (view) => `${rotulo(view)} ${aliasSubviews[view] ?? ""}`,
    limite,
  );
}
