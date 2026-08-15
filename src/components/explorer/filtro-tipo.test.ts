// Testes headless do glob + filtro por categoria/tipo (#985 US1). Rode com:
//   node --test --experimental-strip-types src/components/explorer/filtro-tipo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  casaGlob,
  categoriaDeEntrada,
  passaFiltroTipo,
} from "./filtro-tipo.ts";
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

// --- glob ------------------------------------------------------------------

test("glob *.docx casa a.docx mas não a.pdf", () => {
  assert.equal(casaGlob("a.docx", "*.docx"), true);
  assert.equal(casaGlob("a.pdf", "*.docx"), false);
});

test("glob prefixo nome* casa nomeQualquer, não outro", () => {
  assert.equal(casaGlob("nome-final.txt", "nome*"), true);
  assert.equal(casaGlob("outro.txt", "nome*"), false);
});

test("glob ? casa exatamente um caractere", () => {
  assert.equal(casaGlob("a", "?"), true);
  assert.equal(casaGlob("ab", "?"), false);
  assert.equal(casaGlob("a.b", "?.?"), true);
});

test("glob é case-insensitive e ancorado", () => {
  assert.equal(casaGlob("RELATORIO.DOCX", "*.docx"), true);
  // ancorado: 'docx' no meio sem coringa não casa o nome inteiro
  assert.equal(casaGlob("meu.docx.bak", "*.docx"), false);
});

test("glob escapa metacaracteres de regex literais", () => {
  // o '.' literal não é coringa; casa só o ponto, não qualquer char
  assert.equal(casaGlob("a.txt", "a.txt"), true);
  assert.equal(casaGlob("axtxt", "a.txt"), false);
  // '+' literal é escapado
  assert.equal(casaGlob("c++.md", "c++*"), true);
});

// --- categorias ------------------------------------------------------------

test("categoriaDeEntrada classifica cada uma das 5 categorias", () => {
  assert.equal(categoriaDeEntrada(entry({ extension: ".docx" })), "documentos");
  assert.equal(categoriaDeEntrada(entry({ extension: ".pdf" })), "documentos");
  assert.equal(categoriaDeEntrada(entry({ extension: ".xlsx" })), "documentos");
  assert.equal(categoriaDeEntrada(entry({ extension: ".png" })), "imagens");
  assert.equal(categoriaDeEntrada(entry({ extension: ".mp4" })), "videos");
  assert.equal(categoriaDeEntrada(entry({ extension: ".mp3" })), "audio");
  assert.equal(categoriaDeEntrada(entry({ extension: ".zip" })), "compactados");
});

test("categoriaDeEntrada cai no nome quando extension é null", () => {
  assert.equal(
    categoriaDeEntrada(entry({ name: "foto.JPEG", extension: null })),
    "imagens",
  );
});

test("categoriaDeEntrada devolve null para extensão desconhecida", () => {
  assert.equal(categoriaDeEntrada(entry({ extension: ".xyz" })), null);
  assert.equal(categoriaDeEntrada(entry({ name: "sem-extensao" })), null);
});

// --- passaFiltroTipo -------------------------------------------------------

test("categorias vazias: tudo passa", () => {
  assert.equal(passaFiltroTipo(entry({ extension: ".xyz" }), []), true);
  assert.equal(passaFiltroTipo(entry({ isDir: true }), []), true);
});

test("pasta sempre passa, mesmo com filtro ativo", () => {
  assert.equal(
    passaFiltroTipo(entry({ name: "Docs", isDir: true }), ["imagens"]),
    true,
  );
});

test("arquivo passa só se a categoria está selecionada (OU entre categorias)", () => {
  const png = entry({ extension: ".png" });
  assert.equal(passaFiltroTipo(png, ["imagens"]), true);
  assert.equal(passaFiltroTipo(png, ["documentos"]), false);
  assert.equal(passaFiltroTipo(png, ["documentos", "imagens"]), true);
});

test("extensão desconhecida é filtrada quando há categoria ativa", () => {
  assert.equal(passaFiltroTipo(entry({ extension: ".xyz" }), ["documentos"]), false);
});
