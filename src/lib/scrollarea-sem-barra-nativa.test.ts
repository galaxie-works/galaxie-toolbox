// #1276 — as 5 superfícies com scrollbar nativo (sidebars do Files/Bridge/People,
// grid do People, menu Filter) têm UMA causa, e ela não está em nenhuma delas.
//
// CAUSA RAIZ: o radix esconde o scrollbar nativo injetando um `<style>` INLINE
// dentro do Viewport (`ScrollAreaViewportStyle`, em @radix-ui/react-scroll-area).
// A CSP que o Tauri ENTREGA traz um nonce em `style-src`, e nonce na diretiva
// **anula o `unsafe-inline` dela** (spec de CSP; medido no app buildado no
// #1278). O style do radix nunca aplica no app → toda `<ScrollArea>` mostra a
// barra nativa do WebView2. Nenhuma das 5 telas tinha sido tocada: o que mudou
// foi a política, não o componente.
//
// ⚠️ POR QUE ESTE TESTE OLHA O ARTEFATO, e não o DOM:
// no vitest **não existe CSP**, então lá o `<style>` do radix funciona e um
// teste de DOM passaria **mesmo sem o conserto** — falso verde, que é exatamente
// a armadilha que o #1278 me custou. O que o conserto promete é que a regra
// viaja no CSS DO APP (arquivo externo, que `style-src` libera). Isso se afirma
// no bundle, não no DOM de um ambiente sem política.
//
// Rode com:  pnpm vite build && node --test --experimental-strip-types src/lib/scrollarea-sem-barra-nativa.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(RAIZ, "dist");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
  });
}

test("#1276 o CSS do app esconde a barra nativa do viewport do ScrollArea", (t) => {
  if (!existsSync(DIST)) {
    t.skip("sem dist/: o gate roda `vite build` antes do `node --test`");
    return;
  }
  const css = arquivos(DIST)
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  assert.notEqual(css.length, 0, "nenhum .css no dist/ — build incompleto?");

  // A regra tem de estar no bundle. Sem ela, o app depende do `<style>` inline
  // do radix, que a CSP bloqueia — e a barra nativa volta nas 5 superfícies.
  assert.match(
    css.replace(/\s+/g, " "),
    /\[data-radix-scroll-area-viewport\][^{]*\{[^}]*scrollbar-width: ?none/,
    "o bundle precisa esconder a barra nativa do viewport do radix pelo CSS do " +
      "app; sem isso a regressão do #1276 volta na próxima build",
  );

  assert.match(
    css.replace(/\s+/g, " "),
    /\[data-radix-scroll-area-viewport\]::-webkit-scrollbar[^{]*\{[^}]*display: ?none/,
    "o WebView2 é Chromium: sem a regra `::-webkit-scrollbar` a barra continua " +
      "desenhada mesmo com `scrollbar-width:none`",
  );
});

test("#1276 a regra é GLOBAL — vale para toda ScrollArea, não só para as 5 relatadas", () => {
  const fonte = readFileSync(join(RAIZ, "src", "index.css"), "utf8");
  // O seletor é o atributo do radix, sem prefixo de tela/classe. Se alguém
  // escopar isto a uma sidebar específica, as outras superfícies regridem uma a
  // uma — e o relato do PO já veio em três levas por esse motivo.
  const linhas = fonte
    .split("\n")
    .filter((l) => l.includes("[data-radix-scroll-area-viewport]"));
  assert.notEqual(linhas.length, 0, "a regra sumiu do index.css");
  for (const l of linhas) {
    const seletor = l.trim();
    assert.ok(
      seletor.startsWith("[data-radix-scroll-area-viewport]"),
      `o seletor precisa ser global; achei escopado: ${seletor}`,
    );
  }
});
