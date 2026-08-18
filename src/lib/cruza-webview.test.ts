// #1179 — a REGRA do tooltip (D3 do #1163 escrito como regra, não lista de
// componentes): *a caixa do overlay cruza o retângulo da webview?*
//
// Este é o teste da regra PURA (node --test, sem DOM). O comportamento do
// registro/geometria vive em `sirius-1179-tooltip-webview.component.test.tsx`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { cruzaWebview } from "./navigator-overlay-core.ts";

/** Webview ocupando a área principal, abaixo da title bar (y=48). */
const WEBVIEW = { x: 0, y: 48, w: 1000, h: 700 };

test("#1179 tooltip SOBRE a webview cruza (o bug do Wagner)", () => {
  // Tooltip do chip de aba descendo sobre a área da webview.
  assert.equal(cruzaWebview({ x: 120, y: 40, w: 160, h: 28 }, WEBVIEW), true);
});

test("#1179 tooltip inteiramente na title bar NÃO cruza (sem cintilação)", () => {
  // O caso comum: hover no chrome. Não pode acionar a webview.
  assert.equal(cruzaWebview({ x: 120, y: 8, w: 160, h: 28 }, WEBVIEW), false);
});

test("#1179 encostar a borda NÃO é cruzar", () => {
  // Caixa termina exatamente onde a webview começa (y=48): não é coberta.
  assert.equal(cruzaWebview({ x: 120, y: 20, w: 160, h: 28 }, WEBVIEW), false);
});

test("#1179 tooltip do sidebar colapsado, à direita, cruza (caso do #360)", () => {
  // Rail à esquerda (x<48); o tooltip abre PRA DENTRO da área da webview.
  assert.equal(cruzaWebview({ x: 44, y: 300, w: 90, h: 24 }, WEBVIEW), true);
});

test("#1179 sem webview em jogo (null) nada cruza — custo zero fora do Navigator", () => {
  assert.equal(cruzaWebview({ x: 120, y: 300, w: 160, h: 28 }, null), false);
});

test("#1179 retângulo degenerado (w/h 0) não cruza", () => {
  assert.equal(cruzaWebview({ x: 120, y: 300, w: 0, h: 0 }, WEBVIEW), false);
  assert.equal(
    cruzaWebview({ x: 120, y: 300, w: 160, h: 28 }, { ...WEBVIEW, h: 0 }),
    false,
  );
});
