// Testes headless do classificador de anexos para preview (#188).
// Rode com:  node --test --experimental-strip-types src/lib/anexo-tipo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { classificarAnexo, ehPrevisualizavel } from "./anexo-tipo.ts";
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

test("formato fora do MVP → nao-suportado", () => {
  assert.equal(
    classificarAnexo(
      anexo({
        nome: "planilha.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    ),
    "nao-suportado"
  );
});

test("ehPrevisualizavel: true p/ pdf e txt, false p/ o resto", () => {
  assert.equal(ehPrevisualizavel(anexo({ nome: "a.pdf" })), true);
  assert.equal(ehPrevisualizavel(anexo({ nome: "a.txt" })), true);
  assert.equal(ehPrevisualizavel(anexo({ nome: "a.docx" })), false);
});
