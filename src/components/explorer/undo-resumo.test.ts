// Testes headless dos helpers de resumo de undo (#967 / #898 fatia 4). Rode com:
//   node --test --experimental-strip-types src/components/explorer/undo-resumo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { agruparUndo, rotuloMotivo, type RotulosMotivo } from "./undo-resumo.ts";
import type { UndoItemPlan, UndoPlan } from "../../lib/types.ts";

/** Monta um UndoPlan a partir dos itens (as contagens espelham os baldes). */
function plan(itens: UndoItemPlan[]): UndoPlan {
  return {
    opId: 1,
    kind: "copy",
    itens,
    seguros: itens.filter((i) => i.estado === "seguro").length,
    pulados: itens.filter((i) => i.estado === "pulado").length,
    naoReversiveis: itens.filter((i) => i.estado === "naoReversivel").length,
  };
}

const ROTULOS: RotulosMotivo = {
  sumiu: "sumiu-label",
  modificado: "modificado-label",
  origemReocupada: "origemReocupada-label",
  sobrescrita: "sobrescrita-label",
};

test("agrupa itens mistos nos 3 baldes preservando ordem", () => {
  const p = plan([
    { path: "C:\\a", estado: "seguro", motivo: null },
    { path: "C:\\b", estado: "pulado", motivo: "modificado" },
    { path: "C:\\c", estado: "seguro", motivo: null },
    { path: "C:\\d", estado: "naoReversivel", motivo: "sobrescrita" },
  ]);
  const baldes = agruparUndo(p);
  assert.deepEqual(
    baldes.seguros.map((i) => i.path),
    ["C:\\a", "C:\\c"],
  );
  assert.equal(baldes.pulados.length, 1);
  assert.equal(baldes.pulados[0].path, "C:\\b");
  assert.equal(baldes.naoReversiveis.length, 1);
  assert.equal(baldes.naoReversiveis[0].path, "C:\\d");
});

test("plan vazio → baldes vazios", () => {
  const baldes = agruparUndo(plan([]));
  assert.equal(baldes.seguros.length, 0);
  assert.equal(baldes.pulados.length, 0);
  assert.equal(baldes.naoReversiveis.length, 0);
});

test("cada código de motivo mapeia pro rótulo i18n", () => {
  assert.equal(rotuloMotivo("sumiu", ROTULOS), "sumiu-label");
  assert.equal(rotuloMotivo("modificado", ROTULOS), "modificado-label");
  assert.equal(rotuloMotivo("origemReocupada", ROTULOS), "origemReocupada-label");
  assert.equal(rotuloMotivo("sobrescrita", ROTULOS), "sobrescrita-label");
});

test("motivo null/undefined → string vazia", () => {
  assert.equal(rotuloMotivo(null, ROTULOS), "");
  assert.equal(rotuloMotivo(undefined, ROTULOS), "");
});
