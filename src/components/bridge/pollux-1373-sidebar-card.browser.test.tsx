// #1373 — o sidebar do Bridge voltou a ser CARD arredondado (reversão do PO).
//
// Guarda no padrão que a gata do card pede: **token no código e estilo
// computado, não pixel**. Comparo a cor de fundo do sidebar com o valor que o
// `--card` resolve no próprio documento — se alguém trocar o token, o teste
// acompanha; se alguém cravar um `#hex`, o teste cai. É o oposto de comparar
// screenshot.
//
// Navegador real: `getComputedStyle` de token e `border-radius` efetivo não
// existem em happy-dom.
import "@/index.css";
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { IdiomaProvider, useIdioma } from "@/lib/idioma";
import { FolderSidebar } from "./folder-sidebar";

async function ate<T extends Element>(busca: () => T | null, ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const el = busca();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

const nada = () => {};

function Palco() {
  const { t } = useIdioma();
  return (
    <FolderSidebar
      pastas={[]}
      subpastas={{}}
      onCarregarSubpastas={nada}
      sel=""
      onSel={nada}
      onNovo={nada}
      onComposeOutlook={nada}
      onMarcarTodasLidas={nada}
      onEsvaziarPasta={nada}
      arvore={[]}
      arvoreCarregando={false}
      onAbrirArvore={nada}
      onCriarSubpasta={nada}
      onRenomearPasta={nada}
      onExcluirPasta={nada}
      onMoverPasta={nada}
      caixas={[]}
      caixaAtiva=""
      emailProprio="eu@exemplo.com"
      onSelecionarCaixa={nada}
      onAbrirAdicionarCaixa={nada}
      caixaCompartilhada={false}
      colapsada={false}
      onToggleSidebar={nada}
      bridgeView="mail"
      onSelectModule={nada}
      t={t}
    />
  );
}

/** Valor que um token do design system resolve AGORA, no documento. */
function corDoToken(nome: string): string {
  const sonda = document.createElement("div");
  sonda.style.backgroundColor = `var(${nome})`;
  document.body.append(sonda);
  const cor = getComputedStyle(sonda).backgroundColor;
  sonda.remove();
  return cor;
}

async function montarSidebar() {
  render(
    <IdiomaProvider>
      <TooltipProvider>
        <div style={{ width: 300, height: 500, display: "flex" }}>
          <Palco />
        </div>
      </TooltipProvider>
    </IdiomaProvider>
  );
  const aside = await ate(() => document.querySelector<HTMLElement>("aside"));
  expect(aside, "o sidebar não montou").toBeTruthy();
  return aside!;
}

describe("#1373 sidebar do Bridge é card arredondado", () => {
  beforeEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
  });

  it("tem canto arredondado — não é mais borderless", async () => {
    const aside = await montarSidebar();
    const raio = parseFloat(getComputedStyle(aside).borderTopLeftRadius);
    expect(raio, `border-radius ${raio}px — o card voltaria a ser reto`).toBeGreaterThan(4);
  });

  it("tem borda nos QUATRO lados, não só à direita", async () => {
    const aside = await montarSidebar();
    const e = getComputedStyle(aside);
    const lados = {
      topo: parseFloat(e.borderTopWidth),
      direita: parseFloat(e.borderRightWidth),
      baixo: parseFloat(e.borderBottomWidth),
      esquerda: parseFloat(e.borderLeftWidth),
    };
    // O borderless tinha SÓ `border-r`: esquerda/topo/baixo ficavam em 0.
    for (const [lado, largura] of Object.entries(lados)) {
      expect(largura, `sem borda à ${lado}`).toBeGreaterThan(0);
    }
  });

  it("o fundo é o TOKEN --card, não o chrome `muted` de antes", async () => {
    const aside = await montarSidebar();
    const fundo = getComputedStyle(aside).backgroundColor;
    expect(
      fundo,
      `fundo ${fundo} não é o --card (${corDoToken("--card")})`
    ).toBe(corDoToken("--card"));
    expect(fundo).not.toBe(corDoToken("--muted"));
  });

  it("no tema escuro o fundo segue o token — não é cor cravada", async () => {
    document.documentElement.classList.add("dark");
    const aside = await montarSidebar();
    const fundo = getComputedStyle(aside).backgroundColor;
    const card = corDoToken("--card");
    expect(fundo, `fundo ${fundo} ≠ --card ${card} no escuro`).toBe(card);
    document.documentElement.classList.remove("dark");
  });
});
