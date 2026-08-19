// Testes do compare do updater (#1264) — o que reproduz o bug do PO.
// Rode com:  node --test --experimental-strip-types src/lib/versao-update.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { comparaVersoes, deveOferecerAtualizacao } from "./versao-update.ts";

// --- o bug relatado pelo PO: instalada == feed, a cada abertura ------------

test("#1264 repro: instalada igual a do feed NAO oferece update", () => {
  assert.equal(deveOferecerAtualizacao("0.44.0", "0.44.0"), false);
});

test("#1264 vetor (c): mesma versao republicada com data nova NAO oferece", () => {
  // A data nunca entra na conta — so o numero da versao decide.
  assert.equal(deveOferecerAtualizacao("0.45.1", "0.45.1"), false);
});

test("#1264 vetor (a): feed anunciando versao MAIS VELHA nao oferece", () => {
  assert.equal(deveOferecerAtualizacao("0.45.1", "0.44.0"), false);
});

test("versao mais nova no feed continua oferecendo", () => {
  assert.equal(deveOferecerAtualizacao("0.44.0", "0.45.1"), true);
});

// --- tolerancia ao que vem do feed (JSON de outra esteira) -----------------

test("prefixo v e espaco sobrando nao quebram o compare", () => {
  assert.equal(deveOferecerAtualizacao("0.44.0", " v0.44.0 "), false);
  assert.equal(deveOferecerAtualizacao(" 0.44.0", "v0.45.0"), true);
});

test("versao ausente ou vazia nao oferece (app fica quieto)", () => {
  assert.equal(deveOferecerAtualizacao("0.45.1", undefined), false);
  assert.equal(deveOferecerAtualizacao("0.45.1", ""), false);
  assert.equal(deveOferecerAtualizacao(undefined, "0.46.0"), false);
  assert.equal(deveOferecerAtualizacao(null, "0.46.0"), false);
});

test("metadado de build e ignorado", () => {
  assert.equal(deveOferecerAtualizacao("0.45.1", "0.45.1+build.7"), false);
});

// --- ordenacao semver -----------------------------------------------------

test("compara por casa, nao por texto (0.9.0 < 0.45.1)", () => {
  assert.ok(comparaVersoes("0.9.0", "0.45.1") < 0);
  assert.equal(deveOferecerAtualizacao("0.9.0", "0.45.1"), true);
});

test("numero de casas diferente completa com zero", () => {
  assert.equal(comparaVersoes("1.0", "1.0.0"), 0);
  assert.ok(comparaVersoes("1.0.1", "1.0") > 0);
});

test("release final ganha de pre-release do mesmo nucleo", () => {
  assert.ok(comparaVersoes("1.0.0", "1.0.0-beta.1") > 0);
  assert.ok(comparaVersoes("1.0.0-beta.1", "1.0.0-beta.2") < 0);
  assert.equal(deveOferecerAtualizacao("1.0.0", "1.0.0-beta.2"), false);
  assert.equal(deveOferecerAtualizacao("1.0.0-beta.1", "1.0.0"), true);
});

test("versao ilegivel vira zero em vez de derrubar o app", () => {
  assert.equal(comparaVersoes("x.y.z", "0.0.0"), 0);
  assert.equal(deveOferecerAtualizacao("0.45.1", "nao-e-versao"), false);
});
