import { test } from "node:test";
import assert from "node:assert/strict";

import { scrollTopReancorado, type Ancora } from "./scroll-ancora.ts";

const ancora: Ancora = { id: "m1", start: 1000, scrollTop: 800 };

test("#611 prepend: compensa scrollTop pelo deslocamento da âncora", () => {
  // Dois e-mails novos entraram acima (76px cada): start 1000 -> 1152.
  const novo = scrollTopReancorado(ancora, 1152, { noTopo: false });
  assert.equal(novo, 800 + 152);
});

test("#611 sem âncora (1º render / troca de lista): não compensa", () => {
  assert.equal(scrollTopReancorado(null, 1152, { noTopo: false }), null);
});

test("#611 no topo: deixa o e-mail novo aparecer (não compensa)", () => {
  assert.equal(scrollTopReancorado(ancora, 1152, { noTopo: true }), null);
});

test("#611 âncora sumiu (lista recarregada com outros ids): não compensa", () => {
  assert.equal(scrollTopReancorado(ancora, undefined, { noTopo: false }), null);
});

test("#611 âncora não desceu (lista estável/encolheu): não compensa", () => {
  // start igual => delta 0
  assert.equal(scrollTopReancorado(ancora, 1000, { noTopo: false }), null);
  // start menor (encolheu acima) => delta negativo
  assert.equal(scrollTopReancorado(ancora, 950, { noTopo: false }), null);
});
