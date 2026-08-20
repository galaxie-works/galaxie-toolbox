// #1386 — a ÁRVORE consome o `getTreeContextMenu`.
//
// A regra pura já tinha 5 testes desde o #1355 e MESMO ASSIM o menu da árvore
// tinha 1 item (fixar/desafixar): a função estava viva no teste e morta na tela.
// Testar a regra de novo não provaria nada de novo — o que faltava é a prova de
// que a ÁRVORE monta o menu, POR TIPO DE NÓ, e chama os handlers do painel.
//
// Navegador real: o menu é Radix em portal e só existe depois de um
// `contextmenu` de verdade; em happy-dom eu estaria medindo o meu mock.
import "@/index.css";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { IdiomaProvider } from "@/lib/idioma";
import type { DriveInfo, FsEntry } from "@/lib/types";
import { ArvoreArquivos, type MenuArvore } from "./arvore";
import type { AcoesMenu, RotulosMenu } from "./menu-arquivo";

const DRIVE: DriveInfo = {
  name: "Disco local (C:)",
  path: "C:\\",
  kind: "fixed",
  totalSpace: 0,
  freeSpace: 0,
} as DriveInfo;

const PASTA: FsEntry = {
  name: "Documentos",
  path: "C:\\Users\\w\\Documentos",
  isDir: true,
} as FsEntry;

/** Rótulos-sentinela: o teste não depende de tradução — só de fiação. */
const ROTULOS: RotulosMenu = {
  abrir: "R-ABRIR",
  abrirCom: "R-ABRIRCOM",
  abrirComPadrao: "R-ABRIRCOM-PADRAO",
  recortar: "R-RECORTAR",
  copiar: "R-COPIAR",
  colar: "R-COLAR",
  renomear: "R-RENOMEAR",
  excluir: "R-EXCLUIR",
  excluirPerm: "R-EXCLUIR-PERM",
  novaPasta: "R-NOVA-PASTA",
  novoArquivo: "R-NOVO-ARQUIVO",
  copiarCaminho: "R-COPIAR-CAMINHO",
  revelar: "R-REVELAR",
  propriedades: "R-PROPRIEDADES",
};

function acoesFalsas(): AcoesMenu {
  return {
    abrir: vi.fn(),
    abrirCom: vi.fn(),
    recortar: vi.fn(),
    copiar: vi.fn(),
    colar: vi.fn(),
    renomear: vi.fn(),
    paraLixeira: vi.fn(),
    excluirPerm: vi.fn(),
    novaPasta: vi.fn(),
    novoArquivo: vi.fn(),
    copiarCaminho: vi.fn(),
    revelar: vi.fn(),
    propriedades: vi.fn(),
  };
}

function montar(menu: MenuArvore | undefined, onNavegar = () => {}) {
  render(
    <IdiomaProvider>
      <div style={{ width: 320, height: 600 }}>
        <ArvoreArquivos
          drives={[DRIVE]}
          cloudLocations={[]}
          networkLocations={[]}
          acessoRapido={[PASTA]}
          pins={[]}
          onAlternarFixar={() => {}}
          onRemoverAcessoRapido={() => {}}
          homePath={null}
          currentPath=""
          onNavegar={onNavegar}
          menu={menu}
        />
      </div>
    </IdiomaProvider>,
  );
}

async function ate<T>(busca: () => T | null, ms = 6000): Promise<T | null> {
  const fim = Date.now() + ms;
  for (;;) {
    const v = busca();
    if (v) return v;
    if (Date.now() >= fim) return null;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * O elemento MAIS INTERNO cujo texto é exatamente o nome do nó. Interno de
 * propósito: o container do `ComMenu` é ancestral dele, e o `contextmenu`
 * borbulha pra cima. Pegando o de FORA (o `FolderItem`) o evento nunca desceria
 * até o gatilho — foi assim que as 7 asserções falharam na primeira rodada.
 */
function noPorNome(nome: string): HTMLElement | null {
  const alvos = [...document.querySelectorAll<HTMLElement>("*")].filter(
    (d) => d.textContent?.trim() === nome,
  );
  return alvos.at(-1) ?? null;
}

async function abrirMenu(nome: string, opts: { shift?: boolean } = {}) {
  // O menu do teste anterior pode estar SAINDO (Radix anima o fecho). Se eu
  // dispatchar sem esperar, o poll abaixo devolve a lista VELHA e o teste vira
  // moeda — foi exatamente o que aconteceu na 2ª rodada.
  const saiu = await ate(() =>
    document.querySelectorAll('[role="menuitem"]').length === 0 ? true : null,
  );
  expect(saiu, "menu anterior não fechou").toBe(true);
  const no = await ate(() => noPorNome(nome));
  expect(no, `nó "${nome}" não apareceu`).not.toBeNull();
  no!.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 20,
      clientY: 20,
      shiftKey: opts.shift ?? false,
    }),
  );
  const itens = await ate(() => {
    const l = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    return l.length > 0 ? l : null;
  });
  expect(itens, "o menu não abriu").not.toBeNull();
  return itens!;
}

const textos = (itens: HTMLElement[]) =>
  itens.map((i) => i.textContent?.trim() ?? "");

