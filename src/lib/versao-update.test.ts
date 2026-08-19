// Testes do compare do updater (#1264) — o que reproduz o bug do PO.
// Rode com:  node --test --experimental-strip-types src/lib/versao-update.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  comparaVersoes,
  deveOferecerAtualizacao,
  formatarDataFeed,
} from "./versao-update.ts";

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

// --- #1258: o badge mostrava timestamp de maquina (achado da `Iris`) --------
// Repro do bug: o consumidor fazia `split(" ")[0]` numa data ISO.

test("#1258 repro: o formato REAL do feed nao vira timestamp de maquina", () => {
  // Verbatim do latest.json da v0.46.0 (conferido no repo de dist).
  const doFeed = "2026-08-19T06:11:36Z";
  // O que o codigo fazia antes — fica aqui como a prova do bug:
  assert.equal(doFeed.split(" ")[0], doFeed); // o split NAO corta nada
  // O que passa a acontecer:
  assert.equal(formatarDataFeed(doFeed, "pt", "UTC"), "19/08/2026");
});

test("#1258 a ORDEM dos campos segue o idioma", () => {
  const d = "2026-08-19T12:00:00Z";
  assert.equal(formatarDataFeed(d, "pt", "UTC"), "19/08/2026");
  assert.equal(formatarDataFeed(d, "en-US", "UTC"), "08/19/2026");
});

test("#1258 fuso: instante com hora vira o dia LOCAL de quem le (-03)", () => {
  // 01:00Z e ainda dia 18 em Sao Paulo — mostrar 19 seria mentir sobre o
  // relogio do usuario. O `wagner` esta em -03, entao esta e a virada real.
  assert.equal(
    formatarDataFeed("2026-08-19T01:00:00Z", "pt", "America/Sao_Paulo"),
    "18/08/2026"
  );
  // E o mesmo instante em UTC continua sendo 19.
  assert.equal(formatarDataFeed("2026-08-19T01:00:00Z", "pt", "UTC"), "19/08/2026");
});

test("#1258 fuso: string SO com data NAO desliza um dia", () => {
  // `new Date("2026-08-19")` e meia-noite UTC => viraria 18/08 em fuso
  // negativo. Sem hora nao existe instante, entao a data e literal.
  assert.equal(
    formatarDataFeed("2026-08-19", "pt", "America/Sao_Paulo"),
    "19/08/2026"
  );
});

test("#1258 forma com espaco (RFC3339 folgado do Tauri) tambem le", () => {
  assert.equal(
    formatarDataFeed("2026-08-19 06:11:36.0 +00:00:00", "pt", "America/Sao_Paulo"),
    "19/08/2026"
  );
});

test("#1258 entrada ausente ou ilegivel = badge so com a versao", () => {
  assert.equal(formatarDataFeed(undefined, "pt"), "");
  assert.equal(formatarDataFeed(null, "pt"), "");
  assert.equal(formatarDataFeed("   ", "pt"), "");
  assert.equal(formatarDataFeed("nao e data", "pt"), "");
});
