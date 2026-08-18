// Testes headless do helper de tempo relativo (#898 spike). Rode com:
//   node --test --experimental-strip-types src/components/explorer/tempo-relativo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatarTempoRelativo, type RotulosTempo } from "./tempo-relativo.ts";

const R: RotulosTempo = {
  agora: "agora",
  minAtras: "{n} min atrás",
  horasAtras: "{n} h atrás",
  ontem: "ontem",
  diasAtras: "{n} dias atrás",
};

const AGORA = 1_700_000_000_000; // epoch fixo de referência
const seg = (n: number) => n * 1000;
const min = (n: number) => n * 60_000;
const hora = (n: number) => n * 3_600_000;
const dia = (n: number) => n * 86_400_000;

test("< 60 s → 'agora'", () => {
  assert.equal(formatarTempoRelativo(AGORA, AGORA, R), "agora");
  assert.equal(formatarTempoRelativo(AGORA - seg(59), AGORA, R), "agora");
});

test("minutos", () => {
  assert.equal(formatarTempoRelativo(AGORA - min(1), AGORA, R), "1 min atrás");
  assert.equal(formatarTempoRelativo(AGORA - min(2), AGORA, R), "2 min atrás");
  assert.equal(formatarTempoRelativo(AGORA - min(59), AGORA, R), "59 min atrás");
});

test("horas", () => {
  assert.equal(formatarTempoRelativo(AGORA - hora(1), AGORA, R), "1 h atrás");
  assert.equal(formatarTempoRelativo(AGORA - hora(23), AGORA, R), "23 h atrás");
});

test("ontem = exatamente 1 dia; ≥ 2 dias → dias", () => {
  assert.equal(formatarTempoRelativo(AGORA - dia(1), AGORA, R), "ontem");
  assert.equal(formatarTempoRelativo(AGORA - dia(2), AGORA, R), "2 dias atrás");
  assert.equal(formatarTempoRelativo(AGORA - dia(10), AGORA, R), "10 dias atrás");
});

test("relógio à frente (skew negativo) cai em 'agora'", () => {
  assert.equal(formatarTempoRelativo(AGORA + min(5), AGORA, R), "agora");
});
