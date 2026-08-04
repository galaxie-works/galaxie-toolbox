import { type Idioma } from "./strings.ts";

/** Chave do `localStorage` onde o provider grava o idioma escolhido. */
export const CHAVE_IDIOMA = "galaxie-idioma";

/**
 * Idioma atual: preferência salva → idioma do sistema (pt→pt-BR) → **inglês**
 * (#464 S0: o default do PO é EN — sem preferência salva e sistema não-pt cai em
 * `en`). Fonte de verdade FORA do React: stores/libs que não podem usar o hook
 * `useIdioma` chamam isto (o `definir` do provider grava o mesmo `localStorage`).
 *
 * Vive num `.ts` puro (sem JSX) de propósito: quem importa isto (ex.:
 * `people-slice.ts`) é carregado pelo runner de teste `node --test
 * --experimental-strip-types`, que **não** resolve `.tsx`. Manter no `idioma.tsx`
 * quebrava `people-slice.test.ts` no CI de release (v0.37.0).
 */
export function idiomaAtual(): Idioma {
  const salvo = localStorage.getItem(CHAVE_IDIOMA);
  if (salvo === "pt-BR" || salvo === "en") return salvo;
  return navigator.language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}
