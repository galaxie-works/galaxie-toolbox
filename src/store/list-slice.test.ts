import assert from "node:assert/strict";
import { test } from "node:test";

import { createListSlice, type ListSlice } from "./list-slice.ts";

function criarStoreDeTeste(): ListSlice {
  const state = {} as ListSlice;
  const set = (
    update:
      | Partial<ListSlice>
      | ((atual: ListSlice) => Partial<ListSlice>),
  ) => {
    Object.assign(state, typeof update === "function" ? update(state) : update);
  };
  const slice = createListSlice(
    set as never,
    (() => state) as never,
    {} as never,
  );
  return Object.assign(state, slice);
}

test("list loading state starts on an unloaded personal inbox", () => {
  const store = criarStoreDeTeste();

  assert.equal(store.pastaSel, "inbox");
  assert.equal(store.mensagens, null);
  assert.equal(store.caixaDados, "me");
  assert.equal(store.listaRecarga, 0);
  assert.equal(store.temMais, false);
  assert.equal(store.carregandoMais, false);
});

test("list loading actions preserve updater and pagination semantics", () => {
  const store = criarStoreDeTeste();

  store.setPastaSel("sentitems");
  store.setMensagens([]);
  store.setCaixaDados("shared@galaxie.works");
  store.setListaRecarga((geracao) => geracao + 1);
  store.setTemMais(true);
  store.setCarregandoMais(true);

  assert.equal(store.pastaSel, "sentitems");
  assert.deepEqual(store.mensagens, []);
  assert.equal(store.caixaDados, "shared@galaxie.works");
  assert.equal(store.listaRecarga, 1);
  assert.equal(store.temMais, true);
  assert.equal(store.carregandoMais, true);
});
