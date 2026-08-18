import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { ATALHOS_BRIDGE } from "./atalhos-bridge.ts";

// #1060 (raia Sirius) — cross-check catálogo↔handler do BRIDGE, irmão do gate do
// Explorer (`lumen-863`). O catálogo (`atalhos-bridge.ts`) declara os atalhos; a
// realidade mora em dois lugares, e a `fonte` de cada atalho diz onde procurar:
//   - "central" → o `aoTeclar` global do `control-room` (despacha por `e.key`);
//   - "filters" → o listener próprio do `<Filters enableShortcut shortcutKey>`
//                 (reui) — o `F`/Filtro de tecla única;
//   - "editor"  → keymap DENTRO do editor de e-mail (contenteditable) — o keymap
//                 central não alcança; fora do cross-check;
//   - "nativo"  → gesto de mouse (Shift+clique) — não é `e.key`; fora.
// Conservador (como o #863): só acusa quando a tecla do combo NÃO aparece no
// handler (entrada morta de verdade), sem validar modificador.

const CONTROL_ROOM = new URL("../screens/control-room.tsx", import.meta.url);

// Nome canônico do catálogo → literais `e.key` aceitos (letras tratadas à parte).
const MAP: Record<string, string[]> = {
  "↑": ["ArrowUp"], "↓": ["ArrowDown"], "←": ["ArrowLeft"], "→": ["ArrowRight"],
  Del: ["Delete"], Esc: ["Escape"], Enter: ["Enter"],
  F9: ["F9"], F12: ["F12"], "/": ["/"], "?": ["?"],
};
const MODIFICADORES = new Set(["Ctrl", "Shift", "Alt", "Meta"]);
const MOUSE = new Set(["Clique", "Arrastar"]);

/** Extrai o texto-fonte da `function aoTeclar(...)` do control-room (via AST). */
function fonteAoTeclar(): string {
  const texto = readFileSync(CONTROL_ROOM, "utf8");
  const src = ts.createSourceFile(
    CONTROL_ROOM.pathname,
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let corpo = "";
  (function visit(n: ts.Node) {
    // No control-room o handler é uma FunctionDeclaration; no Explorer é uma
    // VariableDeclaration — cobrimos os dois pra o gate ser reusável.
    if (
      ts.isFunctionDeclaration(n) &&
      n.name?.getText() === "aoTeclar" &&
      n.body
    ) {
      corpo = n.getText();
    }
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText() === "aoTeclar" &&
      n.initializer
    ) {
      corpo = n.initializer.getText();
    }
    ts.forEachChild(n, visit);
  })(src);
  assert.notEqual(corpo, "", "não achei a função `aoTeclar` no control-room");
  return corpo;
}

/** A tecla `e.key` está referenciada no handler? (letra = qualquer caso). */
function teclaNoHandler(literal: string, handler: string): boolean {
  if (/^[A-Za-z]$/.test(literal)) {
    return (
      handler.includes(`"${literal.toLowerCase()}"`) ||
      handler.includes(`"${literal.toUpperCase()}"`)
    );
  }
  return handler.includes(`"${literal}"`);
}

/** Um combo (lista de teclas) é despachado pelo handler? */
function comboCabeado(combo: string[], handler: string): boolean {
  const teclas = combo.filter((k) => !MODIFICADORES.has(k)); // modificadores = condição
  if (teclas.length === 0) return false;
  return teclas.every((tecla) => {
    const literais = MAP[tecla] ?? (/^[A-Za-z0-9]$/.test(tecla) ? [tecla] : null);
    if (!literais) return false;
    return literais.some((lit) => teclaNoHandler(lit, handler));
  });
}

