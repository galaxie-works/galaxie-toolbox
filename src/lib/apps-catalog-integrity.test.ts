import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * #822: integridade dos DADOS do catálogo de apps (`src/assets/apps-catalog.json`,
 * que veio de um scrape). Blinda contra regressão do que o Polaris achou na
 * auditoria: URLs quebradas (subdomínio de tenant perdido → começam com "."),
 * apps do concorrente (Shift), http inseguro e URLs duplicadas.
 *
 * Lê o JSON por `fs` (não por import de alias `@/` nem import-assertion) pra rodar
 * no `node --test` do CI. Só depende do arquivo, não da app.
 */
const raw = readFileSync(
  new URL("../assets/apps-catalog.json", import.meta.url),
  "utf8",
);
const catalogo = JSON.parse(raw) as { id: string; name: string; url: string }[];

test("#822: nenhuma URL começa com '.' (subdomínio de tenant perdido no scrape)", () => {
  const ruins = catalogo.filter((a) => a.url.startsWith("."));
  assert.deepEqual(ruins.map((a) => `${a.name} ${a.url}`), []);
});

test("#822: nenhum app do Shift (concorrente) — tryshift/shiftium/shiftboard", () => {
  const shift = catalogo.filter((a) =>
    /tryshift\.com|shiftium\.com|shiftboard\.com/i.test(a.url),
  );
  assert.deepEqual(shift.map((a) => a.name), []);
});

test("#822: nenhuma URL http:// (inseguro) — só https", () => {
  const http = catalogo.filter((a) => /^http:\/\//i.test(a.url));
  assert.deepEqual(http.map((a) => `${a.name} ${a.url}`), []);
});

test("#822: nenhuma URL duplicada (normalizada por barra final + caixa)", () => {
  const porUrl = new Map<string, string[]>();
  for (const a of catalogo) {
    const chave = a.url.replace(/\/+$/, "").toLowerCase();
    porUrl.set(chave, [...(porUrl.get(chave) ?? []), a.name]);
  }
  const dups = [...porUrl.entries()].filter(([, nomes]) => nomes.length > 1);
  assert.deepEqual(dups, []);
});

test("#822: nenhum nome com espaço nas pontas ou duplo (normalização do scrape)", () => {
  const ruins = catalogo.filter(
    (a) => a.name !== a.name.trim() || /\s{2,}/.test(a.name),
  );
  assert.deepEqual(ruins.map((a) => JSON.stringify(a.name)), []);
});

test("#822: todos os ids do catálogo são únicos", () => {
  const vistos = new Set<string>();
  const repetidos: string[] = [];
  for (const a of catalogo) {
    if (vistos.has(a.id)) repetidos.push(a.id);
    vistos.add(a.id);
  }
  assert.deepEqual(repetidos, []);
});
