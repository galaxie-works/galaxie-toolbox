import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  classificarIcone,
  ehRaster,
  svgSuspeitoBranco,
  type ClasseIcone,
} from "./icones-integridade.ts";

/**
 * #1153 (fatia 1): o GATE de integridade de FORMATO dos ícones. A causa-raiz do
 * card é que `icon:true` era afirmação do gerador — NENHUM teste abria os
 * arquivos, então 210 raster renomeados `.svg` (não renderizam) e 10 SVGs brancos
 * passavam "verdes". Este teste lê os MAGIC BYTES de todo `public/app-icons/*.svg`
 * e faz `icon:true` significar VERIFICADO.
 *
 * Sequenciamento (baseline-ratchet): os 210 já existentes ficam numa baseline
 * explícita (`icones-baseline.json`) pra o CI não quebrar ANTES da remediação
 * (fatia 2, dependente da curadoria #1155). O gate barra QUALQUER violação NOVA
 * na hora; a baseline só encolhe. Quando zerar, vira hard-fail puro e o card fecha.
 */

const iconesDir = new URL("../../public/app-icons/", import.meta.url);
const baseline = JSON.parse(
  readFileSync(new URL("./icones-baseline.json", import.meta.url), "utf8"),
) as { raster: string[]; branco: string[] };

function bytes(...b: number[]): Uint8Array {
  return Uint8Array.from(b);
}
function svgBytes(texto: string): Uint8Array {
  return new TextEncoder().encode(texto);
}

// ─────────────────────── classificarIcone (puro, magic bytes) ───────────────

test("#1153: classifica raster por magic bytes (não pela extensão)", () => {
  assert.equal(classificarIcone(bytes(0xff, 0xd8, 0xff, 0xe0)), "jpeg");
  assert.equal(classificarIcone(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)), "png");
  // RIFF....WEBP
  assert.equal(
    classificarIcone(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)),
    "webp",
  );
  assert.equal(classificarIcone(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), "gif");
  // RIFF sem WEBP (ex.: WAV) não é webp.
  assert.equal(
    classificarIcone(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)),
    "desconhecido",
  );
});

test("#1153: classifica SVG real (com/sem prolog XML, BOM, espaço)", () => {
  assert.equal(classificarIcone(svgBytes('<svg xmlns="...">')), "svg");
  assert.equal(classificarIcone(svgBytes('<?xml version="1.0"?><svg>')), "svg");
  assert.equal(classificarIcone(svgBytes("﻿  \n<svg>")), "svg");
  assert.equal(classificarIcone(svgBytes("<!-- gerado -->\n<svg>")), "svg");
});

test("#1153: vazio e não-SVG desconhecido", () => {
  assert.equal(classificarIcone(bytes()), "vazio");
  assert.equal(classificarIcone(svgBytes("só um texto qualquer")), "desconhecido");
  assert.equal(classificarIcone(svgBytes("{\"json\":true}")), "desconhecido");
});

test("#1153: ehRaster reconhece as classes de imagem", () => {
  for (const c of ["jpeg", "png", "webp", "gif"] as ClasseIcone[]) assert.ok(ehRaster(c));
  for (const c of ["svg", "vazio", "desconhecido"] as ClasseIcone[]) assert.ok(!ehRaster(c));
});

// ─────────────────────── svgSuspeitoBranco (heurística) ─────────────────────

test("#1153: svgSuspeitoBranco só quando branco e sem outra cor/currentColor", () => {
  assert.ok(svgSuspeitoBranco('<svg><path fill="#fff" d="..."/></svg>'));
  assert.ok(svgSuspeitoBranco('<svg><path fill="white"/></svg>'));
  // currentColor herda a cor do tema → visível → não é "só branco".
  assert.ok(!svgSuspeitoBranco('<svg><path fill="currentColor"/></svg>'));
  // tem uma cor não-branca → visível no claro.
  assert.ok(!svgSuspeitoBranco('<svg><path fill="#fff"/><path fill="#1a73e8"/></svg>'));
  // sem branco nenhum.
  assert.ok(!svgSuspeitoBranco('<svg><path fill="#000"/></svg>'));
});

// ─────────────────────── o GATE: scan dos arquivos reais ─────────────────────

/** Classifica todo `*.svg` do diretório uma vez (compartilhado pelos testes). */
function escanear() {
  const raster: string[] = [];
  const desconhecido: string[] = [];
  const vazio: string[] = [];
  const branco: string[] = [];
  for (const f of readdirSync(iconesDir)) {
    if (!f.endsWith(".svg")) continue;
    const id = f.slice(0, -4);
    const buf = readFileSync(new URL(f, iconesDir));
    const classe = classificarIcone(buf);
    if (classe === "vazio") vazio.push(id);
    else if (ehRaster(classe)) raster.push(id);
    else if (classe === "desconhecido") desconhecido.push(id);
    else if (svgSuspeitoBranco(buf.toString("utf8"))) branco.push(id);
  }
  return { raster, desconhecido, vazio, branco };
}
const atual = escanear();

test("#1153: nenhum ícone .svg VAZIO ou binário DESCONHECIDO (hard, sem baseline)", () => {
  assert.deepEqual(atual.vazio, [], "arquivos .svg de 0 byte");
  assert.deepEqual(atual.desconhecido, [], "conteúdo que não é SVG nem imagem conhecida");
});

test("#1153 (RATCHET): nenhum raster NOVO renomeado .svg fora da baseline", () => {
  const novos = atual.raster.filter((id) => !baseline.raster.includes(id));
  assert.deepEqual(
    novos,
    [],
    "JPEG/PNG/WEBP renomeado .svg fora da baseline — renderiza a inicial, não o ícone. " +
      "Entregue SVG real ou renomeie pra extensão correta (ver #1153).",
  );
});

test("#1153 (RATCHET): nenhum SVG só-branco NOVO fora da baseline", () => {
  const novos = atual.branco.filter((id) => !baseline.branco.includes(id));
  assert.deepEqual(
    novos,
    [],
    "SVG só-branco fora da baseline — some no tema claro. Use currentColor ou fundo próprio.",
  );
});

test("#1153: a baseline não regrediu além do medido (210 raster / é o teto)", () => {
  // O gate nasce com 210 raster conhecidos; a baseline só pode ENCOLHER (fatia 2).
  // Este teto prova que a medição do card (210) é a que está no gate — não maior.
  assert.ok(
    atual.raster.length <= baseline.raster.length,
    `raster atual (${atual.raster.length}) não pode passar da baseline (${baseline.raster.length})`,
  );
});
