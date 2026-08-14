// Testes headless do filtro in-folder + ocultos + atributos (#681).
// Rode com:  node --test --experimental-strip-types src/components/explorer/filtro.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { filtrarEntradas, atributosAtivos } from "./filtro.ts";
import type { FsEntry } from "../../lib/types.ts";

function entry(over: Partial<FsEntry>): FsEntry {
  return {
    name: "x",
    path: `C:\\${over.name ?? "x"}`,
    isDir: false,
    isSymlink: false,
    size: 0,
    modifiedMs: null,
    createdMs: null,
    extension: null,
    isHidden: false,
    isReadonly: false,
    ...over,
  };
}

const LISTA: FsEntry[] = [
  entry({ name: "Relatório.pdf" }),
  entry({ name: "relatorio-antigo.txt" }),
  entry({ name: "Fotos", isDir: true }),
  entry({ name: ".env", isHidden: true }),
  entry({ name: "config.oculto", isHidden: true }),
];

test("termo vazio: só esconde ocultos quando desligado", () => {
  const r = filtrarEntradas(LISTA, "", false);
  assert.deepEqual(
    r.map((e) => e.name),
    ["Relatório.pdf", "relatorio-antigo.txt", "Fotos"],
  );
});

test("mostrarOcultos = true: inclui os ocultos", () => {
  const r = filtrarEntradas(LISTA, "", true);
  assert.equal(r.length, 5);
});

test("filtro por nome é case-insensitive e por substring (pastas + arquivos)", () => {
  const r = filtrarEntradas(LISTA, "relat", false);
  assert.deepEqual(
    r.map((e) => e.name),
    ["Relatório.pdf", "relatorio-antigo.txt"],
  );
});

test("filtro combina com ocultos: 'oc' com ocultos ligado pega o config.oculto", () => {
  const r = filtrarEntradas(LISTA, "oc", true);
  assert.deepEqual(
    r.map((e) => e.name),
    ["config.oculto"],
  );
});

test("filtro não retorna oculto quando o toggle está desligado, mesmo casando o nome", () => {
  const r = filtrarEntradas(LISTA, "env", false);
  assert.deepEqual(r, []);
});

test("atributosAtivos: lista na ordem oculto → somenteLeitura → symlink", () => {
  const e = entry({ isHidden: true, isReadonly: true, isSymlink: true });
  assert.deepEqual(atributosAtivos(e), ["oculto", "somenteLeitura", "symlink"]);
  assert.deepEqual(atributosAtivos(entry({})), []);
});
