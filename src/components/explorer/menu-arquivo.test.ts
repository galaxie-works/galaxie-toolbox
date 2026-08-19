// Testes headless dos builders do menu de contexto + helpers de nome (#714).
// Rode com:
//   node --test --experimental-strip-types src/components/explorer/menu-arquivo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  alvosDe,
  getEmptySpaceContextMenu,
  getFileContextMenu,
  nomeEmConflito,
  nomeUnico,
  nomeValido,
  type AcoesMenu,
  type Clipboard,
  getTreeContextMenu,
  type ItemMenu,
  type RotulosMenu,
} from "./menu-arquivo.ts";
import {
  juntarCaminho,
  nomeBase,
  separarNomeExt,
} from "./caminho.ts";
import type { FsEntry } from "../../lib/types.ts";

function entry(over: Partial<FsEntry>): FsEntry {
  return {
    name: over.name ?? "x",
    path: over.path ?? `C:\\dir\\${over.name ?? "x"}`,
    isDir: false,
    isSymlink: false,
    size: 0,
    modifiedMs: null,
    createdMs: null,
    extension: null,
    isHidden: false,
    isReadonly: false,
    ...over,
  };
}

const ROTULOS: RotulosMenu = {
  abrir: "abrir",
  abrirCom: "abrirCom",
  abrirComPadrao: "abrirComPadrao",
  recortar: "recortar",
  copiar: "copiar",
  colar: "colar",
  renomear: "renomear",
  excluir: "excluir",
  excluirPerm: "excluirPerm",
  novaPasta: "novaPasta",
  novoArquivo: "novoArquivo",
  copiarCaminho: "copiarCaminho",
  revelar: "revelar",
  propriedades: "propriedades",
};

/** Coleta chamadas por ação pra checar a fiação do onClick. */
function acoesSpy() {
  const calls: Record<string, unknown[]> = {};
  const rec =
    (nome: string) =>
    (...args: unknown[]) => {
      (calls[nome] ??= []).push(args);
    };
  const acoes: AcoesMenu = {
    abrir: rec("abrir"),
    abrirCom: rec("abrirCom"),
    recortar: rec("recortar"),
    copiar: rec("copiar"),
    colar: rec("colar"),
    renomear: rec("renomear"),
    paraLixeira: rec("paraLixeira"),
    excluirPerm: rec("excluirPerm"),
    novaPasta: rec("novaPasta"),
    novoArquivo: rec("novoArquivo"),
    copiarCaminho: rec("copiarCaminho"),
    revelar: rec("revelar"),
    propriedades: rec("propriedades"),
  };
  return { acoes, calls };
}

/** Achata ids (com submenus) pra facilitar as asserções. */
function ids(itens: ItemMenu[]): string[] {
  return itens.map((i) => i.id);
}
function porId(itens: ItemMenu[], id: string): ItemMenu | undefined {
  return itens.find((i) => i.id === id);
}

test("alvosDe: usa a seleção quando o item clicado faz parte dela", () => {
  const e = entry({ name: "a", path: "C:\\d\\a" });
  assert.deepEqual(alvosDe(e, ["C:\\d\\a", "C:\\d\\b"]), [
    "C:\\d\\a",
    "C:\\d\\b",
  ]);
});

test("alvosDe: item fora da seleção → só ele", () => {
  const e = entry({ name: "a", path: "C:\\d\\a" });
  assert.deepEqual(alvosDe(e, ["C:\\d\\x"]), ["C:\\d\\a"]);
  assert.deepEqual(alvosDe(e, []), ["C:\\d\\a"]);
});

test("getFileContextMenu (arquivo): tem Abrir com; Colar desabilitado (arquivo)", () => {
  const { acoes } = acoesSpy();
  const e = entry({ name: "foto.png", path: "C:\\d\\foto.png" });
  const m = getFileContextMenu(e, [], null, acoes, ROTULOS);
  assert.ok(ids(m).includes("abrirCom"));
  // Colar num ARQUIVO nunca habilita (só pasta).
  assert.equal(porId(m, "colar")?.disabled, true);
  // Excluir padrão = Lixeira (destrutivo), não permanente.
  assert.ok(porId(m, "excluir"));
  assert.equal(porId(m, "excluirPerm"), undefined);
  assert.equal(porId(m, "excluir")?.variant, "destructive");
});

test("getFileContextMenu (pasta): sem Abrir com; Colar habilita com clipboard cheio", () => {
  const { acoes } = acoesSpy();
  const dir = entry({ name: "Fotos", path: "C:\\d\\Fotos", isDir: true });
  const clip: Clipboard = { paths: ["C:\\x\\a"], op: "copy" };
  const m = getFileContextMenu(dir, [], clip, acoes, ROTULOS);
  assert.equal(porId(m, "abrirCom"), undefined);
  assert.equal(porId(m, "colar")?.disabled, false);
});

