import assert from "node:assert/strict";
import { test } from "node:test";

import { appsQueCasam, normalizarTermo, TELAS_IR_PARA } from "./aliases-nav.ts";
import type { Tela } from "./navegacao.ts";

// Apelidos e rótulos mínimos (espelham a intenção do strings.ts, sem depender dele).
const ALIAS: Partial<Record<Tela, string>> = {
  "control-room": "bridge email e-mail mail e-mails correio agenda",
  apps: "apps aplicativos aplicações",
  onedrive: "onedrive arquivos drive",
  outlook: "outlook",
  atoms: "atoms atenção foco",
  navegador: "navegador navigator cruiser browser",
  comms: "comms chat comunicação",
  astro: "astro ia assistente",
  pulsar: "pulsar notificações alertas",
  configuracoes: "configurações ajustes preferências settings",
};
const ROTULO: Record<string, string> = {
  "control-room": "Bridge",
  apps: "Apps",
  onedrive: "OneDrive",
  outlook: "Outlook",
  atoms: "Atoms",
  navegador: "Navigator",
  comms: "Comms",
  astro: "Astro",
  pulsar: "Pulsar",
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
  // "atoms" é exato pra Atoms; não deve trazer nada acima dele.
  assert.equal(casar("atoms")[0], "atoms");
  assert.ok(casar("a").length <= 5);
});

test("TELAS_IR_PARA cobre os 10 apps do escopo", () => {
  assert.equal(TELAS_IR_PARA.length, 10);
  assert.ok(TELAS_IR_PARA.includes("control-room"));
  assert.ok(!TELAS_IR_PARA.includes("performance" as Tela));
});

test("só casa telas na lista de candidatos (respeita oculto do #663)", () => {
  // Simula o RC: astro/comms/etc. filtrados fora → nem "astro" nem "comms" casam.
  const visiveis: Tela[] = ["control-room", "navegador", "apps", "onedrive"];
  assert.deepEqual(casar("astro", visiveis), []);
  assert.deepEqual(casar("comms", visiveis), []);
  assert.equal(casar("bridge", visiveis)[0], "control-room");
  assert.equal(casar("onedrive", visiveis)[0], "onedrive");
});
