// Originalmente lumen-788-empty-folder-contract.test.ts (#788). Renomeado por assunto (#1015 / HG3).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// #788 — regressão de invalidação de estado pós-esvaziar pasta (Bridge/Mail).
// Gate estrutural (tripwire): trava os invariantes que, se removidos, reintroduzem
// o bug relatado pelo PO — toast de sucesso com a lista velha + erro na revisita,
// esvaziar lento (1-a-1), toast hardcoded em inglês, mutação sem log.
// Roda com: node --experimental-strip-types --test <arquivo> (sem node_modules).

const controlRoom = readFileSync(
  new URL("../screens/control-room.tsx", import.meta.url),
  "utf8",
);
const graph = readFileSync(
  new URL("../../src-tauri/src/graph.rs", import.meta.url),
  "utf8",
);
const strings = readFileSync(new URL("./strings.ts", import.meta.url), "utf8");

function bracedBlock(source: string, marker: string): string {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `marcador ausente: ${marker}`);
  const open = source.indexOf("{", at);
  assert.notEqual(open, -1, `abertura ausente: ${marker}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(at, index + 1);
  }
  assert.fail(`fechamento ausente: ${marker}`);
}

test("#788 front: esvaziarPasta invalida o cache ANTES de confirmar sucesso", () => {
  const fn = bracedBlock(controlRoom, "async function esvaziarPasta(");
  const invalida = fn.indexOf("limparCachePasta(");
  const sucesso = fn.indexOf("toast.success(");
  assert.notEqual(invalida, -1, "não invalida o cache da pasta esvaziada");
  assert.notEqual(sucesso, -1, "não há toast de sucesso");
  assert.ok(
    invalida < sucesso,
    "o toast de sucesso vem ANTES da invalidação — lista serviria mensagens velhas (bug #788)",
  );
  // e dispara o refetch da lista/contagens depois de limpar o cache.
  assert.match(fn, /recarregarAposPasta\(/);
});

test("#788 front: erro do esvaziar passa por i18n (não hardcoded em inglês)", () => {
  const fn = bracedBlock(controlRoom, "async function esvaziarPasta(");
  const erro = bracedBlock(fn, "catch (e)");
  assert.match(erro, /t\.controlRoom\.erroAcao/, "erro deveria usar t.controlRoom.erroAcao");
  assert.doesNotMatch(
    erro,
    /didn't go through/i,
    "string de erro hardcoded em inglês (deveria ser i18n)",
  );
});

test("#788 i18n: strings do esvaziar existem nos DOIS locales (pt-BR + en)", () => {
  for (const chave of ["esvaziandoPasta", "pastaEsvaziada", "erroAcao"]) {
    const ocorrencias = strings.split(`${chave}:`).length - 1;
    assert.ok(
      ocorrencias >= 2,
      `${chave} deveria estar nos 2 locales (achei ${ocorrencias})`,
    );
  }
});

test("#788 backend: cr_esvaziar_pasta apaga em LOTE ($batch), não 1-a-1", () => {
  const fn = bracedBlock(graph, "pub fn cr_esvaziar_pasta(");
  assert.match(fn, /\$batch/, "não usa /$batch — voltou ao delete serial lento");
  assert.match(fn, /\.chunks\(/, "não fatia em lotes");
});

test("#788 backend: a mutação de esvaziar é logada (GALAXIE.log)", () => {
  const fn = bracedBlock(graph, "pub fn cr_esvaziar_pasta(");
  assert.match(fn, /log::info!/, "sem log::info do ciclo — some no silêncio (bug #788)");
  assert.match(fn, /log::error!/, "sem log::error na falha do batch");
});
