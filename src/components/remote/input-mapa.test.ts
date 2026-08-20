// Testes puros do mapeamento de input do Remote (#687).
//   node --test --experimental-strip-types src/components/remote/input-mapa.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  areaFrame,
  botaoMouse,
  eventoMouseBotao,
  eventoMouseMove,
  eventoScroll,
  eventoTecla,
  mapearTecla,
  posNoFrame,
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

// ─────────────────────── #1444: letterbox (área real do frame) ──────────────

test("#1444 areaFrame: razão igual à viewport → viewport inteira (sem regressão)", () => {
  // host 800×600 na viewport 800×600 (razões iguais): escala casa nos 2 eixos,
  // offset 0 → a área do frame É a viewport. É o caminho comum, não pode mudar.
  assert.deepEqual(areaFrame(RECT, 800, 600), RECT);
});

test("#1444 areaFrame: host mais LARGO → barras em cima/baixo (letterbox horizontal)", () => {
  // viewport 800×600 (1.333), host 1920×1080 (1.778): escala=min(800/1920,
  // 600/1080)=0.4167 → frame 800×450, centrado → barras de 75px em cima/baixo.
  assert.deepEqual(areaFrame(RECT, 1920, 1080), {
    left: 100,
    top: 125, // 50 + (600-450)/2
    width: 800,
    height: 450,
  });
});

test("#1444 areaFrame: host mais ALTO → barras nas laterais (letterbox vertical)", () => {
  // host 1080×1920 (0.5625): escala=min(800/1080,600/1920)=0.3125 → frame
  // 337.5×600, centrado → barras de 231.25px nas laterais.
  assert.deepEqual(areaFrame(RECT, 1080, 1920), {
    left: 331.25, // 100 + (800-337.5)/2
    top: 50,
    width: 337.5,
    height: 600,
  });
});

test("#1444 areaFrame: sem geometria do host (0) ou viewport degenerada → viewport crua", () => {
  assert.deepEqual(areaFrame(RECT, 0, 0), RECT);
  assert.deepEqual(areaFrame({ left: 0, top: 0, width: 0, height: 0 }, 1920, 1080), {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
});

test("#1444 posNoFrame: clique DENTRO do frame → normalizado pela área real, não pela viewport", () => {
  // Letterbox horizontal (frame top=125, height=450). O centro da VIEWPORT
  // (500,350) é o centro do FRAME → {0.5,0.5}. Pelo mapa antigo (viewport) daria
  // y=(350-50)/600=0.5 por coincidência no centro; o topo do frame é onde diverge.
  assert.deepEqual(posNoFrame(500, 350, RECT, 1920, 1080), { x: 0.5, y: 0.5 });
  // topo REAL do frame (y=125) → y=0; pelo mapa antigo daria (125-50)/600=0.125.
  assert.deepEqual(posNoFrame(100, 125, RECT, 1920, 1080), { x: 0, y: 0 });
});

test("#1444 posNoFrame: clique na BORDA preta → null (nenhum ponto remoto ali)", () => {
  // Barra de cima (y<125) e de baixo (y>575) no letterbox horizontal.
  assert.equal(posNoFrame(500, 80, RECT, 1920, 1080), null);
  assert.equal(posNoFrame(500, 590, RECT, 1920, 1080), null);
  // Barra lateral no letterbox vertical (frame left=331.25 .. 668.75).
  assert.equal(posNoFrame(200, 350, RECT, 1080, 1920), null);
  assert.equal(posNoFrame(700, 350, RECT, 1080, 1920), null);
});

test("#1444 posNoFrame: razão igual → casa com posNormalizada (sem regressão)", () => {
  assert.deepEqual(posNoFrame(500, 350, RECT, 800, 600), posNormalizada(500, 350, RECT));
});

test("#1444 eventoMouseMove: dentro → mouseMove; na borda → null", () => {
  assert.deepEqual(eventoMouseMove(500, 350, RECT, 1920, 1080), {
    e: "mouseMove",
    x: 0.5,
    y: 0.5,
  });
  assert.equal(eventoMouseMove(500, 80, RECT, 1920, 1080), null); // barra de cima
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
