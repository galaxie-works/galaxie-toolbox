// #1306 — a lista de permissões do Tauri tem de bater com o que o app chama.
//
// O card pedia UMA linha (`core:window:allow-unminimize`). A linha fecha o card;
// ela não fecha o problema. Permissão ausente **rejeita em silêncio**: o botão
// responde ao hover e nada acontece, sem erro em lugar nenhum. Foi assim que a
// regressão do #1179 chegou à produção sem deixar rastro, e foi por isso que
// levou uma investigação inteira pra achar.
//
// Então a catraca: comando de janela chamado no fonte exige permissão declarada,
// e a superfície `core:window:*` fica pinada — ampliar ou reduzir o que o app
// pode fazer passa a exigir tocar este arquivo, de propósito.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CAPABILITIES = join(RAIZ, "src-tauri", "capabilities", "default.json");
const SRC = join(RAIZ, "src");

/** O módulo que dá acesso à janela nativa. Quem o importa, fala com ela. */
const MODULO_JANELA = "@tauri-apps/api/window";

/**
 * Arquivos que hoje falam com a janela. NÃO é uma lista de manutenção manual —
 * o teste abaixo confere que ela é exatamente o conjunto de arquivos que
 * importam o módulo. Se alguém passar a mexer na janela de um arquivo novo,
 * reprova aqui e é obrigado a olhar as permissões.
 */
const FONTES_JANELA = [
  "components/barra-janela.tsx",
  "lib/splash.ts",
  // Achado PELA guarda: eu tinha listado dois arquivos e o `tema.ts` chama
  // `setTheme` — a permissão existia, o meu inventário é que estava incompleto.
  "lib/tema.ts",
];

/** `toggleMaximize` → `toggle-maximize` (o formato dos ids de permissão). */
function kebab(nome: string): string {
  return nome.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function arquivosDe(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivosDe(p, acc);
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) acc.push(p);
  }
  return acc;
}

const capabilities = JSON.parse(readFileSync(CAPABILITIES, "utf8")) as {
  permissions: string[];
};
const permissoes = new Set(capabilities.permissions);

describe("#1306 capabilities × chamadas de janela", () => {
  it("a lista de fontes é o conjunto REAL de quem importa a janela", () => {
    const importam = arquivosDe(SRC)
      .filter((p) => readFileSync(p, "utf8").includes(MODULO_JANELA))
      .map((p) => p.slice(SRC.length + 1).replace(/\\/g, "/"))
      .sort();
    // Sem isto o teste envelheceria em silêncio: um arquivo novo chamando
    // `unminimize()` não seria varrido e a permissão faltante voltaria a ser
    // invisível — exatamente o modo de falha que este card registra.
    assert.deepEqual(
      importam,
      [...FONTES_JANELA].sort(),
      "alguém passou a falar com a janela de um arquivo fora da lista — confira as permissões e atualize FONTES_JANELA",
    );
  });

  it("todo comando de janela chamado no fonte tem permissão declarada", () => {
    const chamados = new Set<string>();
    for (const rel of FONTES_JANELA) {
      const fonte = readFileSync(join(SRC, rel), "utf8");
      assert.ok(
        fonte.includes(MODULO_JANELA),
        `${rel} não fala mais com a janela — a lista está velha`,
      );
      // Os objetos-janela deste código: `j`, `janela`, `splash` e o retorno
      // direto de `getCurrentWindow()`.
      for (const m of fonte.matchAll(
        /\b(?:j|janela|splash|getCurrentWindow\(\))\.([a-zA-Z]+)\(/g,
      )) {
        const cmd = m[1];
        // `onResized`/`onCloseRequested` são LISTENERS de evento, não comandos:
        // não passam pelo gate de permissão.
        if (/^on[A-Z]/.test(cmd)) continue;
        chamados.add(cmd);
      }
    }
    assert.ok(chamados.size > 0, "não achei chamada de janela nenhuma — regex morta");

    const semPermissao = [...chamados]
      .map((c) => ({ cmd: c, perm: `core:window:allow-${kebab(c)}` }))
      .filter(({ perm }) => !permissoes.has(perm));
    assert.deepEqual(
      semPermissao,
      [],
      "comando de janela chamado sem permissão — falharia em SILÊNCIO em runtime",
    );
  });

  it("a superfície core:window está pinada (ampliar exige passar por aqui)", () => {
    const janela = capabilities.permissions
      .filter((p) => p.startsWith("core:window:"))
      .sort();
    assert.deepEqual(janela, [
      "core:window:allow-close",
      "core:window:allow-is-maximized",
      "core:window:allow-minimize",
      "core:window:allow-set-theme",
      "core:window:allow-show",
      "core:window:allow-start-dragging",
      "core:window:allow-toggle-maximize",
      // #1306: sem chamador HOJE. Declarada porque restaurar a janela por
      // código é o próximo passo natural dos controles que já desenhamos, e
      // sem ela a primeira tentativa falha calada.
      "core:window:allow-unminimize",
    ]);
  });
});
