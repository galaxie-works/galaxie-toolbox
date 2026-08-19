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
  { id: "figma", name: "Figma", category: "Developer Tools", url: "u", icon: true, desc: { "pt-BR": "d", en: "d" } },
  { id: "notion", name: "Notion", category: "Productivity", url: "u", icon: true, desc: { "pt-BR": "d", en: "d" } },
  { id: "slack", name: "Slack", category: "Work and Business", url: "u", icon: true, desc: { "pt-BR": "d", en: "d" } },
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

// --- #1152: o pin do command grava id da lista UNIFICADA ---------------------
//
// Os testes acima só exercitam ids do CATÁLOGO — foi por isso que o bug passou
// verde: `outlook`, `word`, `galaxie-bridge` não existem no catálogo, e o
// resolvedor os descartava em silêncio, deixando o rail sem renderizar.

/** Recorte fiel das TRÊS origens de `unificar()` (GALAXIE, M365 curado, catálogo). */
const unificado = [
  { id: "galaxie-bridge", name: "Bridge" }, // tela GALAXIE — NÃO está no catálogo
  { id: "outlook", name: "Outlook" }, // M365 curado — NÃO está no catálogo
  { id: "figma", name: "Figma" }, // catálogo
];

test("#1152 pin de app M365 curado (Outlook) SOBREVIVE — era descartado", () => {
  assert.deepEqual(
    resolverPinados(["outlook"], unificado).map((a) => a.id),
    ["outlook"]
  );
});

test("#1152 pin de tela GALAXIE (galaxie-bridge) SOBREVIVE — era descartado", () => {
  assert.deepEqual(
    resolverPinados(["galaxie-bridge"], unificado).map((a) => a.id),
    ["galaxie-bridge"]
  );
});

test("#1152 as três origens convivem, na ordem do pin", () => {
  assert.deepEqual(
    resolverPinados(["figma", "galaxie-bridge", "outlook"], unificado).map(
      (a) => a.id
    ),
    ["figma", "galaxie-bridge", "outlook"]
  );
});

test("#1152 id órfão de verdade CONTINUA descartado — a proteção fica de pé", () => {
  assert.deepEqual(
    resolverPinados(["outlook", "nao-existe-em-lugar-nenhum"], unificado).map(
      (a) => a.id
    ),
    ["outlook"]
  );
});

test("#1152 descarte é ANUNCIADO — foi o silêncio que escondeu este bug", () => {
  const descartados: string[] = [];
  resolverPinados(["figma", "fantasma", "outro-fantasma"], unificado, (id) =>
    descartados.push(id)
  );
  assert.deepEqual(descartados, ["fantasma", "outro-fantasma"]);
});

test("#1152 sem órfãos, ninguém é anunciado (nada de ruído no console)", () => {
  const descartados: string[] = [];
  resolverPinados(["figma", "outlook"], unificado, (id) => descartados.push(id));
  assert.deepEqual(descartados, []);
});
