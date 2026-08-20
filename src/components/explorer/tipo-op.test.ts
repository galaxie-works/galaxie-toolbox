// #1282: o tipo da op vem do `opKind` do backend. Rode com:
//   node --test --experimental-strip-types src/components/explorer/tipo-op.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { tipoDoEvento } from "./tipo-op.ts";

test("undo do backend vira tipo 'undo' — NÃO herda 'copy' (o defeito do #1282)", () => {
  // Era o `?? "copy"`: sem esta tradução, o undo aparecia como cópia na central.
  assert.equal(tipoDoEvento("undo"), "undo");
});

test("copy e move passam pelo próprio valor", () => {
  assert.equal(tipoDoEvento("copy"), "copy");
  assert.equal(tipoDoEvento("move"), "move");
});

test("opKind desconhecido → null (chamador cai no fallback do cliente)", () => {
  assert.equal(tipoDoEvento(""), null);
  assert.equal(tipoDoEvento("delete"), null);
  assert.equal(tipoDoEvento("Undo"), null); // case-sensitive: o backend manda minúsculo
});
