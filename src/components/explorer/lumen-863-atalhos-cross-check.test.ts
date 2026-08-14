import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { ATALHOS } from "./atalhos.ts";

// #863 (gate da Lumen II) — cross-check catálogo↔handler: nenhum atalho DO CATÁLOGO
// pode ficar SEM handler (atalho morto). O catálogo (`atalhos.ts`) declara os combos;
// o `aoTeclar` do content-pane despacha por `e.key`. Este teste garante que cada
// atalho de TECLADO tem ≥1 combo cujo `e.key` é referenciado no `aoTeclar` — se
// alguém adicionar um combo novo sem cabear o handler, quebra. (Combos de MOUSE —
// Clique/Arrastar — são pointer, tratados fora do aoTeclar → ignorados.)
// É o irmão "sem atalho" do gate AST de botões (#878). Conservador: só acusa quando
// a tecla do combo NÃO aparece no handler (dead de verdade), não valida modificador.

// Nome canônico do catálogo → literais `e.key` aceitos (case tratado à parte p/ letras).
const MAP: Record<string, string[]> = {
  "←": ["ArrowLeft"], "→": ["ArrowRight"], "↑": ["ArrowUp"], "↓": ["ArrowDown"],
  "←/→/↑/↓": ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
  Del: ["Delete"], Esc: ["Escape"], Enter: ["Enter"], Home: ["Home"], End: ["End"],
  Backspace: ["Backspace"], F2: ["F2"], F5: ["F5"],
};
const MODIFICADORES = new Set(["Ctrl", "Shift", "Alt", "Meta"]);
const MOUSE = new Set(["Clique", "Arrastar"]);

/** Extrai o texto-fonte do `const aoTeclar = ...` do content-pane (via AST). */
function fonteAoTeclar(): string {
  const arquivo = new URL("./content-pane.tsx", import.meta.url);
  const texto = readFileSync(arquivo, "utf8");
  const src = ts.createSourceFile(arquivo.pathname, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let corpo = "";
  (function visit(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText() === "aoTeclar" && n.initializer) {
      corpo = n.initializer.getText();
    }
    ts.forEachChild(n, visit);
  })(src);
  assert.notEqual(corpo, "", "não achei o `aoTeclar` no content-pane");
  return corpo;
}

/** A tecla `e.key` está referenciada no handler? (letra = qualquer caso). */
function teclaNoHandler(literal: string, handler: string): boolean {
  if (/^[A-Za-z]$/.test(literal)) {
    return handler.includes(`"${literal.toLowerCase()}"`) || handler.includes(`"${literal.toUpperCase()}"`);
  }
  return handler.includes(`"${literal}"`);
}

/** Um combo (lista de teclas) é despachado pelo handler? */
function comboCabeado(combo: string[], handler: string): boolean {
  const teclas = combo.filter((k) => !MODIFICADORES.has(k)); // modificadores são condição, não `e.key`
  if (teclas.length === 0) return false;
  return teclas.every((tecla) => {
    const literais = MAP[tecla] ?? (/^[A-Za-z0-9]$/.test(tecla) ? [tecla] : null);
    if (!literais) return false;
    return literais.some((lit) => teclaNoHandler(lit, handler));
  });
}

test("#863: todo atalho de TECLADO do catálogo tem handler no aoTeclar (nenhum morto)", () => {
  const handler = fonteAoTeclar();
  const mortos: string[] = [];
  for (const atalho of ATALHOS) {
    const combosTeclado = atalho.combos.filter((c) => !c.some((k) => MOUSE.has(k)));
    if (combosTeclado.length === 0) continue; // só-mouse (Ctrl+Clique etc.) — fora do aoTeclar
    if (!combosTeclado.some((c) => comboCabeado(c, handler))) {
      mortos.push(`${atalho.id} (${combosTeclado.map((c) => c.join("+")).join(" | ")})`);
    }
  }
  assert.deepEqual(
    mortos,
    [],
    `Atalho no catálogo SEM handler no aoTeclar (entrada morta) — cabeie no content-pane ou tire do catálogo:\n${mortos.map((m) => "  " + m).join("\n")}`,
  );
});
