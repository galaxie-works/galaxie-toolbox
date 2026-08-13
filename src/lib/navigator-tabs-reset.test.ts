import assert from "node:assert/strict";
import test from "node:test";

import { resetSessaoNavegador } from "./navigator-tabs.ts";

// Storage falso: Map + removeItem (só o que a função usa).
function fakeStorage(chaves: string[]) {
  const m = new Map(chaves.map((c) => [c, "x"]));
  return {
    store: m,
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

const TENANT = [
  "galaxie.navigator.pinned-tabs.v1",
  "galaxie.navigator.last-session.v1",
  "galaxie.navigator.groups.v1",
  "galaxie.navigator.tab-groups.v1",
];
const DEVICE = [
  "galaxie.navigator.favicons.v1",
  "galaxie.navigator.search-provider.v1",
  "galaxie.navigator.prefs.v1",
  "galaxie.navigator.memory-settings.v1",
];

test("#821: resetSessaoNavegador purga as chaves TENANT do Navigator", () => {
  const s = fakeStorage([...TENANT, ...DEVICE]);
  resetSessaoNavegador(s);
  for (const c of TENANT) {
    assert.equal(s.store.has(c), false, `${c} devia ter sido purgada`);
  }
});

test("#821: resetSessaoNavegador PRESERVA as chaves DEVICE/pref (não vazam identidade)", () => {
  const s = fakeStorage([...TENANT, ...DEVICE]);
  resetSessaoNavegador(s);
  for (const c of DEVICE) {
    assert.equal(s.store.has(c), true, `${c} NÃO devia ter sido purgada`);
  }
});

test("#821: resetSessaoNavegador é resiliente a storage sem as chaves (no-op)", () => {
  const s = fakeStorage([]);
  assert.doesNotThrow(() => resetSessaoNavegador(s));
});
