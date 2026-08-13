// Testes headless da geometria do marquee (#748) + a aplicação da seleção.
//   node --test --experimental-strip-types src/components/explorer/marquee.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  indicesNoRetangulo,
  normalizarRetangulo,
  type GridMetrica,
} from "./marquee.ts";
import { selecionarRetangulo, SELECAO_VAZIA } from "./selecao.ts";

const LISTA: GridMetrica = {
  cols: 1,
  alturaLinha: 32,
  largura: 400,
  alturaTotal: 320,
  count: 10,
  gap: 8,
  padX: 4,
  modoGrade: false,
};

// Grade 3 colunas: colW = (420 - 8 - 16)/3 = 132; lefts 4 / 144 / 284.
const GRADE: GridMetrica = {
  cols: 3,
  alturaLinha: 116,
  largura: 420,
  alturaTotal: 348,
  count: 7,
  gap: 8,
  padX: 4,
  modoGrade: true,
};

test("normalizarRetangulo ordena os cantos", () => {
  assert.deepEqual(normalizarRetangulo(30, 90, 10, 20), {
    x1: 10,
    y1: 20,
    x2: 30,
    y2: 90,
  });
});

test("lista: retângulo vertical pega as linhas cobertas", () => {
  // y 40..100 cobre as linhas 1,2,3 (32px cada).
  assert.deepEqual(
    indicesNoRetangulo({ x1: 0, y1: 40, x2: 200, y2: 100 }, LISTA),
    [1, 2, 3],
  );
});

test("lista: retângulo no topo pega só o item 0", () => {
  assert.deepEqual(
    indicesNoRetangulo({ x1: 0, y1: 0, x2: 200, y2: 10 }, LISTA),
    [0],
  );
});

test("lista: clampa na última linha (não estoura o count)", () => {
  // y além do total → não passa do índice 9.
  assert.deepEqual(
    indicesNoRetangulo({ x1: 0, y1: 300, x2: 200, y2: 999 }, LISTA),
    [9],
  );
});

test("grade: seleção por linha×coluna, itens fora do viewport incluídos", () => {
  // x 0..150 pega col0 e col1; y 0..120 pega linhas 0 e 1.
  assert.deepEqual(
    indicesNoRetangulo({ x1: 0, y1: 0, x2: 150, y2: 120 }, GRADE),
    [0, 1, 3, 4],
  );
});

test("grade: coluna isolada à direita", () => {
  // x 300..416 só intersecta a col2; linhas 0 e 1 → índices 2 e 5.
  assert.deepEqual(
    indicesNoRetangulo({ x1: 300, y1: 0, x2: 416, y2: 120 }, GRADE),
    [2, 5],
  );
});

test("grade: última linha parcial não gera índice fora do count", () => {
  // count 7 → a linha 2 só tem o índice 6.
  assert.deepEqual(
    indicesNoRetangulo({ x1: 0, y1: 0, x2: 420, y2: 400 }, GRADE),
    [0, 1, 2, 3, 4, 5, 6],
  );
});

test("count zero → sem índices", () => {
  assert.deepEqual(
    indicesNoRetangulo({ x1: 0, y1: 0, x2: 999, y2: 999 }, {
      ...LISTA,
      count: 0,
    }),
    [],
  );
});

const PATHS = ["a", "b", "c", "d", "e"];

test("selecionarRetangulo: não-aditivo substitui pela faixa do retângulo", () => {
  const base = { selecionados: new Set(["a"]), ancora: "a", cursor: "a" };
  const s = selecionarRetangulo(base, PATHS, [1, 2, 3]);
  assert.deepEqual([...s.selecionados], ["b", "c", "d"]);
  assert.equal(s.ancora, "b");
  assert.equal(s.cursor, "d");
});

test("selecionarRetangulo: aditivo soma à base e preserva a âncora", () => {
  const base = { selecionados: new Set(["a"]), ancora: "a", cursor: "a" };
  const s = selecionarRetangulo(base, PATHS, [2, 3], { aditivo: true });
  assert.deepEqual([...s.selecionados].sort(), ["a", "c", "d"]);
  assert.equal(s.ancora, "a"); // âncora da base preservada
  assert.equal(s.cursor, "d");
});

test("selecionarRetangulo: retângulo vazio não-aditivo limpa", () => {
  const base = { selecionados: new Set(["a", "b"]), ancora: "a", cursor: "b" };
  const s = selecionarRetangulo(base, PATHS, []);
  assert.equal(s.selecionados.size, 0);
  assert.equal(s.ancora, null);
});

test("selecionarRetangulo: retângulo vazio aditivo preserva a base", () => {
  const base = { selecionados: new Set(["a", "b"]), ancora: "a", cursor: "b" };
  const s = selecionarRetangulo(base, PATHS, [], { aditivo: true });
  assert.deepEqual([...s.selecionados].sort(), ["a", "b"]);
  assert.equal(s.ancora, "a");
});

// Silencia o "unused" e documenta que o vazio canônico é reaproveitável.
void SELECAO_VAZIA;
