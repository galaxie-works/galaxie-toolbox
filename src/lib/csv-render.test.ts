// Testes do parser CSV (#451). node --test --experimental-strip-types
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseCsv,
  decodificarTexto,
  ehCelulaNumerica,
  calcularColunasCsv,
} from "./csv-render.ts";

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

test("detecta pipe (.psv)", () => {
  const t = parseCsv("a|b|c\n1|2|3");
  assert.equal(t.delimitador, "|");
  assert.deepEqual(t.linhas[1], ["1", "2", "3"]);
});

// --- decodificarTexto (#941) ---------------------------------------------------

test("decodifica UTF-8 (com acento) corretamente", () => {
  const bytes = new TextEncoder().encode("ção,ok");
  assert.equal(decodificarTexto(bytes), "ção,ok");
});

test("byte inválido de UTF-8 → fallback windows-1252 (sem )", () => {
  // 0xE7 0xE3 0xEF = "çãï" em Windows-1252; NÃO é UTF-8 válido.
  const bytes = new Uint8Array([0x63, 0xe7, 0xe3, 0x6f]); // "cção"
  const texto = decodificarTexto(bytes);
  assert.equal(texto, "cção");
  assert.ok(!texto.includes("�"));
});

// --- ehCelulaNumerica (#941) ---------------------------------------------------

test("célula numérica: inteiros, decimais, negativos, notação", () => {
  for (const v of ["1", "42", "-3", "3.14", "1e3", "  10  ", "0"]) {
    assert.equal(ehCelulaNumerica(v), true, v);
  }
});

test("célula numérica: formato pt-BR e moeda/percent", () => {
  for (const v of ["1.234,56", "R$ 10,00", "50%", "1 000"]) {
    assert.equal(ehCelulaNumerica(v), true, v);
  }
});

test("célula NÃO numérica: texto e vazio", () => {
  for (const v of ["", "abc", "12abc", "  "]) {
    assert.equal(ehCelulaNumerica(v), false, v);
  }
});

// --- calcularColunasCsv (#941) -------------------------------------------------

test("coluna majoritariamente numérica → alinhamento 'num'", () => {
  const { alinhamentos, numColunas } = calcularColunasCsv([
    ["nome", "valor"],
    ["Ana", "10"],
    ["Beto", "20"],
    ["Cida", "x"], // 1 texto entre 3 → ainda maioria numérica
  ]);
  assert.equal(numColunas, 2);
  assert.equal(alinhamentos[0], "txt");
  assert.equal(alinhamentos[1], "num");
});

test("larguras respeitam mínimo e máximo", () => {
  const { larguras } = calcularColunasCsv([["a"], ["b"]]);
  assert.ok(larguras[0] >= 56);
  const longo = "x".repeat(500);
  const { larguras: l2 } = calcularColunasCsv([[longo], [longo]]);
  assert.ok(l2[0] <= 384);
});
