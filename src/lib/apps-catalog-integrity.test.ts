import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

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
const catalogo = JSON.parse(raw) as {
  id: string;
  name: string;
  url: string;
  icon: boolean;
}[];

/** #827 SU4: diretório dos ícones estáticos (servidos de `public/app-icons`). */
const iconesDir = new URL("../../public/app-icons/", import.meta.url);

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

test("#822: todos os ids do catálogo são únicos", () => {
  const vistos = new Set<string>();
  const repetidos: string[] = [];
  for (const a of catalogo) {
    if (vistos.has(a.id)) repetidos.push(a.id);
    vistos.add(a.id);
  }
  assert.deepEqual(repetidos, []);
});

test("#827 SU4: nenhum ícone SVG 0-byte em public/app-icons (asset quebrado)", () => {
  const zeros = readdirSync(iconesDir)
    .filter((f) => f.endsWith(".svg"))
    .filter((f) => statSync(new URL(f, iconesDir)).size === 0);
  assert.deepEqual(zeros, []);
});

test("#827 SU4: todo app com icon:true tem arquivo de ícone não-vazio", () => {
  const quebrados = catalogo
    .filter((a) => a.icon)
    .filter((a) => {
      const p = new URL(`${a.id}.svg`, iconesDir);
      return !existsSync(p) || statSync(p).size === 0;
    })
    .map((a) => a.id);
  assert.deepEqual(quebrados, []);
});
