// #869: a aritmética da largura-auto do sidebar (adendo do Wagner, item 1).
// Rode com:
//   node --test --experimental-strip-types src/lib/largura-painel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chaveLayout,
  larguraIdealPct,
  temLayoutSalvo,
} from "./largura-painel.ts";

function storage(valor: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => valor };
}

test("a chave é a mesma que o react-resizable-panels usa", () => {
  assert.equal(
    chaveLayout("explorer.layout.v1"),
    "react-resizable-panels:explorer.layout.v1",
  );
});

test("layout salvo MANDA — quem já arrastou não é sobrescrito", () => {
  assert.equal(temLayoutSalvo("explorer.layout.v1", storage("{}")), true);
  assert.equal(temLayoutSalvo("explorer.layout.v1", storage(null)), false);
});

test("storage que lança conta como 'tem layout' — na dúvida, não mexo", () => {
  const explode: Pick<Storage, "getItem"> = {
    getItem() {
      throw new Error("storage bloqueado");
    },
  };
  assert.equal(temLayoutSalvo("explorer.layout.v1", explode), true);
});

test("converte px em % do grupo, somando a folga", () => {
  // 200px de conteúdo + 40 de folga = 240 de 1000 = 24%
  assert.equal(
    larguraIdealPct({
      conteudoPx: 200,
      folgaPx: 40,
      grupoPx: 1000,
      minPct: 16,
      maxPct: 42,
    }),
    24,
  );
});

test("respeita os limites do painel nas duas pontas", () => {
  // caption gigante não pode engolir a tela
  assert.equal(
    larguraIdealPct({
      conteudoPx: 900,
      folgaPx: 40,
      grupoPx: 1000,
      minPct: 16,
      maxPct: 42,
    }),
    42,
  );
  // e caption minúsculo não pode espremer o painel abaixo do mínimo
  assert.equal(
    larguraIdealPct({
      conteudoPx: 10,
      folgaPx: 0,
      grupoPx: 1000,
      minPct: 16,
      maxPct: 42,
    }),
    16,
  );
});

test("medida tirada cedo demais devolve null em vez de número inventado", () => {
  const base = { conteudoPx: 200, folgaPx: 40, minPct: 16, maxPct: 42 };
  assert.equal(larguraIdealPct({ ...base, grupoPx: 0 }), null);
  assert.equal(larguraIdealPct({ ...base, grupoPx: -1 }), null);
  assert.equal(
    larguraIdealPct({ ...base, conteudoPx: 0, grupoPx: 1000 }),
    null,
  );
});
