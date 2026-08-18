// #990: prova pura (node --test, sem React) da ordenação. Contrato: por PADRÃO
// arquivos e pastas se MISTURAM pelo critério; "Pastas primeiro" (3º arg) é
// opt-in e reagrupa as pastas na frente. Fixtures inline de FsEntry.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ordenar, type Ordem } from "./ordenar.ts";
import type { FsEntry } from "../../lib/types.ts";

function mk(p: Partial<FsEntry> & { name: string; isDir: boolean }): FsEntry {
  return {
    path: `C:\\x\\${p.name}`,
    isSymlink: false,
    size: 0,
    modifiedMs: null,
    createdMs: null,
    extension: null,
    isHidden: false,
    isReadonly: false,
    ...p,
  };
}

const nomes = (l: FsEntry[]) => l.map((e) => e.name);

test("default (misturado) por Data desc: arquivo novo antes de pasta velha", () => {
  const pastaVelha = mk({ name: "pasta-velha", isDir: true, modifiedMs: 1_000 });
  const arquivoNovo = mk({ name: "arquivo-novo", isDir: false, modifiedMs: 9_000 });
  const arquivoVelho = mk({ name: "arquivo-velho", isDir: false, modifiedMs: 500 });
  const ordem: Ordem = { chave: "modificado", direcao: "desc" };

  const r = ordenar([pastaVelha, arquivoVelho, arquivoNovo], ordem);

  // Intercalado por data (mais recente primeiro), NÃO todas-as-pastas-primeiro.
  assert.deepEqual(nomes(r), ["arquivo-novo", "pasta-velha", "arquivo-velho"]);
});

test("pastasPrimeiro=true: todas as pastas antes de todos os arquivos", () => {
  const pastaVelha = mk({ name: "pasta-velha", isDir: true, modifiedMs: 1_000 });
  const arquivoNovo = mk({ name: "arquivo-novo", isDir: false, modifiedMs: 9_000 });
  const ordem: Ordem = { chave: "modificado", direcao: "desc" };

  const r = ordenar([arquivoNovo, pastaVelha], ordem, true);

  // Apesar de o arquivo ser mais recente, a pasta vem primeiro.
  assert.deepEqual(nomes(r), ["pasta-velha", "arquivo-novo"]);
  assert.equal(r[0].isDir, true);
  assert.equal(r[1].isDir, false);
});

test("pastasPrimeiro=true agrupa em qualquer critério (nome asc)", () => {
  const pastaB = mk({ name: "b-pasta", isDir: true });
  const arquivoA = mk({ name: "a-arquivo", isDir: false });
  const ordem: Ordem = { chave: "nome", direcao: "asc" };

  const r = ordenar([arquivoA, pastaB], ordem, true);

  // "a-arquivo" < "b-pasta" alfabeticamente, mas a pasta agrupa na frente.
  assert.deepEqual(nomes(r), ["b-pasta", "a-arquivo"]);
});

test("critério nome (asc) numérico, misturado", () => {
  const f10 = mk({ name: "arq10", isDir: false });
  const f2 = mk({ name: "arq2", isDir: false });
  const d1 = mk({ name: "arq1", isDir: true });
  const ordem: Ordem = { chave: "nome", direcao: "asc" };

  const r = ordenar([f10, f2, d1], ordem);

  // Collator numérico: arq1 < arq2 < arq10; pasta e arquivos intercalados.
  assert.deepEqual(nomes(r), ["arq1", "arq2", "arq10"]);
});

test("critério tamanho (desc), misturado", () => {
  const grande = mk({ name: "grande", isDir: false, size: 900 });
  const medio = mk({ name: "medio", isDir: false, size: 500 });
  const pasta = mk({ name: "pasta", isDir: true, size: 0 });
  const ordem: Ordem = { chave: "tamanho", direcao: "desc" };

  const r = ordenar([medio, pasta, grande], ordem);

  assert.deepEqual(nomes(r), ["grande", "medio", "pasta"]);
});

test("critério tipo (asc) pela extensão, misturado", () => {
  const doc = mk({ name: "b", isDir: false, extension: "doc" });
  const zip = mk({ name: "a", isDir: false, extension: "zip" });
  const pasta = mk({ name: "c", isDir: true });
  const ordem: Ordem = { chave: "tipo", direcao: "asc" };

  const r = ordenar([zip, doc, pasta], ordem);

  // "" (pasta, sem ext) < "doc" < "zip".
  assert.deepEqual(nomes(r), ["c", "b", "a"]);
});
