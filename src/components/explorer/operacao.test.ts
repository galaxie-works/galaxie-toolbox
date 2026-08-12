// Testes headless dos helpers puros da transferência com progresso (#724).
// Rode com:
//   node --test --experimental-strip-types src/components/explorer/operacao.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calcVelocidade,
  formatarEta,
  nomeManterAmbos,
  planejarTransferencia,
  type ResolucaoConflito,
} from "./operacao.ts";
import type { FsConflict } from "../../lib/types.ts";

function conflito(name: string, isDir = false): FsConflict {
  return {
    source: `C:\\origem\\${name}`,
    name,
    dest: `C:\\destino\\${name}`,
    isDir,
  };
}

const UNID = { seg: "s", min: "min", hora: "h" };

test("nomeManterAmbos preserva extensão e pula ocupados", () => {
  assert.equal(nomeManterAmbos("foto.png", new Set()), "foto (2).png");
  assert.equal(nomeManterAmbos("Pasta", new Set()), "Pasta (2)");
  assert.equal(
    nomeManterAmbos("foto.png", new Set(["foto (2).png"])),
    "foto (3).png",
  );
  // Case-insensitive como o NTFS.
  assert.equal(
    nomeManterAmbos("Foto.PNG", new Set(["foto (2).png"])),
    "Foto (3).PNG",
  );
});

test("planejarTransferencia: sem conflito usa o nome original", () => {
  const plano = planejarTransferencia(
    ["C:\\origem\\a.txt", "C:\\origem\\b.txt"],
    "C:\\destino",
    [],
    "substituir",
  );
  assert.deepEqual(plano, [
    { from: "C:\\origem\\a.txt", to: "C:\\destino\\a.txt" },
    { from: "C:\\origem\\b.txt", to: "C:\\destino\\b.txt" },
  ]);
});

test("planejarTransferencia: pular remove o conflitante, mantém os demais", () => {
  const plano = planejarTransferencia(
    ["C:\\origem\\a.txt", "C:\\origem\\b.txt"],
    "C:\\destino",
    [conflito("a.txt")],
    "pular",
  );
  assert.deepEqual(plano, [
    { from: "C:\\origem\\b.txt", to: "C:\\destino\\b.txt" },
  ]);
});

test("planejarTransferencia: substituir mantém o mesmo destino", () => {
  const plano = planejarTransferencia(
    ["C:\\origem\\a.txt"],
    "C:\\destino",
    [conflito("a.txt")],
    "substituir",
  );
  assert.deepEqual(plano, [
    { from: "C:\\origem\\a.txt", to: "C:\\destino\\a.txt" },
  ]);
});

test("planejarTransferencia: manter ambos gera nomes únicos sem colidir no lote", () => {
  // Duas fontes com o MESMO nome-base em conflito → (2) e (3), sem repetir.
  const plano = planejarTransferencia(
    ["C:\\origem1\\a.txt", "C:\\origem2\\a.txt"],
    "C:\\destino",
    [conflito("a.txt")],
    "manterAmbos",
  );
  assert.deepEqual(plano, [
    { from: "C:\\origem1\\a.txt", to: "C:\\destino\\a (2).txt" },
    { from: "C:\\origem2\\a.txt", to: "C:\\destino\\a (3).txt" },
  ]);
});

test("formatarEta cobre s / min / h e casos inválidos", () => {
  assert.equal(formatarEta(45_000, UNID), "45 s");
  assert.equal(formatarEta(120_000, UNID), "2 min");
  assert.equal(formatarEta(150_000, UNID), "2 min 30 s");
  assert.equal(formatarEta(3_900_000, UNID), "1 h 5 min");
  assert.equal(formatarEta(3_600_000, UNID), "1 h");
  assert.equal(formatarEta(null, UNID), null);
  assert.equal(formatarEta(-1, UNID), null);
  assert.equal(formatarEta(Number.POSITIVE_INFINITY, UNID), null);
});

test("calcVelocidade: delta positivo por segundo; ruído vira 0", () => {
  assert.equal(calcVelocidade(2_000, 1_000, 1_000), 1_000);
  assert.equal(calcVelocidade(1_000, 1_000, 1_000), 0); // sem avanço
  assert.equal(calcVelocidade(500, 1_000, 1_000), 0); // retrocesso
  assert.equal(calcVelocidade(2_000, 1_000, 0), 0); // tempo zero
});

// Garante que o tipo exportado é utilizável (documenta o contrato).
const _r: ResolucaoConflito = "manterAmbos";
void _r;
