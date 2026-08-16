// Originalmente lumen-877-galaxie-render.test.ts (#877). Renomeado por assunto (#1015 / HG3).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparUnificado,
  appVisivelPara,
  unificar,
  type AppUnificado,
} from "./apps-unificado-core.ts";
import type { AppM365 } from "./apps.ts";
import type { AppCatalogo } from "./apps-catalog-core.ts";
import type { AppUser } from "./types.ts";

// #877 (gate de RENDER da Lumen II) — a reprovação do Wagner: as telas próprias
// do GALAXIE (From GALAXIE: Bridge/Files/Remote) SUMIAM pra conta que não passa
// no gate M365. O gate antigo confirmou o DADO (categoria/ordem) mas NÃO que
// RENDERIZA pra uma conta. Este monta o agrupamento com um `user` REAL — inclusive
// os casos adversos (Google, MS-pessoal) — e assere que os 3 aparecem e nunca são
// gateados. É a lição do VERDE≠PRONTO aplicada: exercitar o render, não a constante.

const m365: AppM365[] = [
  { id: "outlook", nome: "Outlook", resumo: { "pt-BR": "E-mail", en: "Email" }, url: "https://outlook.office.com/mail/", icone: "outlook", categorias: ["comunicacao"] },
  { id: "sharepoint", nome: "SharePoint", resumo: { "pt-BR": "Sites", en: "Sites" }, url: "https://www.office.com/launch/sharepoint", icone: "sharepoint", categorias: ["conteudo"] },
];
const catalogo: AppCatalogo[] = [
  { id: "figma", name: "Figma", category: "Developer Tools", url: "https://figma.com", icon: true },
];
const resolver = (a: AppM365) => `/assets/apps/${a.icone}.svg`;

const CONTAS: Array<{ nome: string; user: Pick<AppUser, "provider" | "accountKind"> | null }> = [
  { nome: "google/personal", user: { provider: "google", accountKind: "personal" } },
  { nome: "microsoft/personal", user: { provider: "microsoft", accountKind: "personal" } },
  { nome: "microsoft/work", user: { provider: "microsoft", accountKind: "work" } },
  { nome: "sem conta (null)", user: null },
];

const GALAXIE = ["galaxie-bridge", "galaxie-files", "galaxie-remote"];

test("#877: as 3 telas From GALAXIE aparecem no command pra TODA conta (nunca gateadas)", () => {
  const apps = unificar(m365, catalogo, resolver);
  for (const { nome, user } of CONTAS) {
    const grupos = agruparUnificado(apps, undefined, user);
    const fromGalaxie = grupos.find((g) => g.categoria === "From GALAXIE");
    assert.ok(
      fromGalaxie,
      `[${nome}] a categoria "From GALAXIE" sumiu do command (as telas próprias foram gateadas indevidamente)`,
    );
    const ids = fromGalaxie.apps.map((a) => a.id);
    for (const g of GALAXIE) {
      assert.ok(ids.includes(g), `[${nome}] "${g}" não apareceu no From GALAXIE`);
    }
  }
});

test('#877: "From GALAXIE" é a PRIMEIRA categoria pra conta adversa (Google)', () => {
  const apps = unificar(m365, catalogo, resolver);
  const grupos = agruparUnificado(apps, undefined, { provider: "google", accountKind: "personal" });
  assert.equal(grupos[0]?.categoria, "From GALAXIE", "From GALAXIE deveria ser a 1ª categoria");
});

test("#877: appVisivelPara nunca gateia as telas próprias do GALAXIE (m365=false)", () => {
  const apps = unificar(m365, catalogo, resolver);
  const google = { provider: "google" as const, accountKind: "personal" as const };
  for (const g of GALAXIE) {
    const app = apps.find((a) => a.id === g) as AppUnificado;
    assert.equal(app.m365, false, `${g} não deveria ser marcado m365`);
    assert.equal(appVisivelPara(app, google), true, `${g} foi gateado pra Google — telas próprias são sempre visíveis`);
  }
});
