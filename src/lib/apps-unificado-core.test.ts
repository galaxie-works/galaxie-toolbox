import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparUnificado,
  unificar,
  IDS_DUP_M365,
  CATEGORIA_M365,
  NATIVO_M365,
  type AppUnificado,
} from "./apps-unificado-core.ts";
import type { AppM365 } from "./apps.ts";
import type { AppCatalogo } from "./apps-catalog-core.ts";

const m365: AppM365[] = [
  {
    id: "outlook",
    nome: "Outlook",
    resumo: { "pt-BR": "E-mail", en: "Email" },
    url: "https://outlook.office.com/mail/",
    icone: "outlook",
    categorias: ["comunicacao"],
  },
  {
    id: "onedrive",
    nome: "OneDrive",
    resumo: { "pt-BR": "Arquivos", en: "Files" },
    url: "https://www.office.com/launch/onedrive",
    icone: "onedrive",
    categorias: ["conteudo"],
  },
];

const catalogo: AppCatalogo[] = [
  // duplicata canônica do Outlook curado → deve sumir
  { id: "outlook-mail", name: "Outlook", category: "Productivity", url: "https://outlook.office.com/mail", icon: true },
  // não-duplicata → fica
  { id: "figma", name: "Figma", category: "Developer Tools", url: "https://figma.com", icon: true },
  { id: "canva", name: "Canva", category: "Productivity", url: "https://canva.com", icon: true },
];

const resolver = (a: AppM365) => `/assets/apps/${a.icone}.svg`;

test("unificar: M365 primeiro, com taxonomia 14-cat + resumo + fluentIcon", () => {
  const out = unificar(m365, catalogo, resolver);
  const outlook = out.find((a) => a.id === "outlook")!;
  assert.equal(outlook.m365, true);
  assert.equal(outlook.category, CATEGORIA_M365.outlook); // "Productivity"
  assert.equal(outlook.resumo?.en, "Email");
  assert.equal(outlook.fluentIcon, "/assets/apps/outlook.svg");
  assert.equal(outlook.nativo, NATIVO_M365.outlook); // "control-room"
});

test("unificar: dedup canônico remove a duplicata do catálogo (outlook-mail)", () => {
  const out = unificar(m365, catalogo, resolver);
  assert.equal(out.filter((a) => a.name === "Outlook").length, 1);
  assert.equal(
    out.some((a) => a.id === "outlook-mail"),
    false,
  );
  assert.ok(IDS_DUP_M365.has("outlook-mail"));
});

test("unificar: apps do catálogo não-duplicados ficam (Figma/Canva)", () => {
  const out = unificar(m365, catalogo, resolver);
  assert.ok(out.some((a) => a.id === "figma" && a.m365 === false));
  assert.ok(out.some((a) => a.id === "canva"));
});

test("unificar: nativo mapeado (onedrive → arquivos), sem fluentIcon vira null no catálogo", () => {
  const out = unificar(m365, catalogo, resolver);
  assert.equal(out.find((a) => a.id === "onedrive")!.nativo, "arquivos");
  assert.equal(out.find((a) => a.id === "figma")!.fluentIcon, null);
  assert.equal(out.find((a) => a.id === "figma")!.nativo, null);
});

test("agruparUnificado: agrupa nas 14 cats em ordem, omite vazias, filtra", () => {
  const out = unificar(m365, catalogo, resolver);
  const grupos = agruparUnificado(out);
  // Productivity vem antes de Developer Tools (ordem canônica)
  const cats = grupos.map((g) => g.categoria);
  assert.ok(cats.indexOf("Productivity") < cats.indexOf("Developer Tools"));
  // filtro por nome
  const soFigma = agruparUnificado(out, "figma");
  const nomes = soFigma.flatMap((g) => g.apps.map((a: AppUnificado) => a.name));
  assert.deepEqual(nomes, ["Figma"]);
});
