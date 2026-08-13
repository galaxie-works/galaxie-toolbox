import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PINADOS,
  alternarPin,
  estaPinado,
  removerPin,
  resolverPinados,
} from "./pinned-apps.ts";
import type { AppCatalogo } from "./apps-catalog-core.ts";

const cat: AppCatalogo[] = [
  { id: "figma", name: "Figma", category: "Developer Tools", url: "u", icon: true },
  { id: "notion", name: "Notion", category: "Productivity", url: "u", icon: true },
  { id: "slack", name: "Slack", category: "Work and Business", url: "u", icon: true },
];

test("#721 estaPinado", () => {
  assert.equal(estaPinado(["figma"], "figma"), true);
  assert.equal(estaPinado(["figma"], "slack"), false);
});

test("#721 alternarPin: adiciona no fim, remove, é idempotente na ordem", () => {
  assert.deepEqual(alternarPin([], "figma"), ["figma"]);
  assert.deepEqual(alternarPin(["figma"], "notion"), ["figma", "notion"]);
  assert.deepEqual(alternarPin(["figma", "notion"], "figma"), ["notion"]);
});

test("#721 alternarPin: respeita o cap MAX_PINADOS", () => {
  const cheio = Array.from({ length: MAX_PINADOS }, (_, i) => `app${i}`);
  assert.equal(alternarPin(cheio, "novo").length, MAX_PINADOS); // não adiciona
  assert.ok(!alternarPin(cheio, "novo").includes("novo"));
  // mas ainda dá pra remover um já pinado quando cheio
  assert.equal(alternarPin(cheio, "app0").length, MAX_PINADOS - 1);
});

test("#721 removerPin idempotente", () => {
  assert.deepEqual(removerPin(["figma", "notion"], "figma"), ["notion"]);
  assert.deepEqual(removerPin(["figma"], "ausente"), ["figma"]);
});

test("#721 resolverPinados: ordem dos pinados + descarta órfãos", () => {
  assert.deepEqual(
    resolverPinados(["slack", "figma"], cat).map((a) => a.id),
    ["slack", "figma"]
  );
  assert.deepEqual(
    resolverPinados(["figma", "inexistente", "notion"], cat).map((a) => a.id),
    ["figma", "notion"]
  );
});
