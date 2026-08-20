// #1393 — o capturador de QA visual não pode aceitar cenário que não funciona.
//
// O AC3 é literal: "todo valor aceito do `ValidateSet` funciona; cenário que não
// funciona sai da lista ou é consertado (não fica como armadilha)". O
// `onedrive-my-files` era aceito e morria no primeiro clique — quem escolhesse
// levava um erro que PARECIA falha de captura.
//
// O que este teste pode e o que não pode:
//   PODE  — pegar as duas causas ESTÁTICAS que o próprio script lista como
//           típicas: valor aceito sem definição, e texto de prontidão que saiu
//           do dicionário (a causa nº 3 do bloco de diagnóstico).
//   NÃO PODE — provar que os passos de UI ainda existem: isso só o runtime diz,
//           e é por isso que o script tem o diagnóstico que nomeia o passo e
//           lista o que havia na tela. A travessia real fica na PR, com os PNGs.
//
// Digo isto em voz alta porque guarda que finge cobrir o runtime é pior que
// guarda nenhuma — foi o que deixou este cenário apodrecer.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DICIONARIOS } from "./strings.ts";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const SCRIPT = readFileSync(
  join(RAIZ, "scripts", "Capturar-QA-Visual.ps1"),
  "utf8",
);

/** Os valores que o `-Scenario` aceita. */
function valoresAceitos(): string[] {
  const m = SCRIPT.match(/\[ValidateSet\(([^)]*)\)\]/);
  assert.ok(m, "não achei o ValidateSet — o script mudou de forma");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** As chaves do mapa `$scenarios`, e o `ReadyText` de cada uma. */
function cenariosDefinidos(): Map<string, string> {
  const mapa = new Map<string, string>();
  const bloco = SCRIPT.slice(SCRIPT.indexOf("$scenarios = @{"));
  for (const m of bloco.matchAll(
    /"([a-z0-9-]+)" = @\{([\s\S]*?)\n {2}\}/g,
  )) {
    const pronto = m[2].match(/ReadyText\s*=\s*"([^"]+)"/);
    assert.ok(pronto, `cenário "${m[1]}" sem ReadyText`);
    mapa.set(m[1], pronto[1]);
  }
  return mapa;
}

/** Toda string de todos os dicionários, achatada. */
function todasAsStrings(): Set<string> {
  const fora = new Set<string>();
  const anda = (v: unknown) => {
    if (typeof v === "string") fora.add(v);
    else if (v && typeof v === "object")
      for (const x of Object.values(v)) anda(x);
  };
  anda(DICIONARIOS);
  return fora;
}

describe("#1393 capturador de QA visual", () => {
  it("todo valor aceito tem cenário definido — nenhum é armadilha", () => {
    const aceitos = valoresAceitos();
    const definidos = cenariosDefinidos();
    assert.ok(aceitos.length > 0, "ValidateSet vazio — regex morta");
    for (const v of aceitos) {
      assert.ok(
        definidos.has(v),
        `"-Scenario ${v}" é aceito mas não existe no mapa $scenarios`,
      );
    }
    // E o inverso: cenário definido e NÃO aceito é código morto no script.
    for (const k of definidos.keys()) {
      assert.ok(
        aceitos.includes(k),
        `cenário "${k}" está definido mas o ValidateSet não o aceita`,
      );
    }
  });

  it("o texto de prontidão de cada cenário ainda existe no dicionário", () => {
    // Causa nº3 do diagnóstico do próprio script: "o texto de prontidao mudou
    // de copy". Estaticamente dá pra pegar ANTES de a QA descobrir na captura.
    const strings = todasAsStrings();
    for (const [cenario, pronto] of cenariosDefinidos()) {
      assert.ok(
        strings.has(pronto),
        `ReadyText "${pronto}" (cenário "${cenario}") não existe em nenhum dicionário — a copy mudou e o cenário vai morrer num wait mudo`,
      );
    }
  });

  it("o diagnóstico que nomeia o passo e a tela continua no script", () => {
    // AC2 pede "preservar". Guarda contra alguém simplificar o catch e devolver
    // o timeout mudo que mascarou este bug.
    for (const marca of [
      "Isto NAO e falha de captura",
      "os passos de navegacao do cenario envelheceram",
      "Tela atual:",
    ]) {
      assert.ok(
        SCRIPT.includes(marca),
        `o bloco de diagnóstico perdeu "${marca}"`,
      );
    }
  });
});
