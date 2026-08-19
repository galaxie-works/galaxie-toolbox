import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appsQueCasam,
  normalizarTermo,
  subviewsQueCasam,
  SUBVIEWS_BRIDGE,
  TELAS_IR_PARA,
  type SubviewBridge,
} from "./aliases-nav.ts";
import type { Tela } from "./navegacao.ts";

// Apelidos e rótulos mínimos (espelham a intenção do strings.ts, sem depender dele).
const ALIAS: Partial<Record<Tela, string>> = {
  "control-room": "bridge email e-mail mail e-mails correio agenda",
  apps: "apps aplicativos aplicações",
  onedrive: "onedrive arquivos drive",
  outlook: "outlook",
  navegador: "navegador navigator cruiser browser",
  astro: "astro ia assistente",
  configuracoes: "configurações ajustes preferências settings",
};
const ROTULO: Record<string, string> = {
  "control-room": "Bridge",
  apps: "Apps",
  onedrive: "OneDrive",
  outlook: "Outlook",
  navegador: "Navigator",
  astro: "Astro",
  configuracoes: "Configurações",
};
const rotulo = (t: Tela) => ROTULO[t] ?? t;
const casar = (termo: string, telas: Tela[] = TELAS_IR_PARA) =>
  appsQueCasam(termo, telas, ALIAS, rotulo);

test("normalizarTermo tira acento e caixa", () => {
  assert.equal(normalizarTermo("Configurações"), "configuracoes");
  assert.equal(normalizarTermo("  E-MAIL "), "e-mail");
});

test("apelidos de Bridge casam (bridge/email/e-mail/mail)", () => {
  for (const termo of ["bridge", "email", "e-mail", "mail"]) {
    assert.equal(casar(termo)[0], "control-room", `termo=${termo}`);
  }
});

test("sem acento casa igual (configuracoes → configuracoes)", () => {
  assert.ok(casar("configuracoes").includes("configuracoes"));
  assert.ok(casar("aplicacoes").includes("apps"));
});

test("outros apps: apps/onedrive/arquivos/outlook/settings", () => {
  assert.equal(casar("apps")[0], "apps");
  assert.equal(casar("onedrive")[0], "onedrive");
  assert.ok(casar("arquivos").includes("onedrive"));
  assert.equal(casar("outlook")[0], "outlook");
  assert.ok(casar("settings").includes("configuracoes"));
});

test("prefixo casa (config → configuracoes; naveg → navegador)", () => {
  assert.ok(casar("config").includes("configuracoes"));
  assert.ok(casar("naveg").includes("navegador"));
});

test("não-app não casa (github.com, receita de bolo)", () => {
  assert.deepEqual(casar("github.com"), []);
  assert.deepEqual(casar("receita de bolo"), []);
  assert.deepEqual(casar(""), []);
});

test("ranqueia exato acima de contém e limita a 5", () => {
  // "onedrive" é exato pra OneDrive; não deve trazer nada acima dele.
  assert.equal(casar("onedrive")[0], "onedrive");
  assert.ok(casar("a").length <= 5);
});

test("TELAS_IR_PARA cobre os 7 apps do escopo", () => {
  // Eram 10; Atoms/Comms/Pulsar saíram do app em #1320 (decisão do PO 19/08).
  assert.equal(TELAS_IR_PARA.length, 7);
  assert.ok(TELAS_IR_PARA.includes("control-room"));
  assert.ok(!TELAS_IR_PARA.includes("performance" as Tela));
  // #1320: não voltam nem como candidatos ocultos.
  for (const morta of ["atoms", "comms", "pulsar"]) {
    assert.ok(
      !TELAS_IR_PARA.includes(morta as Tela),
      `${morta} foi removida do app e não pode voltar ao "Ir para"`,
    );
  }
});

test("só casa telas na lista de candidatos (respeita oculto do #663)", () => {
  // Simula o RC: astro filtrado fora → "astro" não casa.
  const visiveis: Tela[] = ["control-room", "navegador", "apps", "onedrive"];
  assert.deepEqual(casar("astro", visiveis), []);
  assert.equal(casar("bridge", visiveis)[0], "control-room");
  assert.equal(casar("onedrive", visiveis)[0], "onedrive");
});

// #657: deep-link nas sub-views do Bridge (People/Agenda).
const ALIAS_SUB: Record<SubviewBridge, string> = {
  people: "contatos contato pessoas people contacts contact",
  agenda: "agenda calendário calendario eventos evento compromissos calendar events event schedule",
};
const ROTULO_SUB: Record<SubviewBridge, string> = {
  people: "Contatos",
  agenda: "Calendário",
};
const casarSub = (termo: string) =>
  subviewsQueCasam(termo, ALIAS_SUB, (v) => ROTULO_SUB[v]);

test("sub-views: contacts/contatos/pessoas/people → people", () => {
  for (const termo of ["contacts", "contatos", "pessoas", "people"]) {
    assert.equal(casarSub(termo)[0], "people", `termo=${termo}`);
  }
});

test("sub-views: agenda/calendário/calendario/eventos/calendar → agenda", () => {
  for (const termo of ["agenda", "calendário", "calendario", "eventos", "calendar"]) {
    assert.equal(casarSub(termo)[0], "agenda", `termo=${termo}`);
  }
});

test("sub-views: prefixo e no-match", () => {
  assert.ok(casarSub("contat").includes("people")); // prefixo
  assert.ok(casarSub("event").includes("agenda")); // prefixo
  assert.deepEqual(casarSub("github.com"), []);
  assert.deepEqual(casarSub(""), []);
  assert.equal(SUBVIEWS_BRIDGE.length, 2);
});
