import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const controlRoomSource = readFileSync(
  new URL("../screens/control-room.tsx", import.meta.url),
  "utf8",
);
const graphSource = readFileSync(
  new URL("../../src-tauri/src/graph.rs", import.meta.url),
  "utf8",
);

function bracedBlock(source: string, marker: string): string {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `marcador ausente: ${marker}`);
  const open = source.indexOf("{", at);
  assert.notEqual(open, -1, `abertura ausente: ${marker}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(at, index + 1);
  }
  assert.fail(`fechamento ausente: ${marker}`);
}

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `início ausente: ${start}`);
  const until = source.indexOf(end, from);
  assert.notEqual(until, -1, `fim ausente: ${end}`);
  return source.slice(from, until);
}

function requiresWorkAccount(region: string, call: string): void {
  const workGate = bracedBlock(region, 'if (u.accountKind === "work")');
  assert.match(workGate, new RegExp(call.replace(/[().]/g, "\\$&")));
  const outsideGate = region.replace(workGate, "");
  assert.doesNotMatch(
    outsideGate,
    new RegExp(call.replace(/[().]/g, "\\$&")),
    `${call} escapou do gate MS work`,
  );
}

for (const [name, region] of [
  [
    "restore",
    section(
      appSource,
      "const u = await api.restoreSession();",
      "} catch {\n        // sessao invalida",
    ),
  ],
  ["login", bracedBlock(appSource, "async function handleLogin(")],
] as const) {
  test(`#802 ${name}: MS pessoal não chama SharePoint e 400/403 opcional preserva sessão`, () => {
    requiresWorkAccount(region, "api.listSites(");
    requiresWorkAccount(region, "carregarDetalhes(");

    const workGate = bracedBlock(region, 'if (u.accountKind === "work")');
    const failure = bracedBlock(workGate, "catch (e)");
    assert.match(failure, /setSites\(\[\]\)/);
    assert.doesNotMatch(failure, /setUser\(null\)/);
  });
}

test("#803 Bridge bloqueia o Graph Mail antes da primeira request para conta sem capability", () => {
  const foldersEffect = section(
    controlRoomSource,
    "// pastas (recarrega as contagens junto com as ações e no refresh manual)",
    "// Cache de SUBPASTAS",
  );
  const gate = bracedBlock(foldersEffect, "if (!surfaceSuportada(user, \"mail\"))");
  assert.match(gate, /setPastas\(\[\]\)/);
  assert.match(gate, /return/);

  const request = foldersEffect.indexOf("api\n      .crMailFolders");
  assert.notEqual(request, -1, "request de pastas não encontrada");
  assert.ok(
    foldersEffect.indexOf('if (!surfaceSuportada(user, "mail"))') < request,
    "o gate de capability veio depois da request de Mail",
  );
});

test("#803 People não toca Graph para Google e não toca /users em MS pessoal", () => {
  const people = bracedBlock(graphSource, "pub fn cr_pessoas(");
  const googleGate = bracedBlock(people, "if eh_google");
  assert.match(googleGate, /return Ok\(Vec::new\(\)\)/);
  assert.ok(
    people.indexOf("if eh_google") < people.indexOf("let token = access_token(store)?"),
    "Google tentou obter token/Graph antes do gate",
  );

  const directoryGate = bracedBlock(people, "if eh_org");
  assert.match(directoryGate, /\{GRAPH\}\/users/);
  const beforeDirectory = people.slice(0, people.indexOf("if eh_org"));
  const afterDirectory = people.slice(people.indexOf("} // fim do gate eh_org"));
  assert.doesNotMatch(beforeDirectory + afterDirectory, /\{GRAPH\}\/users/);
});
