import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// #861+ (gate AST da Lumen II) — completude de botões. O regex trunca no `=>` das
// arrow functions; aqui o TS compiler API lê atributos/filhos de verdade.
// Dois checks de alta confiança (conservadores — nunca reprovam botão bom):
//   1) BOTÃO MORTO: sem handler (onClick/…/type/asChild/href/disabled), sem spread
//      {...props}, e fora de wrapper Radix asChild (*Trigger/Close/Cancel/Action que
//      injetam comportamento). É o "botão que não faz nada".
//   2) ICON-ONLY SEM NOME ACESSÍVEL: só ícone (elemento, sem texto nem expressão em
//      posição de filho), sem aria-label/title/aria-labelledby, fora de *Trigger…
//      (então sem tooltip via TooltipTrigger). É o "icon only sem tooltip".
// Exceções: `// lumen-ignore-button` na linha de abertura + BASELINE (dívida atual).

const VENDOR = [
  "/components/ui/", "/components/reui/", "/components/examples/",
  "/components/smoothui/", "/components/animate-ui/", "/components/editor/",
  "/components/magicui/", "/components/kibo-ui/", "/components/motion-primitives/",
  "/components/prompt-kit/",
];
const HANDLERS = ["onClick", "onPointerDown", "onMouseDown", "onValueChange", "onSelect", "onCheckedChange", "onKeyDown", "onDoubleClick"];
const WRAP = /(Trigger|Close|Cancel|Action)$/; // wrappers Radix asChild injetam o comportamento

// Dívida PRÉ-EXISTENTE (medida no feat). Corrigir na fonte (aria-label i18n) e
// remover a entrada. NÃO adicionar novas — botão novo assim = corrigir na fonte.
const BASELINE_ICON = new Set<string>([
  'src/components/people/people-view.tsx::<button type="button" className="ml-0.5 rounded-sm opacity-70 hover:opacity-100" onClick={() => onToggle(nome)} >',
]);
const BASELINE_MORTO = new Set<string>([]);

const nomeAttr = (a: ts.JsxAttributeLike) => (ts.isJsxSpreadAttribute(a) ? "" : a.name?.getText() ?? "");
const norm = (p: string) => p.replaceAll("\\", "/");

function ancestral(node: ts.Node, pred: (tag: string) => boolean): boolean {
  let n = node.parent;
  while (n) {
    if (ts.isJsxElement(n) && pred(n.openingElement.tagName.getText())) return true;
    n = n.parent;
  }
  return false;
}

function ehIconOnly(btn: ts.JsxElement): boolean {
  let texto = false, icone = false;
  (function w(n: ts.Node) {
    if (ts.isJsxText(n) && /[A-Za-zÀ-ÿ]/.test(n.text)) texto = true;
    // expressão em posição de FILHO (não atributo) = rótulo em potencial
    if (ts.isJsxExpression(n) && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) texto = true;
    if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && n !== btn) icone = true;
    ts.forEachChild(n, w);
  })(btn);
  return icone && !texto;
}

function analisar() {
  const arquivos = globSync("src/**/*.tsx").filter((f) => {
    const p = norm(f);
    return !/\.(test|spec|stories)\./.test(p) && !VENDOR.some((v) => p.includes(v));
  });
  const mortos: string[] = [], icones: string[] = [];
  for (const arquivo of arquivos) {
    const rel = norm(arquivo);
    const texto = readFileSync(arquivo, "utf8");
    const src = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const linhaDe = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart()).line;
    const linhas = texto.split("\n");
    (function visit(node: ts.Node) {
      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText();
        if (tag === "Button" || tag === "button") {
          const linha0 = linhaDe(node);
          const ignorar = /lumen-ignore-button/.test(linhas[linha0] ?? "") || /lumen-ignore-button/.test(linhas[linha0 - 1] ?? "");
          if (!ignorar) {
            const props = node.openingElement.attributes.properties;
            const spread = props.some(ts.isJsxSpreadAttribute);
            const nomes = props.map(nomeAttr);
            const g = (n: string) => nomes.includes(n);
            const handler = HANDLERS.some(g) || g("asChild") || g("href") || g("disabled") || g("type");
            const nomeAcessivel = g("aria-label") || g("title") || g("aria-labelledby");
            const wrapped = ancestral(node, (t) => WRAP.test(t));
            const chave = `${rel}::${node.openingElement.getText().replace(/\s+/g, " ").trim()}`;
            const loc = `${rel}:${linha0 + 1}`;
            if (!handler && !spread && !wrapped && !BASELINE_MORTO.has(chave)) mortos.push(`${loc}  ${chave.split("::")[1].slice(0, 80)}`);
            if (ehIconOnly(node) && !nomeAcessivel && !wrapped && !BASELINE_ICON.has(chave)) icones.push(`${loc}  ${chave.split("::")[1].slice(0, 80)}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    })(src);
  }
  return { mortos, icones };
}

const { mortos, icones } = analisar();

test("botão-morto: nenhum <Button/button> novo sem handler (não faz nada)", () => {
  assert.deepEqual(mortos, [], `Botão sem onClick/type/asChild/href/disabled (não faz nada) — ligue um handler ou // lumen-ignore-button:\n${mortos.map((v) => "  " + v).join("\n")}`);
});

test("icon-only: nenhum botão só-ícone novo sem nome acessível (aria-label/tooltip)", () => {
  assert.deepEqual(icones, [], `Botão icon-only sem aria-label/title nem TooltipTrigger — adicione nome acessível ou // lumen-ignore-button:\n${icones.map((v) => "  " + v).join("\n")}`);
});