/** Clica um item pelo rótulo — falha DIZENDO o que havia no menu. */
function clicar(itens: HTMLElement[], rotulo: string) {
  const alvo = itens.find((i) => i.textContent?.trim() === rotulo);
  expect(alvo, `"${rotulo}" não está no menu: ${textos(itens).join(" | ")}`).toBeTruthy();
  alvo!.click();
}

describe("#1386 menu de contexto da árvore", () => {
  beforeEach(() => {
    // Esc fecha o menu que o teste anterior deixou aberto; o `cleanup` sozinho
    // desmonta a árvore mas o portal do Radix sobrevive ao frame.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    cleanup();
    document.body.innerHTML = "";
  });

  it("sem ações do painel, cai no menu antigo de 1 item (fixar)", async () => {
    montar(undefined);
    const itens = await abrirMenu("Disco local (C:)");
    expect(itens).toHaveLength(1);
    expect(textos(itens).join()).not.toContain("R-");
  });

  it("nó PASTA recebe o menu inteiro, destrutivas incluídas", async () => {
    const acoes = acoesFalsas();
    montar({ obterAcoes: () => acoes, rotulos: ROTULOS, clipboard: { paths: ["C:\\x"], op: "copy" }, navegarEAgir: () => {} });
    const t = textos(await abrirMenu("Documentos"));
    for (const esperado of [
      "R-ABRIR",
      "R-RECORTAR",
      "R-COPIAR",
      "R-COLAR",
      "R-RENOMEAR",
      "R-EXCLUIR",
      "R-NOVA-PASTA",
      "R-NOVO-ARQUIVO",
      "R-COPIAR-CAMINHO",
      "R-REVELAR",
      "R-PROPRIEDADES",
    ]) {
      expect(t, `faltou ${esperado} na pasta`).toContain(esperado);
    }
  });

  it("nó DRIVE perde o que destrói/move ele mesmo", async () => {
    const acoes = acoesFalsas();
    montar({ obterAcoes: () => acoes, rotulos: ROTULOS, clipboard: null, navegarEAgir: () => {} });
    const t = textos(await abrirMenu("Disco local (C:)"));
    // O AC: Recortar/Renomear/Excluir somem no drive...
    for (const proibido of ["R-RECORTAR", "R-RENOMEAR", "R-EXCLUIR", "R-EXCLUIR-PERM"]) {
      expect(t, `${proibido} não devia existir no drive`).not.toContain(proibido);
    }
    // ...e Copiar caminho / Propriedades / Fixar ficam.
    for (const esperado of [
      "R-ABRIR",
      "R-COPIAR",
      "R-COPIAR-CAMINHO",
      "R-PROPRIEDADES",
      // criar DENTRO do drive é legítimo (o Explorer deixa) — só destruir o
      // próprio drive é que não.
      "R-NOVA-PASTA",
    ]) {
      expect(t, `faltou ${esperado} no drive`).toContain(esperado);
    }
  });

  it("Shift no clique direito troca Lixeira por permanente (só em pasta)", async () => {
    const acoes = acoesFalsas();
    montar({ obterAcoes: () => acoes, rotulos: ROTULOS, clipboard: null, navegarEAgir: () => {} });
    const t = textos(await abrirMenu("Documentos", { shift: true }));
    expect(t).toContain("R-EXCLUIR-PERM");
    expect(t).not.toContain("R-EXCLUIR");
  });

  it("ação por CAMINHO age direto e NÃO tira o usuário do lugar", async () => {
    const acoes = acoesFalsas();
    const onNavegar = vi.fn();
    const navegarEAgir = vi.fn();
    montar({ obterAcoes: () => acoes, rotulos: ROTULOS, clipboard: null, navegarEAgir }, onNavegar);
    const itens = await abrirMenu("Documentos");
    clicar(itens, "R-COPIAR");
    expect(acoes.copiar).toHaveBeenCalledWith([PASTA.path]);
    expect(navegarEAgir).not.toHaveBeenCalled();
    expect(onNavegar).not.toHaveBeenCalled();
  });

  it("Renomear NAVEGA pro PAI antes de agir (o input inline mora na lista)", async () => {
    const acoes = acoesFalsas();
    const navegarEAgir = vi.fn();
    montar({ obterAcoes: () => acoes, rotulos: ROTULOS, clipboard: null, navegarEAgir });
    const itens = await abrirMenu("Documentos");
    clicar(itens, "R-RENOMEAR");
    expect(navegarEAgir).toHaveBeenCalledTimes(1);
    expect(navegarEAgir.mock.calls[0][0]).toBe("C:\\Users\\w");
    // e o handler do painel só roda quando o painel chega lá
    expect(acoes.renomear).not.toHaveBeenCalled();
    navegarEAgir.mock.calls[0][1](acoes);
    expect(acoes.renomear).toHaveBeenCalledWith(PASTA);
  });

  it("Nova pasta navega pra DENTRO da pasta clicada antes de criar", async () => {
    const acoes = acoesFalsas();
    const navegarEAgir = vi.fn();
    montar({ obterAcoes: () => acoes, rotulos: ROTULOS, clipboard: null, navegarEAgir });
    const itens = await abrirMenu("Documentos");
    clicar(itens, "R-NOVA-PASTA");
    expect(navegarEAgir.mock.calls[0][0]).toBe(PASTA.path);
    navegarEAgir.mock.calls[0][1](acoes);
    expect(acoes.novaPasta).toHaveBeenCalledWith(PASTA.path);
  });
});
