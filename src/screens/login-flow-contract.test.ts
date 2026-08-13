import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginSource = readFileSync(new URL("./login.tsx", import.meta.url), "utf8");
const stringsSource = readFileSync(
  new URL("../lib/strings.ts", import.meta.url),
  "utf8",
);

test("AC1: tela inicial tem Microsoft e Google sem email nem avisos antigos", () => {
  const providerStep = loginSource.slice(
    loginSource.indexOf('passo === "provedor"'),
    loginSource.indexOf(': !contaTrabalho'),
  );
  assert.match(providerStep, /continuarMicrosoft/);
  assert.match(providerStep, /continuarGoogle/);
  assert.doesNotMatch(providerStep, /<Input|ajudaEmail|login\.aviso/);
});

test("AC2 e AC6: Microsoft abre passo 2 e Voltar retorna ao provedor", () => {
  assert.match(loginSource, /onClick=\{\(\) => setPasso\("microsoft"\)\}/);
  assert.match(loginSource, /contaPessoalTitulo/);
  assert.match(loginSource, /contaTrabalhoTitulo/);
  assert.match(loginSource, /onClick=\{\(\) => setPasso\("provedor"\)\}/);
});

test("AC3: conta pessoal envia microsoft-personal sem login hint", () => {
  assert.match(loginSource, /onLogin\("microsoft-personal", ""\)/);
});

test("AC4: conta de trabalho envia microsoft com email normalizado", () => {
  assert.match(loginSource, /setContaTrabalho\(true\)/);
  assert.match(loginSource, /onLogin\("microsoft", email\.trim\(\)\)/);
});

test("AC5: Google envia provider google sem passar pelo passo Microsoft", () => {
  const providerStep = loginSource.slice(
    loginSource.indexOf('passo === "provedor"'),
    loginSource.indexOf(': !contaTrabalho'),
  );
  assert.match(providerStep, /onLogin\("google", ""\)/);
  assert.doesNotMatch(providerStep, /setPasso\("google"\)/);
});

test("AC7: strings novas existem em pt-BR e en sem copy hardcoded no JSX", () => {
  for (const key of [
    "continuarMicrosoft",
    "continuarGoogle",
    "contaPessoalTitulo",
    "contaPessoalDesc",
    "contaTrabalhoTitulo",
    "contaTrabalhoDesc",
    "voltar",
  ]) {
    assert.ok(
      (stringsSource.match(new RegExp(`\\b${key}:`, "g"))?.length ?? 0) >= 2,
      `${key} precisa existir nos dois dicionarios`,
    );
    assert.match(loginSource, new RegExp(`t\\.login\\.${key}`));
  }
  assert.doesNotMatch(loginSource, />\s*(Continue|Personal account|Work account|Back)\s*</);
});

test("AC8: status de loading reflete Google em vez de fixar Microsoft", () => {
  assert.match(
    loginSource,
    /(?:provider|provedor).*loading|loading.*(?:provider|provedor)/is,
    "o componente nao preserva qual provider iniciou o login",
  );
  assert.match(
    stringsSource,
    /entrandoGoogle\s*:/,
    "nao existe status de loading especifico para Google",
  );
  assert.match(
    loginSource,
    /t\.login\.entrandoGoogle/,
    "o loading do Google continua exibindo a mensagem da Microsoft",
  );
});
