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

// #1019: o Bridge deixou de morar num arquivo so. O `control-room.tsx` foi
// fatiado por seam (MessageList, FolderSidebar, o enabler compartilhado), e esta
// catraca quebrou nao porque a fiacao sumiu, mas porque ela mudou de endereco. O
// que ela garante nunca foi "esta NESTE arquivo" — e "esta no Bridge". Entao ela
// le o CONJUNTO, e segue acusando entrada morta do mesmo jeito: se o handler nao
// existir em lugar nenhum, o `fonteAoTeclar()` falha em vez de devolver vazio.
const FONTES_BRIDGE = [
  new URL("../screens/control-room.tsx", import.meta.url),
  new URL("./bridge/message-list.tsx", import.meta.url),
  new URL("./bridge/folder-sidebar.tsx", import.meta.url),
  new URL("./bridge/message-shared.tsx", import.meta.url),
  new URL("./bridge/bridge-split.tsx", import.meta.url),
];

const CONTROL_ROOM = new URL("../screens/control-room.tsx", import.meta.url);

/**
 * #1290 (medição da `lumen`): esta catraca podia ser satisfeita por um
 * COMENTÁRIO. Ela reproduziu o furo tirando as props reais
 * `enableShortcut`/`shortcutKey="f"` — o atalho F morre — e a guarda seguia
 * verde, porque um comentário do arquivo cita as duas strings. Eu tinha acabado
 * de AMPLIAR o alcance dela pro conjunto do Bridge (#1019), o que aumentaria a
 * superfície do furo; fechá-lo virou dívida minha.
 *
 * Uso o transpiler do TypeScript em vez de regex: ele sabe separar comentário de
 * string, então `"https://…"` dentro de um literal não some junto. (Tentei o
 * scanner antes — em TSX ele não emite os comentários, e o furo continuava
 * aberto com a guarda verde. Medi.)
 */
function semComentarios(texto: string): string {
  return ts.transpileModule(texto, {
    compilerOptions: {
      removeComments: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: false,
  }).outputText;
}

/** Todo o fonte do Bridge concatenado — para as checagens de texto. */
function fonteBridge(): string {
  return FONTES_BRIDGE.map((u) => semComentarios(readFileSync(u, "utf8"))).join("\n");
}

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
  for (const url of FONTES_BRIDGE) {
    const texto = readFileSync(url, "utf8");
    if (!texto.includes("aoTeclar")) continue;
    const src = ts.createSourceFile(
      url.pathname,
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
    if (corpo !== "") return semComentarios(corpo);
  }
  assert.fail("não achei a função `aoTeclar` em nenhuma fonte do Bridge");
}

/**
 * #1370: o atalho 'filters' vive nas PROPS `enableShortcut` + `shortcutKey="f"`
 * de um `<Filters>` (o listener é da reui, não do `aoTeclar`). A guarda antiga
 * casava as duas strings por TEXTO no fonte sem-comentários — frágil: um literal
 * (`const x = 'shortcutKey="f"'`) sobrevive ao `semComentarios` (o próprio
 * docstring gaba disso), e os dois matches podiam vir de lugares DESCONEXOS,
 * validando um Filtro morto. Aqui exijo o ELEMENTO JSX real: um `<Filters>` com
 * as duas props como ATRIBUTOS. Comentário e string não viram `JsxAttribute`,
 * então não enganam; e as duas têm que estar no MESMO elemento.
 */
function filtersComAtalhoF(texto: string): boolean {
  const src = ts.createSourceFile(
    "fixture.tsx",
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let achou = false;
  (function visit(n: ts.Node) {
    if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      n.tagName.getText(src) === "Filters"
    ) {
      const attrs = n.attributes.properties.filter(ts.isJsxAttribute);
      const temEnable = attrs.some((a) => a.name.getText(src) === "enableShortcut");
      const temKeyF = attrs.some((a) => {
        if (a.name.getText(src) !== "shortcutKey") return false;
        const init = a.initializer;
        // `shortcutKey="f"` ou `shortcutKey={"f"}`.
        if (init && ts.isStringLiteral(init)) return init.text === "f";
        if (
          init &&
          ts.isJsxExpression(init) &&
          init.expression &&
          ts.isStringLiteralLike(init.expression)
        ) {
          return init.expression.text === "f";
        }
        return false;
      });
      if (temEnable && temKeyF) achou = true;
    }
    ts.forEachChild(n, visit);
  })(src);
  return achou;
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

test("#1060/#1370: o atalho 'filters' (Filtro/F) tem <Filters enableShortcut shortcutKey=\"f\"> REAL no Bridge (AST, não texto)", () => {
  const filtro = ATALHOS_BRIDGE.filter((a) => a.fonte === "filters");
  assert.ok(filtro.length > 0, "esperava ao menos um atalho fonte:'filters' (o Filtro)");
  const achou = FONTES_BRIDGE.some((u) => filtersComAtalhoF(readFileSync(u, "utf8")));
  assert.ok(
    achou,
    'nenhum <Filters> do Bridge tem enableShortcut + shortcutKey="f" como ATRIBUTOS reais — o atalho F morreu (props tiradas) ou virou só comentário/string. Cabeie as props no <Filters> ou tire o atalho do catálogo.',
  );
});

test("#1370: a guarda 'filters' por AST não é enganada por comentário, string, nem props desconexas", () => {
  // Real → verde (com e sem type-argument genérico do <Filters<string>>).
  assert.ok(filtersComAtalhoF('const X = () => <Filters enableShortcut shortcutKey="f" />;'));
  assert.ok(filtersComAtalhoF('const X = () => <Filters<string> a={1} enableShortcut shortcutKey="f" />;'));
  assert.ok(filtersComAtalhoF('const X = () => <Filters enableShortcut shortcutKey={"f"}>oi</Filters>;'));

  // Props MORTAS (Filtro quebrado), tokens só num COMENTÁRIO → vermelho (o furo do #1290).
  assert.ok(!filtersComAtalhoF('/* <Filters enableShortcut shortcutKey="f"> */\nconst X = () => <Filters />;'));
  assert.ok(!filtersComAtalhoF('// enableShortcut shortcutKey="f"\nconst X = () => <Filters />;'));

  // Props MORTAS, tokens num LITERAL de string → vermelho (o furo residual: string sobrevive ao semComentarios).
  assert.ok(!filtersComAtalhoF('const dica = \'use enableShortcut e shortcutKey="f"\';\nconst X = () => <Filters />;'));

  // enableShortcut e shortcutKey em elementos DESCONEXOS → vermelho (têm que estar no mesmo <Filters>).
  assert.ok(!filtersComAtalhoF('const X = () => <><Outro enableShortcut /><Filters shortcutKey="f" /></>;'));

  // shortcutKey com OUTRA letra → vermelho (não é o atalho catalogado).
  assert.ok(!filtersComAtalhoF('const X = () => <Filters enableShortcut shortcutKey="g" />;'));

  // Só uma das duas props → vermelho.
  assert.ok(!filtersComAtalhoF('const X = () => <Filters enableShortcut />;'));
  assert.ok(!filtersComAtalhoF('const X = () => <Filters shortcutKey="f" />;'));
});

test("#1060: todo shortcutBridge(id) usado nos tooltips do control-room existe no catálogo com shortcut", () => {
  const texto = fonteBridge();
  const ids = [...texto.matchAll(/shortcutBridge\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, "esperava chamadas shortcutBridge(...) no Bridge");
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
  const controlRoom = semComentarios(readFileSync(CONTROL_ROOM, "utf8"));
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
