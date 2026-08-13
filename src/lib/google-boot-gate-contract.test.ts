import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const authSource = readFileSync(
  new URL("../../src-tauri/src/auth.rs", import.meta.url),
  "utf8",
).split(String.fromCharCode(13)).join("");

const msCalls = [
  "hydratePeopleM365(",
  "api.requiredScopesStatus(",
  "api.listSites(",
  "carregarDetalhes(",
];

function sliceBetween(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `inicio nao encontrado: ${start}`);
  const endAt = source.indexOf(end, startAt);
  assert.notEqual(endAt, -1, `fim nao encontrado: ${end}`);
  return source.slice(startAt, endAt);
}

function sliceBracedBlock(source: string, start: string): string {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `bloco nao encontrado: ${start}`);
  const bodyStart = source.indexOf("{", startAt);
  assert.notEqual(bodyStart, -1, `abertura nao encontrada: ${start}`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(startAt, index + 1);
  }
  assert.fail(`fechamento nao encontrado: ${start}`);
}

function extractGoogleGate(region: string): {
  before: string;
  body: string;
  after: string;
  allows: (provider: string) => boolean;
} {
  const gateAt = region.indexOf("if (u.provider");
  assert.notEqual(gateAt, -1, "gate por provider nao encontrado");

  const conditionStart = region.indexOf("(", gateAt) + 1;
  const conditionEnd = region.indexOf(")", conditionStart);
  const condition = region.slice(conditionStart, conditionEnd);
  assert.match(
    condition,
    /^\s*u\.provider\s*!==\s*"google"\s*$/,
    "o gate deve negar explicitamente o provider Google",
  );
  const bodyStart = region.indexOf("{", conditionEnd);
  assert.notEqual(bodyStart, -1, "corpo do gate nao encontrado");

  let depth = 0;
  let bodyEnd = -1;
  for (let index = bodyStart; index < region.length; index += 1) {
    if (region[index] === "{") depth += 1;
    if (region[index] === "}") depth -= 1;
    if (depth === 0) {
      bodyEnd = index;
      break;
    }
  }
  assert.notEqual(bodyEnd, -1, "gate sem fechamento");

  return {
    before: region.slice(0, gateAt),
    body: region.slice(bodyStart + 1, bodyEnd),
    after: region.slice(bodyEnd + 1),
    allows: (provider) => provider !== "google",
  };
}

const restoreRegion = sliceBetween(
  appSource,
  "const u = await api.restoreSession();",
  "} catch {\n        // sessao invalida",
);
const loginRegion = sliceBracedBlock(appSource, "async function handleLogin(");

for (const [pathName, region] of [
  ["restore de sessao", restoreRegion],
  ["login novo", loginRegion],
] as const) {
  test(`${pathName}: Google nao executa chamadas do Microsoft Graph`, () => {
    const gate = extractGoogleGate(region);
    assert.equal(gate.allows("google"), false);
    for (const call of msCalls) {
      assert.match(gate.body, new RegExp(call.replace(/[().]/g, "\\$&")));
      assert.doesNotMatch(gate.before + gate.after, new RegExp(call.replace(/[().]/g, "\\$&")));
    }
  });

  test(`${pathName}: Microsoft org e pessoal preservam a carga Graph`, () => {
    const gate = extractGoogleGate(region);
    assert.equal(gate.allows("microsoft"), true);
    assert.equal(gate.allows("microsoft-personal"), true);
  });

  test(`${pathName}: reconciliacao cloud permanece antes do gate Google`, () => {
    const gate = extractGoogleGate(region);
    assert.match(gate.before, /reconciliarConfiguracaoNuvem\(\)/);
    assert.doesNotMatch(gate.body, /reconciliarConfiguracaoNuvem\(\)/);
  });
}

test("loopback do OAuth responde waiting em ingles e aguardando nos demais idiomas", () => {
  assert.match(
    authSource,
    /idioma\.starts_with\("en"\)\s*\{\s*"waiting\.\.\."\s*\}\s*else\s*\{\s*"aguardando\.\.\."\s*\}/,
  );
});