test("getFileContextMenu: clipboard vazio deixa Colar desabilitado mesmo em pasta", () => {
  const { acoes } = acoesSpy();
  const dir = entry({ name: "Fotos", path: "C:\\d\\Fotos", isDir: true });
  const m = getFileContextMenu(dir, [], null, acoes, ROTULOS);
  assert.equal(porId(m, "colar")?.disabled, true);
});

test("getFileContextMenu: Renomear desabilita em multi-seleção", () => {
  const { acoes } = acoesSpy();
  const e = entry({ name: "a", path: "C:\\d\\a" });
  const m = getFileContextMenu(e, ["C:\\d\\a", "C:\\d\\b"], null, acoes, ROTULOS);
  assert.equal(porId(m, "renomear")?.disabled, true);
});

test("getFileContextMenu: opts.permanente troca Lixeira por permanente", () => {
  const { acoes, calls } = acoesSpy();
  const e = entry({ name: "a", path: "C:\\d\\a" });
  const m = getFileContextMenu(e, [], null, acoes, ROTULOS, { permanente: true });
  assert.equal(porId(m, "excluir"), undefined);
  const perm = porId(m, "excluirPerm");
  assert.ok(perm);
  assert.equal(perm?.variant, "destructive");
  perm?.onClick?.();
  assert.deepEqual(calls.excluirPerm, [[["C:\\d\\a"]]]);
  assert.equal(calls.paraLixeira, undefined);
});

test("getFileContextMenu: onClick de Copiar/Recortar/Excluir usa os alvos da seleção", () => {
  const { acoes, calls } = acoesSpy();
  const e = entry({ name: "a", path: "C:\\d\\a" });
  const sel = ["C:\\d\\a", "C:\\d\\b"];
  const m = getFileContextMenu(e, sel, null, acoes, ROTULOS);
  porId(m, "copiar")?.onClick?.();
  porId(m, "excluir")?.onClick?.();
  assert.deepEqual(calls.copiar, [[sel]]);
  assert.deepEqual(calls.paraLixeira, [[sel]]);
});

test("getFileContextMenu: Colar chama colar(destDir = path da pasta)", () => {
  const { acoes, calls } = acoesSpy();
  const dir = entry({ name: "Fotos", path: "C:\\d\\Fotos", isDir: true });
  const clip: Clipboard = { paths: ["C:\\x\\a"], op: "cut" };
  const m = getFileContextMenu(dir, [], clip, acoes, ROTULOS);
  porId(m, "colar")?.onClick?.();
  assert.deepEqual(calls.colar, [["C:\\d\\Fotos"]]);
});

test("getEmptySpaceContextMenu: Colar + Nova pasta + Novo arquivo; Colar gated no clipboard", () => {
  const { acoes, calls } = acoesSpy();
  const vazio = getEmptySpaceContextMenu("C:\\d", null, acoes, ROTULOS);
  assert.deepEqual(ids(vazio), ["colar", "novaPasta", "novoArquivo"]);
  assert.equal(porId(vazio, "colar")?.disabled, true);

  const cheio = getEmptySpaceContextMenu(
    "C:\\d",
    { paths: ["C:\\x\\a"], op: "copy" },
    acoes,
    ROTULOS,
  );
  assert.equal(porId(cheio, "colar")?.disabled, false);
  porId(cheio, "novaPasta")?.onClick?.();
  assert.deepEqual(calls.novaPasta, [["C:\\d"]]);
});

test("nomeValido: rejeita vazio e caracteres proibidos", () => {
  assert.equal(nomeValido("relatorio.pdf"), true);
  assert.equal(nomeValido("  "), false);
  assert.equal(nomeValido(""), false);
  assert.equal(nomeValido("a/b"), false);
  assert.equal(nomeValido("a:b"), false);
  assert.equal(nomeValido("a?b"), false);
});

test("nomeEmConflito: case-insensitive, ignorando o próprio item", () => {
  const irmaos = [
    entry({ name: "Doc.txt", path: "C:\\d\\Doc.txt" }),
    entry({ name: "Fotos", path: "C:\\d\\Fotos", isDir: true }),
  ];
  assert.equal(nomeEmConflito("doc.txt", irmaos), true);
  assert.equal(nomeEmConflito("novo.txt", irmaos), false);
  // Renomeando o próprio Doc.txt: manter o nome não é conflito.
  assert.equal(nomeEmConflito("Doc.txt", irmaos, "C:\\d\\Doc.txt"), false);
});

test("nomeUnico: sufixa (2), (3)…", () => {
  const irmaos = [
    entry({ name: "Nova pasta", path: "C:\\d\\Nova pasta", isDir: true }),
    entry({ name: "Nova pasta (2)", path: "C:\\d\\Nova pasta (2)", isDir: true }),
  ];
  assert.equal(nomeUnico("Nova pasta", irmaos), "Nova pasta (3)");
  assert.equal(nomeUnico("Outra", irmaos), "Outra");
});

