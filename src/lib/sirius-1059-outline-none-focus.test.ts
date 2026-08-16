import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import test from "node:test";

// #1059 (gate estático da raia Sirius, a11y do Bridge) — proíbe `outline-none`
// ISOLADO em elemento interativo: a classe zera o outline nativo mas NÃO devolve
// um anel de foco (`focus-visible:`/`focus:`/`ring-`), então o alvo de teclado
// fica INVISÍVEL ao focar (achados UX6/UX9/UX16/UX17). O app já tem o padrão
// certo (People: `focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50`).
//
// No mesmo espírito dos gates de string (#861) e botão-morto (AST): escaneia o
// source, congela a dívida conhecida (BASELINE) e falha em QUALQUER regressão nova.
// A verificação é feita na EXPRESSÃO de classe inteira (a chamada `cn(...)`/`cva(...)`
// que envolve o `outline-none`), não na linha física — assim um `ring-` num
// argumento vizinho (ex.: `cn("...outline-none", cursor && "ring-2")`) conta.
//
// Exceções: `// a11y-ignore` na linha do `outline-none`, ou entrada no BASELINE
// (containers/primitivos NÃO-focáveis: popup de menu/diálogo, positioner, badge,
// wrapper — onde o anel vem de um filho ou o elemento não recebe foco).

const FOCUS = /(?:focus-visible:|focus:|ring-)/;

