// Testes headless do resumo de op terminal (#898 fatia 2). Rode com:
//   node --test --experimental-strip-types src/components/explorer/resumo-op.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { montarResumoOp, type RotulosResumo } from "./resumo-op.ts";
import type { OpAtiva } from "./progresso-panel";
import type { FsOpProgress } from "../../lib/types.ts";

// Rótulos i18n (espelham as chaves pt-BR de `strings.ts`).
const R: RotulosResumo = {
  copiados: "Copiados {n} {arq}",
  copiadoUm: "Copiado {n} {arq}",
  movidos: "Movidos {n} {arq}",
  movidoUm: "Movido {n} {arq}",
  canceladoCopia: "Cancelado: cópia de {n} {arq}",
  canceladoMove: "Cancelado: movimentação de {n} {arq}",
  falhaCopia: "Falha ao copiar {n} {arq}",
  falhaMove: "Falha ao mover {n} {arq}",
  parcial: "Parcial: {done} de {total} {arq}",
  paraDestino: "→ {destino}",
  arquivoUm: "arquivo",
  arquivos: "arquivos",
};

/** Fixture mínima de OpAtiva terminal. */
function op(
  campos: {
    tipo?: "copy" | "move";
    status: string;
    filesTotal?: number;
    filesDone?: number;
    processedBytes?: number;
    destino?: string;
  },
): OpAtiva {
  const progresso = {
    opId: 1,
    processedBytes: campos.processedBytes ?? 0,
    totalBytes: campos.processedBytes ?? 0,
    percent: 100,
    etaMs: null,
    filesTotal: campos.filesTotal ?? 0,
    filesDone: campos.filesDone ?? 0,
    bytesPerSec: 0,
    verifying: false,
    done: true,
    canceled: campos.status === "canceled",
    error: null,
    opKind: campos.tipo ?? "copy",
    phase: "done",
    status: campos.status,
    currentFile: null,
    startedAtMs: 0,
    completedAtMs: 1,
  } as FsOpProgress;
  return {
    opId: 1,
    tipo: campos.tipo ?? "copy",
    progresso,
    velocidade: 0,
    destino: campos.destino,
  };
}

test("copy success (plural) → 'Copiados N arquivos' + destino", () => {
  const r = montarResumoOp(
    op({ tipo: "copy", status: "success", filesTotal: 3, destino: "Downloads" }),
    R,
  );
  assert.equal(r.titulo, "Copiados 3 arquivos");
  assert.equal(r.subtitulo, "→ Downloads");
});

test("copy success (singular) → 'Copiado 1 arquivo'", () => {
  const r = montarResumoOp(
    op({ tipo: "copy", status: "success", filesTotal: 1, destino: "Downloads" }),
    R,
  );
  assert.equal(r.titulo, "Copiado 1 arquivo");
});

test("move success (plural) → 'Movidos N arquivos' + destino", () => {
  const r = montarResumoOp(
    op({ tipo: "move", status: "success", filesTotal: 12, destino: "Documentos" }),
    R,
  );
  assert.equal(r.titulo, "Movidos 12 arquivos");
  assert.equal(r.subtitulo, "→ Documentos");
});

test("move success (singular) → 'Movido 1 arquivo'", () => {
  const r = montarResumoOp(
    op({ tipo: "move", status: "success", filesTotal: 1, destino: "Documentos" }),
    R,
  );
  assert.equal(r.titulo, "Movido 1 arquivo");
});

test("canceled copy → 'Cancelado: cópia de N arquivos'", () => {
  const r = montarResumoOp(
    op({ tipo: "copy", status: "canceled", filesTotal: 3, destino: "Downloads" }),
    R,
  );
  assert.equal(r.titulo, "Cancelado: cópia de 3 arquivos");
});

test("canceled move → 'Cancelado: movimentação de N arquivos'", () => {
  const r = montarResumoOp(
    op({ tipo: "move", status: "canceled", filesTotal: 2, destino: "Documentos" }),
    R,
  );
  assert.equal(r.titulo, "Cancelado: movimentação de 2 arquivos");
});

test("error copy → 'Falha ao copiar N arquivos'", () => {
  const r = montarResumoOp(
    op({ tipo: "copy", status: "error", filesTotal: 3, destino: "Downloads" }),
    R,
  );
  assert.equal(r.titulo, "Falha ao copiar 3 arquivos");
});

test("error move → 'Falha ao mover N arquivos'", () => {
  const r = montarResumoOp(
    op({ tipo: "move", status: "error", filesTotal: 5, destino: "Documentos" }),
    R,
  );
  assert.equal(r.titulo, "Falha ao mover 5 arquivos");
});

test("partial → 'Parcial: done de total arquivos'", () => {
  const r = montarResumoOp(
    op({
      tipo: "copy",
      status: "partial",
      filesTotal: 3,
      filesDone: 2,
      destino: "Downloads",
    }),
    R,
  );
  assert.equal(r.titulo, "Parcial: 2 de 3 arquivos");
});

test("destino ausente → subtítulo cai no total de bytes (formatBytes)", () => {
  const r = montarResumoOp(
    op({ tipo: "copy", status: "success", filesTotal: 3, processedBytes: 2048 }),
    R,
  );
  assert.equal(r.titulo, "Copiados 3 arquivos");
  assert.equal(r.subtitulo, "2.0 KB");
});

test("destino vazio ('') também cai no fallback de bytes", () => {
  const r = montarResumoOp(
    op({
      tipo: "copy",
      status: "success",
      filesTotal: 3,
      processedBytes: 0,
      destino: "",
    }),
    R,
  );
  assert.equal(r.subtitulo, "0 B");
});

test("filesTotal 0 → substantivo cai no plural", () => {
  const r = montarResumoOp(
    op({ tipo: "copy", status: "success", filesTotal: 0, destino: "Downloads" }),
    R,
  );
  assert.equal(r.titulo, "Copiados 0 arquivos");
});
