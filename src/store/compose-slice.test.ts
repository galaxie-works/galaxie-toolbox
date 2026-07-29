import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createComposeSlice,
  type ComposeSlice,
} from "./compose-slice.ts";

function criarStoreDeTeste() {
  const state = {} as ComposeSlice;
  const set = (
    update:
      | Partial<ComposeSlice>
      | ((atual: ComposeSlice) => Partial<ComposeSlice>),
  ) => {
    Object.assign(state, typeof update === "function" ? update(state) : update);
  };
  const slice = createComposeSlice(
    set as never,
    (() => state) as never,
    {} as never,
  );
  return Object.assign(state, slice);
}

test("opening compose creates one clean session for every mode", () => {
  const store = criarStoreDeTeste();

  store.abrirCompose("novo", "shared@galaxie.works");
  store.setComposePara(["ana@galaxie.works"]);
  store.setComposeCc(["time@galaxie.works"]);
  store.setComposeCco(["audit@galaxie.works"]);
  store.setComposeAssunto("Status");
  store.setComposeAnexos([
    {
      nome: "status.txt",
      tipo: "text/plain",
      conteudoB64: "c3RhdHVz",
    },
  ]);

  const primeiraGeracao = store.composeGeracao;
  store.abrirCompose("encaminhar", "me");

  assert.equal(store.composeModo, "encaminhar");
  assert.equal(store.composeRemetente, "me");
  assert.equal(store.composeGeracao, primeiraGeracao + 1);
  assert.deepEqual(store.composePara, []);
  assert.deepEqual(store.composeCc, []);
  assert.deepEqual(store.composeCco, []);
  assert.equal(store.composeAssunto, "");
  assert.deepEqual(store.composeAnexos, []);
});

test("draft actions support value and functional updates", () => {
  const store = criarStoreDeTeste();
  store.abrirCompose("novo", "me");

  store.setComposePara(["ana@galaxie.works"]);
  store.setComposePara((atual) => [...atual, "bia@galaxie.works"]);
  store.setComposeAnexos((atual) => [
    ...atual,
    {
      nome: "brief.pdf",
      tipo: "application/pdf",
      conteudoB64: "YnJpZWY=",
    },
  ]);

  assert.deepEqual(store.composePara, [
    "ana@galaxie.works",
    "bia@galaxie.works",
  ]);
  assert.equal(store.composeAnexos[0]?.nome, "brief.pdf");
});

test("closing compose clears domain draft without owning send lifecycle", () => {
  const store = criarStoreDeTeste();
  store.abrirCompose("responderTodos", "shared@galaxie.works");
  store.setComposeAssunto("Re: Status");
  const geracaoAberta = store.composeGeracao;

  store.fecharCompose();

  assert.equal(store.composeModo, null);
  assert.equal(store.composeRemetente, "me");
  assert.equal(store.composeAssunto, "");
  assert.deepEqual(store.composeAnexos, []);
  assert.equal(store.composeGeracao, geracaoAberta + 1);
});
