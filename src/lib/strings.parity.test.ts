import assert from "node:assert/strict";
import { test } from "node:test";

import { DICIONARIOS } from "./strings.ts";

// #464 (S0): paridade de chaves pt-BR ↔ en. Uma chave presente num lado e ausente
// no outro vira `undefined` em runtime na UI. O TS já reprova (o tipo do `en`
// espelha o `pt`), mas este teste é a rede de segurança em runtime — e falha de
// forma legível apontando QUAIS chaves divergem.
//
// Rodar: node --test --experimental-strip-types src/lib/strings.parity.test.ts

function chavesAchatadas(dic: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [ns, grupo] of Object.entries(dic)) {
    if (grupo && typeof grupo === "object") {
      for (const k of Object.keys(grupo as Record<string, unknown>)) {
        out.push(`${ns}.${k}`);
      }
    }
  }
  return out.sort();
}

test("#464 paridade de chaves pt-BR ↔ en", () => {
  const pt = chavesAchatadas(DICIONARIOS["pt-BR"] as Record<string, unknown>);
  const en = chavesAchatadas(DICIONARIOS.en as Record<string, unknown>);
  const soPt = pt.filter((k) => !en.includes(k));
  const soEn = en.filter((k) => !pt.includes(k));
  assert.deepEqual(soPt, [], `chaves só em pt-BR (faltam no en): ${soPt.join(", ")}`);
  assert.deepEqual(soEn, [], `chaves só em en (faltam no pt-BR): ${soEn.join(", ")}`);
});

test("#464 os dois idiomas têm os mesmos namespaces", () => {
  const nsPt = Object.keys(DICIONARIOS["pt-BR"]).sort();
  const nsEn = Object.keys(DICIONARIOS.en).sort();
  assert.deepEqual(nsPt, nsEn);
});
