import { DICIONARIOS, type Dicionario } from "./strings.ts";
import { idiomaAtual } from "./idioma-core.ts";

/**
 * Rótulos do editor Plate (#529 / fecha o épico i18n #459) — **config-driven**.
 *
 * A fonte única dos textos é o namespace `plate` do dicionário (`strings.ts`).
 * Aqui ficam só os acessores; nada de string hardcoded. Vive num `.ts` puro
 * (imports relativos com extensão) de propósito: componentes/util importáveis
 * pelo runner `node --test --experimental-strip-types` não resolvem `.tsx`
 * (mesma regra do `idioma-core.ts`).
 *
 * Dois acessores, mesma fonte:
 * - `plateLabels(t)` — devolve o mapa pra quem JÁ tem `t` (via `useIdioma`),
 *   caso um consumidor queira passar rótulos por prop/config.
 * - `plateLabel(chave)` — acessor **NÃO-hook** pros componentes vendorizados do
 *   registry (Plate toolbar buttons), pra não meter `useIdioma` no primitivo.
 *   Mesmo padrão do `textoUi` (#475/#525): lê `idiomaAtual()` puro. Reativo o
 *   suficiente — o `IdiomaProvider` re-renderiza a árvore ao trocar de idioma.
 */
export function plateLabels(t: Dicionario): Dicionario["plate"] {
  return t.plate;
}

export function plateLabel(chave: keyof Dicionario["plate"]): string {
  return DICIONARIOS[idiomaAtual()].plate[chave];
}
