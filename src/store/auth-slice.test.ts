import assert from "node:assert/strict";
import { test } from "node:test";

import { createAuthSlice, type AuthSlice } from "./auth-slice.ts";

function criarStoreDeTeste(): AuthSlice {
  const state = {} as AuthSlice;
  const set = (
    update:
      | Partial<AuthSlice>
      | ((atual: AuthSlice) => Partial<AuthSlice>),
  ) => {
    Object.assign(state, typeof update === "function" ? update(state) : update);
  };
  const slice = createAuthSlice(
    set as never,
    (() => state) as never,
    {} as never,
  );
  return Object.assign(state, slice);
}

test("missing scopes are normalized and reopen a dismissed warning", () => {
  const store = criarStoreDeTeste();

  store.setReauthMissingScopes([" Contacts.ReadWrite ", "People.Read", "People.Read"]);
  assert.deepEqual(store.reauthMissingScopes, [
    "Contacts.ReadWrite",
    "People.Read",
  ]);
  assert.equal(store.reauthDismissed, false);

  store.dismissReauth();
  assert.equal(store.reauthDismissed, true);

  store.setReauthMissingScopes(["Contacts.ReadWrite"]);
  assert.equal(store.reauthDismissed, false);
});

test("clear removes token-specific state", () => {
  const store = criarStoreDeTeste();
  store.setReauthMissingScopes(["Contacts.ReadWrite"]);
  store.dismissReauth();

  store.clearReauth();

  assert.deepEqual(store.reauthMissingScopes, []);
  assert.equal(store.reauthDismissed, false);
});
