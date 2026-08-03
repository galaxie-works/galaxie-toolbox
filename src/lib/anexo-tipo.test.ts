// Testes headless do classificador de anexos para preview (#188).
// Rode com:  node --test --experimental-strip-types src/lib/anexo-tipo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aceitaAltaFidelidade,
  classificarAnexo,
  ehPrevisualizavel,
} from "./anexo-tipo.ts";
import type { AnexoEmail } from "./types.ts";

function anexo(over: Partial<AnexoEmail>): AnexoEmail {
  return {
    id: "1",
    nome: "arquivo",
    tamanho: 1024,
    contentType: "",
    odataType: "#microsoft.graph.fileAttachment",
    isInline: false,
    ...over,
  };
}

test("PDF pelo contentType", () => {
  assert.equal(
    classificarAnexo(anexo({ nome: "x", contentType: "application/pdf" })),
    "pdf"
  );
});

test("PDF pelo sufixo do nome quando não há contentType", () => {
  assert.equal(classificarAnexo(anexo({ nome: "proposta.PDF" })), "pdf");
});

test("TXT pelo contentType (com charset)", () => {
  assert.equal(
    classificarAnexo(anexo({ nome: "x", contentType: "text/plain; charset=utf-8" })),
    "txt"
  );
});

test("TXT pelo sufixo do nome", () => {
  assert.equal(classificarAnexo(anexo({ nome: "notas.txt" })), "txt");
});

test("docx pelo contentType OOXML", () => {
  assert.equal(
    classificarAnexo(
      anexo({
        nome: "carta",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
    ),
    "docx"
  );
});

test("xlsx pelo sufixo do nome", () => {
  assert.equal(classificarAnexo(anexo({ nome: "orcamento.XLSX" })), "xlsx");
});

test("pptx pelo sufixo do nome (Path C, #190)", () => {
  assert.equal(classificarAnexo(anexo({ nome: "deck.PPTX" })), "pptx");
});

test("imagem por contentType e sufixo; svg incluso (#450)", () => {
  assert.equal(
    classificarAnexo(anexo({ nome: "x", contentType: "image/png" })),
    "imagem"
  );
  assert.equal(classificarAnexo(anexo({ nome: "foto.JPG" })), "imagem");
  assert.equal(classificarAnexo(anexo({ nome: "logo.svg" })), "imagem");
  assert.equal(classificarAnexo(anexo({ nome: "anim.gif" })), "imagem");
});

test("tiff NÃO é imagem previsível (cai em nao-suportado) (#450)", () => {
  assert.equal(classificarAnexo(anexo({ nome: "scan.tiff" })), "nao-suportado");
  assert.equal(
    classificarAnexo(anexo({ nome: "x", contentType: "image/tiff" })),
    "nao-suportado"
  );
});

test("formato fora do escopo → nao-suportado", () => {
  assert.equal(classificarAnexo(anexo({ nome: "arquivo.msg" })), "nao-suportado");
  assert.equal(classificarAnexo(anexo({ nome: "pacote.zip" })), "nao-suportado");
});

test("ehPrevisualizavel: true p/ pdf/txt/docx/xlsx/pptx, false p/ o resto", () => {
  assert.equal(ehPrevisualizavel(anexo({ nome: "a.pdf" })), true);
  assert.equal(ehPrevisualizavel(anexo({ nome: "a.txt" })), true);
  assert.equal(ehPrevisualizavel(anexo({ nome: "a.docx" })), true);
  assert.equal(ehPrevisualizavel(anexo({ nome: "a.xlsx" })), true);
  assert.equal(ehPrevisualizavel(anexo({ nome: "a.pptx" })), true);
  assert.equal(ehPrevisualizavel(anexo({ nome: "a.zip" })), false);
});

test("aceitaAltaFidelidade: só docx/xlsx", () => {
  assert.equal(aceitaAltaFidelidade("docx"), true);
  assert.equal(aceitaAltaFidelidade("xlsx"), true);
  assert.equal(aceitaAltaFidelidade("pptx"), false);
  assert.equal(aceitaAltaFidelidade("pdf"), false);
});
