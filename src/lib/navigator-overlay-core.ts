/**
 * Núcleo PURO do mecanismo de overlay-sobre-webview (#1163/#1179).
 *
 * Vive em `.ts` (sem JSX) de propósito: o `node --test` do CI não carrega `.tsx`,
 * e a regra do #1179 é justamente a parte que precisa de gate barato e exaustivo.
 * A parte React (hooks, registro no store) fica em `navigator-overlay.tsx`.
 */

/** Retângulo em coordenadas de VIEWPORT (mesmo espaço de `getBoundingClientRect`). */
export interface RetanguloWebview {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * #1179 — a REGRA do D3, escrita como regra e não como lista de componentes.
 *
 * `Tooltip` continua FORA do registro automático do D2 (hover é alta frequência:
 * ligar a webview a cada passagem de mouse devolveria cintilação — o D3 do Altair
 * em `docs/reference/default-silencioso-e-overlay-webview.md`). Mas o critério que
 * ele mesmo escreveu não é *qual primitivo*, é:
 *
 *   > **a caixa do overlay cruza o retângulo da webview?**
 *
 * Interseção de retângulos, com bordas que só se ENCOSTAM contando como
 * não-cruzamento (um tooltip colado à borda não é coberto). `null` — nenhuma
 * webview em jogo (outra tela, aba interna) — nunca cruza.
 */
export function cruzaWebview(
  caixa: RetanguloWebview,
  webview: RetanguloWebview | null,
): boolean {
  if (!webview) return false;
  if (caixa.w <= 0 || caixa.h <= 0 || webview.w <= 0 || webview.h <= 0) {
    return false;
  }
  return (
    caixa.x < webview.x + webview.w &&
    webview.x < caixa.x + caixa.w &&
    caixa.y < webview.y + webview.h &&
    webview.y < caixa.y + caixa.h
  );
}
