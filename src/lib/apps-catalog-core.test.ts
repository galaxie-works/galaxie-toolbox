import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agrupar,
  buscar,
  chaveCategoria,
  ORDEM_CATEGORIAS,
  type AppCatalogo,
} from "./apps-catalog-core.ts";

const fix: AppCatalogo[] = [
  { id: "figma", name: "Figma", category: "Developer Tools", url: "u", icon: true },
  { id: "notion", name: "Notion", category: "Productivity", url: "u", icon: true },
  { id: "slack", name: "Slack", category: "Work and Business", url: "u", icon: true },
  { id: "chatgpt", name: "ChatGPT", category: "AI Tools", url: "u", icon: true },
  { id: "trello", name: "Trello", category: "Productivity", url: "u", icon: false },
];

test("#720 buscar: por nome (case-insensitive)", () => {
  assert.deepEqual(buscar(fix, "not").map((a) => a.id), ["notion"]);
  assert.deepEqual(buscar(fix, "FIGMA").map((a) => a.id), ["figma"]);
});

test("#720 buscar: por categoria", () => {
  assert.deepEqual(
    buscar(fix, "productivity").map((a) => a.id).sort(),
    ["notion", "trello"]
  );
});

test("#720 buscar: vazio devolve todos (cópia)", () => {
  const r = buscar(fix, "  ");
  assert.equal(r.length, fix.length);
  assert.notEqual(r, fix); // cópia, não a mesma referência
});

test("#720 agrupar: ordem canônica + categorias vazias fora", () => {
  const g = agrupar(fix);
  assert.deepEqual(g.map((x) => x.categoria), [
    "AI Tools",
    "Productivity",
    "Work and Business",
    "Developer Tools",
  ]);
  const prod = g.find((x) => x.categoria === "Productivity");
  assert.deepEqual(prod?.apps.map((a) => a.id).sort(), ["notion", "trello"]);
});

test("#720 agrupar: com filtro", () => {
  const g = agrupar(fix, "ai tools");
  assert.deepEqual(g.map((x) => x.categoria), ["AI Tools"]);
});

test("#720 chaveCategoria: mapeia toda categoria da ordem", () => {
  for (const c of ORDEM_CATEGORIAS) {
    assert.equal(typeof chaveCategoria(c), "string");
  }
});
