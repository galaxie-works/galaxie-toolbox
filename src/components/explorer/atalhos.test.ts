import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATALHOS,
  ORDEM_CATEGORIAS_ATALHO,
  atalhosDe,
  formatarCombo,
} from "./atalhos.ts";

test("#733 ids únicos", () => {
  const ids = ATALHOS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("#733 toda categoria da ordem tem atalho + todo atalho está na ordem", () => {
  for (const cat of ORDEM_CATEGORIAS_ATALHO) {
    assert.ok(atalhosDe(cat).length > 0, `categoria vazia: ${cat}`);
  }
  for (const a of ATALHOS) {
    assert.ok(
      ORDEM_CATEGORIAS_ATALHO.includes(a.categoria),
      `categoria fora da ordem: ${a.categoria}`,
    );
  }
});

test("#733 todo atalho tem ao menos um combo não-vazio", () => {
  for (const a of ATALHOS) {
    assert.ok(a.combos.length > 0, `sem combo: ${a.id}`);
    for (const c of a.combos) assert.ok(c.length > 0, `combo vazio: ${a.id}`);
  }
});

test("#733 formatarCombo junta com +", () => {
  assert.equal(formatarCombo(["Ctrl", "C"]), "Ctrl+C");
  assert.equal(formatarCombo(["F2"]), "F2");
  assert.equal(formatarCombo(["Ctrl", "Shift", "N"]), "Ctrl+Shift+N");
});

test("#733 cobre os atalhos-chave do PO (#714/#733)", () => {
  const ids = new Set(ATALHOS.map((a) => a.id));
  for (const req of [
    "renomear",
    "limparSelecao",
    "copiar",
    "recortar",
    "colar",
    "novaPasta",
    "voltar",
    "atualizar",
  ]) {
    assert.ok(ids.has(req), `faltou atalho: ${req}`);
  }
});
