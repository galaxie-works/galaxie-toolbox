// Testes puros do mapeamento de input do Remote (#687).
//   node --test --experimental-strip-types src/components/remote/input-mapa.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  botaoMouse,
  eventoMouseBotao,
  eventoScroll,
  eventoTecla,
  mapearTecla,
  posNormalizada,
} from "./input-mapa.ts";

const RECT = { left: 100, top: 50, width: 800, height: 600 };

test("posNormalizada: mapeia e clampa em 0..1", () => {
  assert.deepEqual(posNormalizada(500, 350, RECT), { x: 0.5, y: 0.5 });
  assert.deepEqual(posNormalizada(100, 50, RECT), { x: 0, y: 0 });
  assert.deepEqual(posNormalizada(900, 650, RECT), { x: 1, y: 1 });
  // fora da viewport → clampa
  assert.deepEqual(posNormalizada(0, 0, RECT), { x: 0, y: 0 });
  assert.deepEqual(posNormalizada(9999, 9999, RECT), { x: 1, y: 1 });
});

test("posNormalizada: rect degenerado (0 largura/altura) não divide por zero", () => {
  assert.deepEqual(posNormalizada(10, 10, { left: 0, top: 0, width: 0, height: 0 }), {
    x: 0,
    y: 0,
  });
});

test("botaoMouse: 0/1/2 → left/middle/right; outros → null", () => {
  assert.equal(botaoMouse(0), "left");
  assert.equal(botaoMouse(1), "middle");
  assert.equal(botaoMouse(2), "right");
  assert.equal(botaoMouse(3), null);
});

test("mapearTecla: nomeadas, F, char, e desconhecida", () => {
  assert.deepEqual(mapearTecla("Enter"), { k: "enter" });
  assert.deepEqual(mapearTecla(" "), { k: "space" });
  assert.deepEqual(mapearTecla("ArrowUp"), { k: "up" });
  assert.deepEqual(mapearTecla("F5"), { k: "f", n: 5 });
  assert.deepEqual(mapearTecla("F12"), { k: "f", n: 12 });
  assert.deepEqual(mapearTecla("a"), { k: "char", c: "a" });
  assert.deepEqual(mapearTecla("ç"), { k: "char", c: "ç" });
  assert.equal(mapearTecla("F25"), null); // fora de F1..F24 → char? não (2 chars)
  assert.equal(mapearTecla("Unidentified"), null);
});

test("eventoMouseBotao: pressed explícito; botão inválido → null", () => {
  assert.deepEqual(eventoMouseBotao(2, true), {
    e: "mouseButton",
    botao: "right",
    pressed: true,
  });
  assert.deepEqual(eventoMouseBotao(0, false), {
    e: "mouseButton",
    botao: "left",
    pressed: false,
  });
  assert.equal(eventoMouseBotao(4, true), null);
});

test("eventoTecla: mapeia ou null", () => {
  assert.deepEqual(eventoTecla("Enter", true), {
    e: "key",
    tecla: { k: "enter" },
    pressed: true,
  });
  assert.equal(eventoTecla("Unidentified", true), null);
});

test("eventoScroll: sinal preserva direção; magnitude limitada", () => {
  assert.deepEqual(eventoScroll(0, 100), { e: "mouseScroll", dx: 0, dy: 3 });
  assert.deepEqual(eventoScroll(0, -30), { e: "mouseScroll", dx: 0, dy: -1 });
  assert.deepEqual(eventoScroll(0, 0), { e: "mouseScroll", dx: 0, dy: 0 });
});
