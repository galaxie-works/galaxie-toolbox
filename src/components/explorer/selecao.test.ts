// Testes headless do modelo de seleção do painel de conteúdo (#678).
// Rode com:  node --test --experimental-strip-types src/components/explorer/selecao.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SELECAO_VAZIA,
  alternar,
  selecionarFaixa,
  selecionarTudo,
  selecionarUnico,
  type EstadoSelecao,
} from "./selecao.ts";

// Ordem VISÍVEL de exemplo (já ordenada, pastas-primeiro seria irrelevante aqui).
const P = ["a", "b", "c", "d", "e", "f"];

function sel(e: EstadoSelecao): string[] {
  return [...e.selecionados].sort();
}

test("clique simples: seleciona 1, ancora e cursor no item", () => {
  const e = selecionarUnico(P, 2);
  assert.deepEqual(sel(e), ["c"]);
  assert.equal(e.ancora, "c");
  assert.equal(e.cursor, "c");
});

test("ctrl+clique: alterna sem apagar os demais e move a âncora", () => {
  let e = selecionarUnico(P, 1); // {b}, âncora b
  e = alternar(e, P, 3); // + d
  assert.deepEqual(sel(e), ["b", "d"]);
  assert.equal(e.ancora, "d");
  // alterna d de novo → sai; b permanece
  e = alternar(e, P, 3);
  assert.deepEqual(sel(e), ["b"]);
  assert.equal(e.ancora, "d");
});

test("shift+clique: faixa da âncora até o clicado (crescente)", () => {
  let e = selecionarUnico(P, 1); // âncora b
  e = selecionarFaixa(e, P, 4); // b..e
  assert.deepEqual(sel(e), ["b", "c", "d", "e"]);
  assert.equal(e.ancora, "b");
  assert.equal(e.cursor, "e");
});

test("shift+clique: faixa decrescente (clique antes da âncora)", () => {
  let e = selecionarUnico(P, 4); // âncora e
  e = selecionarFaixa(e, P, 1); // e..b → b..e
  assert.deepEqual(sel(e), ["b", "c", "d", "e"]);
  assert.equal(e.ancora, "e");
  assert.equal(e.cursor, "b");
});

test("shift+clique sem âncora: degrada pra seleção única", () => {
  const e = selecionarFaixa(SELECAO_VAZIA, P, 3);
  assert.deepEqual(sel(e), ["d"]);
  assert.equal(e.ancora, "d");
});

test("shift+seta: estende e depois ENCOLHE a partir da âncora", () => {
  let e = selecionarUnico(P, 2); // âncora c
  e = selecionarFaixa(e, P, 3); // c..d
  assert.deepEqual(sel(e), ["c", "d"]);
  e = selecionarFaixa(e, P, 4); // c..e (cresce)
  assert.deepEqual(sel(e), ["c", "d", "e"]);
  e = selecionarFaixa(e, P, 2); // volta pra âncora → só c (encolhe)
  assert.deepEqual(sel(e), ["c"]);
  assert.equal(e.ancora, "c");
  assert.equal(e.cursor, "c");
});

test("shift+seta cruzando a âncora inverte o lado da faixa", () => {
  let e = selecionarUnico(P, 2); // âncora c
  e = selecionarFaixa(e, P, 0); // c..a
  assert.deepEqual(sel(e), ["a", "b", "c"]);
  assert.equal(e.cursor, "a");
});

test("índice fora do intervalo é no-op (mantém estado)", () => {
  const base = selecionarUnico(P, 1);
  assert.deepEqual(alternar(base, P, 99), base);
  assert.deepEqual(selecionarFaixa(base, P, -1), base);
});

test("selecionarTudo marca todos, âncora no primeiro", () => {
  const e = selecionarTudo(P, SELECAO_VAZIA);
  assert.equal(e.selecionados.size, P.length);
  assert.equal(e.ancora, "a");
});
