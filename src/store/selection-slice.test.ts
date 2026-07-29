import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSelectionSlice,
  type SelectionSlice,
} from "./selection-slice.ts";

function criarStoreDeTeste(): SelectionSlice {
  const state = {} as SelectionSlice;
  const set = (
    update:
      | Partial<SelectionSlice>
      | ((atual: SelectionSlice) => Partial<SelectionSlice>)
  ) => {
    Object.assign(state, typeof update === "function" ? update(state) : update);
  };
  const slice = createSelectionSlice(
    set as never,
    (() => state) as never,
    {} as never
  );
  return Object.assign(state, slice);
}

test("toggle updates the selected IDs and range anchor", () => {
  const store = criarStoreDeTeste();

  store.alternarSelecionado("b");
  assert.deepEqual([...store.selecionados], ["b"]);
  assert.equal(store.ancoraSelecao, "b");

  store.alternarSelecionado("b");
  assert.equal(store.selecionados.size, 0);
  assert.equal(store.ancoraSelecao, "b");
});

test("range adds every displayed ID between anchor and target", () => {
  const store = criarStoreDeTeste();
  store.alternarSelecionado("b");

  assert.equal(store.selecionarRange(["a", "b", "c", "d"], "d"), true);
  assert.deepEqual([...store.selecionados], ["b", "c", "d"]);
  assert.equal(store.ancoraSelecao, "b");
});

test("range reports false when there is no valid anchor", () => {
  const store = criarStoreDeTeste();

  assert.equal(store.selecionarRange(["a", "b"], "b"), false);
  assert.equal(store.selecionados.size, 0);
});

test("clear resets batch selection and anchor but preserves active message", () => {
  const store = criarStoreDeTeste();
  store.selecionarMensagem("a");
  store.selecionarTudo(["a", "b"]);
  store.limparSelecao();

  assert.equal(store.selecionados.size, 0);
  assert.equal(store.ancoraSelecao, null);
  assert.equal(store.msgSel, "a");
});

test("removing messages reconciles selected, active, and anchor state", () => {
  const store = criarStoreDeTeste();
  store.selecionarMensagem("b");
  store.selecionarTudo(["a", "b", "c"]);
  store.removerDaSelecao(["b", "c"]);

  assert.deepEqual([...store.selecionados], ["a"]);
  assert.equal(store.msgSel, null);
  assert.equal(store.ancoraSelecao, null);
});