/** Zera o conteúdo dos comentários de bloco preservando as quebras de linha. */
function semComentariosDeBloco(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** Tira o comentário de linha, poupando `https://` (o `//` colado no `:`). */
function semComentarioDeLinha(linha: string): string {
  return linha.replace(/(^|[^:])\/\/.*$/, "$1");
}

function normalizar(p: string): string {
  return p.replaceAll("\\", "/");
}

/** [início, fim) do literal de string (", ' ou `) que contém o índice. */
function literal(text: string, idx: number): [number, number] {
  let ls = idx;
  while (ls > 0 && !`"'\``.includes(text[ls - 1]!)) ls--;
  const q = text[ls - 1];
  let le = idx;
  while (le < text.length && text[le] !== q) le++;
  return [ls, le];
}

/**
 * Janela de classe a checar: se o literal é argumento de `cn(...)`/`cva(...)`,
 * a chamada inteira; senão, o próprio literal. Assim um anel num argumento
 * irmão (ou variante condicional) satisfaz a regra.
 */
function janela(text: string, matchIdx: number): string {
  const [ls, le] = literal(text, matchIdx);
  // Char não-branco imediatamente antes do literal.
  let j = ls - 1; // a aspa de abertura
  j--; // antes da aspa
  while (j >= 0 && /\s/.test(text[j]!)) j--;
  if (text[j] !== "(" && text[j] !== ",") return text.slice(ls, le);
  // Acha o '(' que ENVOLVE (profundidade 0 varrendo à esquerda).
  let depth = 0;
  let i = j;
  for (; i >= 0; i--) {
    const c = text[i]!;
    if (c === ")") depth++;
    else if (c === "(") {
      if (depth === 0) break;
      depth--;
    }
  }
  if (i < 0) return text.slice(ls, le);
  const antes = text.slice(Math.max(0, i - 4), i);
  if (!/(?:^|[^A-Za-z0-9_])(cn|cva)$/.test(antes)) return text.slice(ls, le);
  // Fecha a chamada (profundidade 0 varrendo à direita).
  let d = 0;
  let k = i;
  for (; k < text.length; k++) {
    if (text[k] === "(") d++;
    else if (text[k] === ")") {
      d--;
      if (d === 0) break;
    }
  }
  return text.slice(i, k + 1);
}

/** Linha física (1-based) e o texto da linha para o índice dado. */
function linhaDe(text: string, idx: number): { n: number; texto: string } {
  let n = 1;
  let ini = 0;
  for (let i = 0; i < idx; i++)
    if (text[i] === "\n") {
      n++;
      ini = i + 1;
    }
  let fim = text.indexOf("\n", idx);
  if (fim < 0) fim = text.length;
  return { n, texto: text.slice(ini, fim) };
}

// Dívida PRÉ-EXISTENTE / intencional (containers e primitivos NÃO-focáveis, ou
// que já sinalizam o estado por outro meio). Ao tornar um destes focável e sem
// anel, corrigir na fonte e remover a entrada. NÃO adicionar novas por
// conveniência — elemento INTERATIVO novo = anel de foco na fonte.
const BASELINE = new Set<string>([
  // Popups de menu Radix (animate-ui): o CONTAINER não recebe foco de teclado —
  // o anel vive nos itens (via data-highlighted), não na casca.
  "src/components/animate-ui/components/radix/dropdown-menu.tsx::bg-popover text-popover-foreground z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md outline-none",
  "src/components/animate-ui/components/radix/dropdown-menu.tsx::bg-popover text-popover-foreground z-50 min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-md border p-1 shadow-lg outline-none",
  // DialogContent: container do diálogo; o foco vai pro 1º filho focável.
  "src/components/ui/dialog.tsx::fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none sm:max-w-lg",
  // Positioner do Autocomplete (base-ui): casca de posicionamento, não-focável.
  "src/components/reui/autocomplete.tsx::z-50 outline-none",
  // Item de opção do InlineCombobox: destaca por data-[active-item], não por foco.
  "src/components/ui/inline-combobox.tsx::relative mx-1 flex h-[28px] select-none items-center rounded-sm px-2 text-foreground text-sm outline-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  // Badge: elemento não-interativo (rótulo visual).
  "src/components/reui/badge.tsx::relative inline-flex shrink-0 items-center justify-center w-fit border border-transparent font-medium whitespace-nowrap outline-none transition-shadow",
  // Lista do Explorer (#770): anel omitido DE PROPÓSITO — a borda do card externo
  // já delimita a área; o anel virava "borda dupla" (decisão registrada na fonte).
  "src/components/explorer/content-pane.tsx::min-h-0 flex-1 overflow-y-auto scrollbar-fina rounded-md outline-none",
  // Textarea do nó de desenho de código (editor Plate, fora do Bridge): dívida
  // pré-existente do registry vendorizado; não faz parte do escopo #1059.
  "src/components/ui/code-drawing-node.tsx::m-0 h-full w-full resize-none overflow-auto border-0 bg-transparent p-0 font-mono text-sm outline-none",
]);

function coletar(): string[] {
  const arquivos = globSync("src/**/*.tsx").filter(
    (f) => !/\.(test|spec|stories)\./.test(normalizar(f)),
  );
  const viol: string[] = [];
  for (const arquivo of arquivos) {
    const rel = normalizar(arquivo);
    const text = semComentariosDeBloco(readFileSync(arquivo, "utf8"));
    const re = /outline-none/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const { n, texto } = linhaDe(text, m.index);
      // Fora de literal de classe (comentário de linha) — ignora.
      if (!semComentarioDeLinha(texto).includes("outline-none")) continue;
      if (/a11y-ignore/.test(texto)) continue;
      const win = janela(text, m.index)
        .split("\n")
        .map(semComentarioDeLinha)
        .join("\n");
      if (FOCUS.test(win)) continue;
      const [ls, le] = literal(text, m.index);
      const sig = `${rel}::${text.slice(ls, le).trim().replace(/\s+/g, " ")}`;
      if (BASELINE.has(sig)) continue;
      viol.push(`${rel}:${n}  ${sig.split("::")[1]}`);
    }
  }
  return viol;
}

test("#1059: nenhum outline-none isolado (sem anel de foco) em elemento interativo", () => {
  const viol = coletar();
  assert.deepEqual(
    viol,
    [],
    `outline-none sem focus-visible:/focus:/ring- — aplique o anel do People ` +
      `(focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50), ` +
      `ou // a11y-ignore / BASELINE se o elemento NÃO é focável:\n` +
      viol.map((v) => "  " + v).join("\n"),
  );
});
