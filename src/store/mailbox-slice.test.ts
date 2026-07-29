import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMailboxSlice,
  type MailboxSlice,
} from "./mailbox-slice.ts";

function criarStoreDeTeste(): MailboxSlice {
  const state = {} as MailboxSlice;
  const set = (
    update:
      | Partial<MailboxSlice>
      | ((atual: MailboxSlice) => Partial<MailboxSlice>),
  ) => {
    Object.assign(state, typeof update === "function" ? update(state) : update);
  };
  const slice = createMailboxSlice(
    set as never,
    (() => state) as never,
    {} as never,
  );
  return Object.assign(state, slice);
}

test("mailbox loading state is session-only and starts on the personal inbox", () => {
  const store = criarStoreDeTeste();

  assert.equal(store.caixaAtiva, "me");
  assert.equal(store.pastas, null);
  assert.deepEqual(store.subpastas, {});
  assert.equal(store.recargaPastas, 0);
});

test("mailbox loading actions update roots, child folders, and refresh generation", () => {
  const store = criarStoreDeTeste();

  store.setCaixaAtiva("shared@galaxie.works");
  store.setPastas([]);
  store.setSubpastas({ inbox: [] });
  store.setRecargaPastas((geracao) => geracao + 1);

  assert.equal(store.caixaAtiva, "shared@galaxie.works");
  assert.deepEqual(store.pastas, []);
  assert.deepEqual(store.subpastas, { inbox: [] });
  assert.equal(store.recargaPastas, 1);
});

test("folder cache remains independent from the active loading state", () => {
  const store = criarStoreDeTeste();
  const entry = { mensagens: [], carregados: 50, temMais: true };

  store.setCachePasta("me|inbox|data|true", entry);
  store.setPastas([]);
  store.setSubpastas({ inbox: [] });

  assert.deepEqual(store.cachePastas["me|inbox|data|true"], entry);
  store.limparCachePasta("me|inbox|data|true");
  assert.deepEqual(store.cachePastas, {});
  assert.deepEqual(store.subpastas, { inbox: [] });
});
