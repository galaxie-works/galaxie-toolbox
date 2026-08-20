// #1288: a letra do drive aparece UMA vez.
// Rode com:
//   node --test --experimental-strip-types src/components/explorer/rotulo-drive.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { letraDoDrive, rotuloDrive } from "./rotulo-drive.ts";

test("drive local: o nome não tem a letra, então ela é anexada", () => {
  assert.equal(rotuloDrive("Local disk", "C:\\"), "Local disk (C:)");
});

test("drive de REDE: o nome já vem com a letra do Rust — não duplica", () => {
  // Formato real do `nome_drive_rede` (fs_explorer.rs:777), que era o defeito:
  // sem esta regra, saía `... (W:) (W:)`.
  const nome = "wagnao-marcenaria (\\\\192.168.1.34\\Galaxie Network) (W:)";
  assert.equal(rotuloDrive(nome, "W:\\"), nome);
});

test("a comparação ignora caixa — `w:` e `W:` são o mesmo drive", () => {
  assert.equal(rotuloDrive("Compartilhado (w:)", "W:\\"), "Compartilhado (w:)");
});

test("a comparação ignora espaço no fim do nome", () => {
  assert.equal(rotuloDrive("Compartilhado (W:)  ", "W:\\"), "Compartilhado (W:)");
});

test("letra no MEIO do nome não conta — só o fim é sufixo", () => {
  // "(W:) do setor" tem a letra, mas não como sufixo: o rótulo ainda precisa
  // dizer de que drive se trata.
  assert.equal(
    rotuloDrive("Backup (W:) do setor", "W:\\"),
    "Backup (W:) do setor (W:)",
  );
});

test("nome vazio devolve só a letra, em vez de ' (W:)' com espaço solto", () => {
  assert.equal(rotuloDrive("", "W:\\"), "(W:)");
  assert.equal(rotuloDrive("   ", "W:\\"), "(W:)");
});

test("sem letra (caminho vazio) devolve o nome cru, sem parênteses vazios", () => {
  assert.equal(rotuloDrive("Alguma coisa", ""), "Alguma coisa");
});

test("letraDoDrive tira barras finais, de qualquer lado", () => {
  assert.equal(letraDoDrive("C:\\"), "C:");
  assert.equal(letraDoDrive("C:/"), "C:");
  assert.equal(letraDoDrive("C:\\\\"), "C:");
  assert.equal(letraDoDrive("C:"), "C:");
});
