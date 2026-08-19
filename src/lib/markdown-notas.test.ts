// #1321 — o parser das notas de release. Casos tirados do corpo REAL da v0.46.0
// (medido no `latest.json`/release publicada), mais os hostis.
// Rode com:  node --test --experimental-strip-types src/lib/markdown-notas.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { blocosDeNotas, trechos } from "./markdown-notas.ts";

const REAL = `## 🔔 Atualização do app — só quando há novidade de verdade
- **O aviso de atualização só aparece quando existe uma versão mais nova** que a instalada.
- **O aviso agora mostra o que mudou** — estas notas, no idioma do app (pt-BR / en).

## 🪟 Janela
- **Minimizar, maximizar e fechar voltaram a funcionar** nos controles da barra de título.`;

test("corpo real da v0.46.0: vira título + lista, sem sobrar markdown cru", () => {
  const b = blocosDeNotas(REAL);
  assert.deepEqual(
    b.map((x) => x.tipo),
    ["titulo", "lista", "titulo", "lista"]
  );
  const texto = JSON.stringify(b);
  assert.ok(!texto.includes("##"), "sobrou '##' no resultado");
  assert.ok(!texto.includes("**"), "sobrou '**' no resultado");
});

test("o título mantém o emoji e perde só o marcador", () => {
  const [t] = blocosDeNotas("## 🪟 Janela");
  assert.equal(t.tipo, "titulo");
  assert.equal(t.tipo === "titulo" && t.trechos[0].texto, "🪟 Janela");
});

test("`**negrito**` vira trecho forte, e o resto da linha continua texto", () => {
  const t = trechos("**Minimizar** voltou a funcionar");
  assert.deepEqual(t, [
    { texto: "Minimizar", forte: true },
    { texto: " voltou a funcionar" },
  ]);
});

test("lista aceita `-` e `*`, e itens acumulam no mesmo bloco", () => {
  const [b] = blocosDeNotas("- um\n* dois");
  assert.equal(b.tipo, "lista");
  assert.equal(b.tipo === "lista" && b.itens.length, 2);
});

test("linhas soltas viram parágrafo; linha em branco separa blocos", () => {
  const b = blocosDeNotas("primeira\nsegunda\n\n- item");
  assert.deepEqual(b.map((x) => x.tipo), ["paragrafo", "lista"]);
  assert.equal(b[0].tipo === "paragrafo" && b[0].trechos[0].texto, "primeira segunda");
});

// --- segurança: negar HTML é ESTRUTURAL, não filtrado ---------------------

test("HTML do feed NÃO vira marcação — fica texto literal", () => {
  const [b] = blocosDeNotas('<script>alert(1)</script>');
  assert.equal(b.tipo, "paragrafo");
  // O parser não conhece HTML: devolve o texto como veio, e o React escapa.
  assert.equal(b.tipo === "paragrafo" && b.trechos[0].texto, "<script>alert(1)</script>");
});

test("link só existe com http(s) — `javascript:` fica literal, sem href", () => {
  const bom = trechos("[docs](https://galaxie.works)");
  assert.deepEqual(bom, [{ texto: "docs", href: "https://galaxie.works" }]);

  for (const veneno of ["javascript:alert(1)", "data:text/html,<b>", "file:///c:/"]) {
    const t = trechos(`[clique](${veneno})`);
    // Afirma COMPORTAMENTO, não representação: pode sair em 1 ou N trechos
    // (o `)` de `alert(1)` fecha o link cedo), desde que nenhum vire link e
    // nenhum caractere suma da tela.
    assert.deepEqual(
      t.filter((x) => x.href !== undefined),
      [],
      `${veneno} não pode virar href`
    );
    assert.equal(
      t.map((x) => x.texto).join(""),
      `[clique](${veneno})`,
      "o texto do link não pode sumir nem mudar"
    );
  }
});

// --- robustez: nota nunca some da tela ------------------------------------

test("markdown desconhecido fica literal em vez de sumir", () => {
  const [b] = blocosDeNotas("| tabela | que | nao | suportamos |");
  assert.equal(b.tipo === "paragrafo" && b.trechos[0].texto, "| tabela | que | nao | suportamos |");
});

test("`**` sem fechamento não engole o resto da linha", () => {
  const t = trechos("**aberto e nunca fechado");
  assert.deepEqual(t, [{ texto: "**aberto e nunca fechado" }]);
});

test("entrada vazia devolve zero blocos (o componente não renderiza nada)", () => {
  assert.deepEqual(blocosDeNotas(""), []);
  assert.deepEqual(blocosDeNotas("\n\n   \n"), []);
});

test("CRLF do feed do Windows não vira lixo", () => {
  const b = blocosDeNotas("## T\r\n- item\r\n");
  assert.deepEqual(b.map((x) => x.tipo), ["titulo", "lista"]);
});