test("#1060: todo atalho 'central' do catálogo do Bridge tem handler no aoTeclar", () => {
  const handler = fonteAoTeclar();
  const mortos: string[] = [];
  for (const a of ATALHOS_BRIDGE) {
    if (a.fonte !== "central") continue; // "filters"/"editor"/"nativo" — fora do aoTeclar
    const combosTeclado = a.combos.filter((c) => !c.some((k) => MOUSE.has(k)));
    if (combosTeclado.length === 0) continue;
    if (!combosTeclado.some((c) => comboCabeado(c, handler))) {
      mortos.push(`${a.id} (${combosTeclado.map((c) => c.join("+")).join(" | ")})`);
    }
  }
  assert.deepEqual(
    mortos,
    [],
    `Atalho 'central' no catálogo SEM handler no aoTeclar (entrada morta) — cabeie no control-room ou tire do catálogo:\n${mortos.map((m) => "  " + m).join("\n")}`,
  );
});

test("#1060: o atalho 'filters' (Filtro/F) está cabeado no <Filters enableShortcut>", () => {
  const filtro = ATALHOS_BRIDGE.filter((a) => a.fonte === "filters");
  assert.ok(filtro.length > 0, "esperava ao menos um atalho fonte:'filters' (o Filtro)");
  const texto = readFileSync(CONTROL_ROOM, "utf8");
  assert.match(texto, /enableShortcut/, "o <Filters> do control-room precisa de enableShortcut");
  assert.match(texto, /shortcutKey="f"/, 'o <Filters> precisa de shortcutKey="f" (o atalho catalogado)');
});

test("#1060: todo shortcutBridge(id) usado nos tooltips do control-room existe no catálogo com shortcut", () => {
  const texto = readFileSync(CONTROL_ROOM, "utf8");
  const ids = [...texto.matchAll(/shortcutBridge\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, "esperava chamadas shortcutBridge(...) no control-room");
  const semShortcut: string[] = [];
  for (const id of ids) {
    const a = ATALHOS_BRIDGE.find((x) => x.id === id);
    if (!a || !a.shortcut) semShortcut.push(id);
  }
  assert.deepEqual(
    semShortcut,
    [],
    `shortcutBridge(id) no control-room sem entrada { shortcut } no catálogo: ${semShortcut.join(", ")}`,
  );
});

test("#1065: a busca universal (alvo do atalho '/') está MONTADA no control-room — não órfã (regressão do #876)", () => {
  // O #876 orfanou o UniversalSearch ao tirar o mount da title bar: o handler do
  // "/" continuava focando "[data-universal-search-input]", mas nada renderizava
  // esse input → atalho morto. Este guard trava o re-orfanamento cruzando três
  // fatos: (1) o handler '/' mira o seletor; (2) o UniversalSearch está montado
  // como JSX no control-room; (3) o UniversalSearch renderiza aquele seletor.
  const controlRoom = readFileSync(CONTROL_ROOM, "utf8");
  const handler = fonteAoTeclar();

  // (1) o atalho '/' foca o input da busca universal.
  assert.match(
    handler,
    /"\[data-universal-search-input\]"/,
    'o handler do "/" precisa focar "[data-universal-search-input]"',
  );

  // (2) o control-room MONTA o componente (o mount que o #876 removeu).
  assert.match(
    controlRoom,
    /<UniversalSearch[\s/>]/,
    "o control-room precisa MONTAR <UniversalSearch …/> (senão o atalho '/' fica morto — regressão do #876)",
  );

  // (3) o componente da busca de fato expõe o seletor que o atalho mira.
  const universalSearch = readFileSync(
    new URL("./universal-search.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    universalSearch,
    /data-universal-search-input/,
    "o UniversalSearch precisa renderizar [data-universal-search-input] (alvo do atalho '/')",
  );
});

test("#1060: ids do catálogo do Bridge são únicos", () => {
  const vistos = new Set<string>();
  const dupes: string[] = [];
  for (const a of ATALHOS_BRIDGE) {
    if (vistos.has(a.id)) dupes.push(a.id);
    vistos.add(a.id);
  }
  assert.deepEqual(dupes, [], `ids duplicados no catálogo: ${dupes.join(", ")}`);
});
