// #1287: as sentinelas de raiz virtual e o predicado que o shell usa pra NÃO
// tratar um sentinel como pasta real (senão o watcher/`listarDir` batem num
// alvo inexistente).
// Rode com:
//   node --test --experimental-strip-types src/components/explorer/caminho.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAMINHO_ACESSO_RAPIDO,
  CAMINHO_CLOUD,
  CAMINHO_ESTE_PC,
  CAMINHO_REDE,
  ehRaizVirtual,
} from "./caminho.ts";

test("This PC (caminho vazio) é raiz virtual", () => {
  assert.equal(ehRaizVirtual(CAMINHO_ESTE_PC), true);
});

test("as três raízes do #1287 são virtuais", () => {
  assert.equal(ehRaizVirtual(CAMINHO_CLOUD), true);
  assert.equal(ehRaizVirtual(CAMINHO_REDE), true);
  assert.equal(ehRaizVirtual(CAMINHO_ACESSO_RAPIDO), true);
});

test("um caminho real de disco NÃO é raiz virtual", () => {
  assert.equal(ehRaizVirtual("C:\\"), false);
  assert.equal(ehRaizVirtual("C:\\Users\\consa\\Desktop"), false);
  assert.equal(ehRaizVirtual("\\\\192.168.1.34\\Galaxie Network"), false);
});

test("os sentinelas usam o prefixo `::` que nenhum caminho Windows toma", () => {
  // O ':' só existe logo após a letra do drive ("C:"); "::x::" nunca colide.
  for (const s of [CAMINHO_CLOUD, CAMINHO_REDE, CAMINHO_ACESSO_RAPIDO]) {
    assert.match(s, /^::.+::$/);
  }
  // E são distintos entre si (não roteiam pra view errada).
  const todos = [CAMINHO_CLOUD, CAMINHO_REDE, CAMINHO_ACESSO_RAPIDO];
  assert.equal(new Set(todos).size, todos.length);
});
