import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparUnificado,
  appVisivelPara,
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
  {
    id: "sharepoint",
    nome: "SharePoint",
    resumo: { "pt-BR": "Sites", en: "Sites" },
    url: "https://www.office.com/launch/sharepoint",
    icone: "sharepoint",
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

test("appVisivelPara: Google esconde TODO M365, mantém catálogo", () => {
  const out = unificar(m365, catalogo, resolver);
  const g = { provider: "google" as const, accountKind: "personal" as const };
  assert.equal(appVisivelPara(out.find((a) => a.id === "outlook")!, g), false);
  assert.equal(appVisivelPara(out.find((a) => a.id === "sharepoint")!, g), false);
  assert.equal(appVisivelPara(out.find((a) => a.id === "figma")!, g), true);
});

test("appVisivelPara: MS pessoal esconde só org-only (SharePoint), mantém Outlook", () => {
  const out = unificar(m365, catalogo, resolver);
  const p = { provider: "microsoft" as const, accountKind: "personal" as const };
  assert.equal(appVisivelPara(out.find((a) => a.id === "outlook")!, p), true);
  assert.equal(appVisivelPara(out.find((a) => a.id === "sharepoint")!, p), false);
});

test("appVisivelPara: MS org (work) vê tudo", () => {
  const out = unificar(m365, catalogo, resolver);
  const w = { provider: "microsoft" as const, accountKind: "work" as const };
  assert.equal(appVisivelPara(out.find((a) => a.id === "outlook")!, w), true);
  assert.equal(appVisivelPara(out.find((a) => a.id === "sharepoint")!, w), true);
});

test("agruparUnificado: user=google filtra M365 do agrupamento", () => {
  const out = unificar(m365, catalogo, resolver);
  const g = { provider: "google" as const, accountKind: "personal" as const };
  const nomes = agruparUnificado(out, undefined, g).flatMap((gr) =>
    gr.apps.map((a: AppUnificado) => a.id),
  );
  assert.equal(nomes.includes("outlook"), false);
  assert.equal(nomes.includes("figma"), true);
});

test("#877: unificar inclui as 3 telas do GALAXIE (Bridge/Files/Remote nativas)", () => {
  const out = unificar(m365, catalogo, resolver);
  const bridge = out.find((a) => a.id === "galaxie-bridge")!;
  const files = out.find((a) => a.id === "galaxie-files")!;
  const remote = out.find((a) => a.id === "galaxie-remote")!;
  assert.equal(bridge.category, "From GALAXIE");
  assert.equal(bridge.nativo, "control-room");
  assert.equal(files.nativo, "arquivos");
  assert.equal(remote.nativo, "remote");
  assert.equal(bridge.m365, false);
  assert.equal(out.some((a) => a.id === "galaxie-navigator"), false); // sem Navigator
});

test("#877: 'From GALAXIE' é a PRIMEIRA categoria do agrupamento", () => {
  const out = unificar(m365, catalogo, resolver);
  const grupos = agruparUnificado(out);
  assert.equal(grupos[0].categoria, "From GALAXIE");
  assert.deepEqual(
    grupos[0].apps.map((a: AppUnificado) => a.id).sort(),
    ["galaxie-bridge", "galaxie-files", "galaxie-remote"],
  );
});

test("#877: GALAXIE nunca é gateado (visível pra qualquer provider)", () => {
  const out = unificar(m365, catalogo, resolver);
  const g = { provider: "google" as const, accountKind: "personal" as const };
  const bridge = out.find((a) => a.id === "galaxie-bridge")!;
  assert.equal(appVisivelPara(bridge, g), true);
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
