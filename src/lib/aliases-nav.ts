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

/** minúsculo + sem acento + trim — pra casar `configuracoes`↔`configurações`. */
export function normalizarTermo(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Telas cujo rótulo ou apelidos casam com `termo`, rankeadas por qualidade do
 * match (exato > prefixo > contém), limitadas a `limite` (padrão 5).
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
  const alvo = normalizarTermo(termo);
  if (!alvo) return [];

  const casados: { tela: Tela; score: number }[] = [];
  for (const tela of telas) {
    const palavras = normalizarTermo(`${rotulo(tela)} ${aliasApps[tela] ?? ""}`)
      .split(/\s+/)
      .filter(Boolean);
    let score = -1;
    for (const p of palavras) {
      if (p === alvo) score = Math.max(score, 3);
      else if (p.startsWith(alvo)) score = Math.max(score, 2);
      else if (p.includes(alvo)) score = Math.max(score, 1);
    }
    if (score >= 0) casados.push({ tela, score });
  }

  // Score desc; empate mantém a ordem de `telas` (sort estável).
  return casados
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)
    .map((c) => c.tela);
}
