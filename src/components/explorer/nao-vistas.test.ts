// Testes headless do contador de não-vistas (#898 fatia 3 / #966). Rode com:
//   node --test --experimental-strip-types src/components/explorer/nao-vistas.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { calcularNaoVistas, marcarTodasVistas } from "./nao-vistas.ts";
import type { OpAtiva } from "./progresso-panel";
import type { FsOpProgress } from "../../lib/types.ts";

/** Fixture mínima de OpAtiva por opId (o contador só olha o opId). */
function op(opId: number): OpAtiva {
  return {
    opId,
    tipo: "copy",
    progresso: { opId, status: "success" } as FsOpProgress,
    velocidade: 0,
  };
}

test("sem vistos → todas as ops contam como não-vistas", () => {
  const ops = [op(1), op(2), op(3)];
  assert.equal(calcularNaoVistas(ops, new Set()), 3);
});

test("todas vistas → zero não-vistas", () => {
  const ops = [op(1), op(2), op(3)];
  const vistos = marcarTodasVistas(ops);
  assert.equal(calcularNaoVistas(ops, vistos), 0);
});

test("marca vistas e chega op nova → só a nova conta", () => {
  const iniciais = [op(1), op(2)];
  const vistos = marcarTodasVistas(iniciais); // painel abriu com 1 e 2
  const depois = [op(3), op(1), op(2)]; // op 3 chegou com o painel fechado
  assert.equal(calcularNaoVistas(depois, vistos), 1);
});

test("lista vazia → zero", () => {
  assert.equal(calcularNaoVistas([], new Set()), 0);
});

test("marcarTodasVistas devolve o conjunto dos opIds atuais", () => {
  const s = marcarTodasVistas([op(5), op(9)]);
  assert.ok(s.has(5) && s.has(9));
  assert.equal(s.size, 2);
});

test("op dispensada (some da lista) não afeta a contagem", () => {
  const vistos = marcarTodasVistas([op(1), op(2)]);
  // op 2 foi dispensada; op 4 nova chegou fechada
  assert.equal(calcularNaoVistas([op(1), op(4)], vistos), 1);
});
