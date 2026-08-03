// Testes do parser CSV (#451). node --test --experimental-strip-types
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCsv } from "./csv-render.ts";

test("vírgula: header + linhas + total", () => {
  const t = parseCsv("a,b,c\n1,2,3\n4,5,6");
  assert.deepEqual(t.linhas[0], ["a", "b", "c"]);
  assert.deepEqual(t.linhas[1], ["1", "2", "3"]);
  assert.equal(t.total, 3);
  assert.equal(t.delimitador, ",");
  assert.equal(t.truncado, false);
});

test("detecta delimitador ; (Excel pt-BR) — não vira coluna só", () => {
  const t = parseCsv("nome;valor\nAna;10");
  assert.equal(t.delimitador, ";");
  assert.deepEqual(t.linhas[1], ["Ana", "10"]);
});

test("detecta tab", () => {
  const t = parseCsv("a\tb\n1\t2");
  assert.equal(t.delimitador, "\t");
  assert.deepEqual(t.linhas[1], ["1", "2"]);
});

test("campo com vírgula entre aspas não quebra a coluna", () => {
  const t = parseCsv('a,b\n"x, y",z');
  assert.deepEqual(t.linhas[1], ["x, y", "z"]);
});

test('aspas escapadas ""', () => {
  const t = parseCsv('a\n"ele disse ""oi"""');
  assert.deepEqual(t.linhas[1], ['ele disse "oi"']);
});

test("CRLF + BOM", () => {
  const t = parseCsv("﻿a,b\r\n1,2\r\n");
  assert.deepEqual(t.linhas[0], ["a", "b"]);
  assert.deepEqual(t.linhas[1], ["1", "2"]);
  assert.equal(t.total, 2);
});

test("vazio → sem linhas (não é erro)", () => {
  const t = parseCsv("");
  assert.equal(t.linhas.length, 0);
  assert.equal(t.total, 0);
});
