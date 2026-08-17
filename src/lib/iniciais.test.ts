import { test } from "node:test";
import assert from "node:assert/strict";

import { iniciais } from "./iniciais.ts";

test("#1023: ≥2 palavras → primeira da 1ª + primeira da última", () => {
  assert.equal(iniciais("Ana Beatriz Costa"), "AC");
  assert.equal(iniciais("Wagner Consani"), "WC");
});

test("#1023: 1 palavra → 2 primeiras letras", () => {
  assert.equal(iniciais("Ana"), "AN");
  assert.equal(iniciais("x"), "X");
});

test("#1023: sem nome → local-part do e-mail", () => {
  assert.equal(iniciais("", "wagner@galaxie.works"), "WA"); // 1 palavra → 2 letras
  assert.equal(iniciais(null, "jo@x.com"), "JO");
  // local-part com separador vira 1ª+última inicial (não "WA"):
  assert.equal(iniciais("", "wagner.consani@x.com"), "WC");
  assert.equal(iniciais(null, "ana_b_costa@x.com"), "AC");
});

test("#1023: nome tem prioridade sobre e-mail", () => {
  assert.equal(iniciais("Ana Costa", "zz@x.com"), "AC");
});

test("#1023: nada → '?', NUNCA string vazia (bug do organizations-view)", () => {
  assert.equal(iniciais(), "?");
  assert.equal(iniciais("", ""), "?");
  assert.equal(iniciais("   ", null), "?");
  assert.equal(iniciais(null, "   "), "?");
});

test("#1023: mesma pessoa = mesmas iniciais em qualquer chamada", () => {
  // People passava só o nome; Agenda/Bridge só o e-mail; Compose ambos.
  // Com nome presente, o resultado é idêntico independente do e-mail.
  const nome = "Ana Beatriz Costa";
  assert.equal(iniciais(nome), iniciais(nome, "ana@x.com"));
  assert.equal(iniciais(nome), iniciais(nome, null));
});
