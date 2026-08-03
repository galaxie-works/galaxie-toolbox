import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadAtomsPrefs,
  persistAtomsPrefs,
  prefsPadrao,
  WIDGETS,
} from "./atoms-prefs.ts";

// Mock mínimo de localStorage pro node (a lib usa localStorage direto).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

test("#187 padrão: todos os widgets na ordem, speed-dial oculto", () => {
  store.clear();
  const p = loadAtomsPrefs();
  assert.deepEqual(p.ordem, [...WIDGETS]);
  assert.deepEqual(p.ocultos, ["speeddial"]);
  assert.equal(p.densidade, "confortavel");
});

test("#187 persiste e recarrega ordem/ocultos/densidade", () => {
  store.clear();
  persistAtomsPrefs({
    ordem: ["todos", "agenda", "email", "speeddial"],
    ocultos: ["email"],
    densidade: "compacta",
  });
  const p = loadAtomsPrefs();
  assert.deepEqual(p.ordem, ["todos", "agenda", "email", "speeddial"]);
  assert.deepEqual(p.ocultos, ["email"]);
  assert.equal(p.densidade, "compacta");
});

test("#187 normaliza ordem parcial/inválida: mantém salvos + anexa faltando", () => {
  store.clear();
  // Ordem só com 2 (simula versão antiga) + um id inválido.
  persistAtomsPrefs({
    ordem: ["todos", "agenda", "xpto" as never],
    ocultos: [],
    densidade: "confortavel",
  });
  const p = loadAtomsPrefs();
  // Descarta inválido, mantém a ordem salva, anexa os faltando (email/speeddial).
  assert.deepEqual(p.ordem, ["todos", "agenda", "email", "speeddial"]);
});

test("#187 default é cópia (não vaza referência mutável)", () => {
  const a = prefsPadrao();
  a.ordem.push("email");
  const b = prefsPadrao();
  assert.equal(b.ordem.length, WIDGETS.length);
});