test("helpers de caminho: juntar, nomeBase, separarNomeExt", () => {
  assert.equal(juntarCaminho("C:\\d", "a.txt"), "C:\\d\\a.txt");
  assert.equal(juntarCaminho("C:\\d\\", "a.txt"), "C:\\d\\a.txt");
  assert.equal(juntarCaminho("C:\\", "a.txt"), "C:\\a.txt");
  assert.equal(nomeBase("C:\\d\\a.txt"), "a.txt");
  assert.equal(nomeBase("C:\\d\\sub\\"), "sub");
  assert.deepEqual(separarNomeExt("relatorio.pdf"), {
    base: "relatorio",
    ext: ".pdf",
  });
  assert.deepEqual(separarNomeExt(".env"), { base: ".env", ext: "" });
  assert.deepEqual(separarNomeExt("Fotos"), { base: "Fotos", ext: "" });
});

// ── #1283 B: menu de contexto da ÁRVORE (sidebar do Files) ──────────────────
//
// A árvore tinha só Fixar/Desafixar. O AC pede as MESMAS ações do conteúdo,
// reusando os handlers — e com recorte por tipo de nó. Estes casos travam o
// recorte; sem eles a feature seria "implementada, não guardada" (lição do #1152).

const PIN = { fixado: false, rotulo: "Fixar", aoAlternar: () => {} };

test("#1283 pasta comum: menu COMPLETO + Fixar no fim", () => {
  const { acoes } = acoesSpy();
  const itens = getTreeContextMenu(
    entry({ name: "Projetos", path: "C:\\dir\\Projetos", isDir: true }),
    "pasta",
    { paths: ["C:\\x"], op: "copy" },
    acoes,
    ROTULOS,
    PIN,
  );
  const i = ids(itens);
  for (const esperado of ["abrir", "recortar", "copiar", "renomear", "excluir", "copiarCaminho", "propriedades"]) {
    assert.ok(i.includes(esperado), `faltou "${esperado}" na pasta comum: ${i}`);
  }
  assert.equal(i.at(-1), "fixar", "Fixar tem de ser o último item");
});

test("#1283 DRIVE: sem Recortar/Renomear/Excluir; Fixar/Propriedades/Copiar caminho ficam", () => {
  const { acoes } = acoesSpy();
  const itens = getTreeContextMenu(
    entry({ name: "C: (C:)", path: "C:\\", isDir: true }),
    "drive",
    null,
    acoes,
    ROTULOS,
    PIN,
  );
  const i = ids(itens);
  for (const proibido of ["recortar", "renomear", "excluir", "excluirPerm"]) {
    assert.ok(!i.includes(proibido), `"${proibido}" NÃO pode existir num drive: ${i}`);
  }
  for (const obrigatorio of ["copiarCaminho", "propriedades", "fixar"]) {
    assert.ok(i.includes(obrigatorio), `faltou "${obrigatorio}" no drive: ${i}`);
  }
});

test("#1283 RAIZ especial: além dos destrutivos, sem Colar/Nova pasta/Abrir com", () => {
  const { acoes } = acoesSpy();
  const itens = getTreeContextMenu(
    entry({ name: "This PC", path: "::este-pc::", isDir: true }),
    "raiz",
    { paths: ["C:\\x"], op: "copy" },
    acoes,
    ROTULOS,
    PIN,
  );
  const i = ids(itens);
  for (const proibido of ["recortar", "renomear", "excluir", "colar", "novaPasta", "novoArquivo", "abrirCom"]) {
    assert.ok(!i.includes(proibido), `"${proibido}" NÃO pode existir numa raiz: ${i}`);
  }
  assert.ok(i.includes("propriedades"), `raiz perdeu propriedades: ${i}`);
  assert.equal(i.at(-1), "fixar");
});

test("#1283 Colar fica DESABILITADO sem clipboard (o AC pede habilitado só com ele)", () => {
  const { acoes } = acoesSpy();
  const menu = getTreeContextMenu(
    entry({ name: "P", path: "C:\\dir\\P", isDir: true }),
    "pasta",
    null,
    acoes,
    ROTULOS,
    PIN,
  );
  const colar = menu.find((i) => i.id === "colar");
  // O builder do conteúdo MANTÉM o item e o desabilita — é o comportamento que o
  // AC descreve ("Colar (habilitado só com clipboard interno)"), e reusá-lo é o
  // ponto desta fatia. Escrevi este caso esperando ausência e o código me
  // corrigiu; deixo o registro pra ninguém "consertar" pro lado errado.
  assert.ok(colar, "Colar deveria existir no menu de pasta");
  assert.equal(colar.disabled, true, "sem clipboard, Colar tem de vir desabilitado");
});

test("#1283 o rótulo do pin vem de fora (i18n do chamador), não é inventado aqui", () => {
  const { acoes } = acoesSpy();
  const itens = getTreeContextMenu(
    entry({ name: "P", path: "C:\\dir\\P", isDir: true }),
    "pasta",
    null,
    acoes,
    ROTULOS,
    { fixado: true, rotulo: "Desafixar do Acesso rápido", aoAlternar: () => {} },
  );
  const pin = itens.at(-1)!;
  assert.equal(pin.label, "Desafixar do Acesso rápido");
  assert.equal(pin.icon, "desafixar");
});
