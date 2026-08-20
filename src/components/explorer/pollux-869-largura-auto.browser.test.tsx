// #869 (adendo de layout do Wagner, item 1) — a largura default do sidebar
// acompanha o caption mais largo, "sem cortar/truncar".
//
// Guarda por EFEITO: mede a largura que o painel REALMENTE assume e compara com
// a largura NATURAL do texto renderizado. A aritmética tem teste próprio e
// headless em `largura-sidebar.test.ts`.
//
// Navegador real: largura de painel e largura natural de texto não existem em
// happy-dom.
//
// Duas coisas que descobri medindo, e que estão aqui pra não se perderem:
//
//  • **A primeira versão desta guarda passava com a implementação errada.** Eu
//    media o `scrollWidth` do conteúdo, mas ele carrega `min-w-full` — e
//    min-width ganha de `width: max-content`. O painel media a si mesmo e
//    concluía que já cabia. Por isso a asserção agora amarra o painel à largura
//    do TEXTO, não a "cresceu em relação ao default".
//
//  • **29,33% é o default INTOCADO** deste grupo: os `defaultSize` do `tree` e
//    do `content` (22 e 53) não somam 100 — o inspector pode não estar montado —
//    e o react-resizable-panels normaliza (22/75). Comparar com "22%" seria
//    comparar com um número que nunca existiu na tela.
import "@/index.css";
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { IdiomaProvider } from "@/lib/idioma";
import { ExplorerShell } from "./explorer-shell";
import { chaveLayout } from "./largura-sidebar";

const AUTO_SAVE = "explorer.layout.v1";
const DEFAULT_NORMALIZADO_PCT = 29.33;
/** Mesma folga que o shell usa: padding do `aside` + respiro do scroll + borda. */
const FOLGA_PX = 34;

async function ate<T extends Element>(busca: () => T | null, ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const el = busca();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

function painelArvore(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-panel][data-panel-id="tree"]');
}

/** Elementos do painel com texto cortado (conteúdo mais largo que a caixa). */
function cortados(): { total: number; pior: string } {
  const painel = painelArvore();
  if (!painel) return { total: 0, pior: "" };
  let total = 0;
  let pior = "";
  let piorSobra = 0;
  for (const el of painel.querySelectorAll<HTMLElement>("*")) {
    const sobra = el.scrollWidth - el.clientWidth;
    // 1px de folga: arredondamento de layout não é truncamento.
    if (sobra > 1) {
      total += 1;
      if (sobra > piorSobra) {
        piorSobra = sobra;
        pior = `${el.tagName} sobra ${sobra}px`;
      }
    }
  }
  return { total, pior };
}

/**
 * Largura natural do conteúdo da árvore: solta `min-width` E `width` (min-width
 * ganha de width — foi o que me enganou), lê, e devolve como estava.
 */
function larguraNaturalDoConteudo(painel: HTMLElement): number {
  const conteudo = painel.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"] > div',
  );
  if (!conteudo) return 0;
  const w = conteudo.style.width;
  const mw = conteudo.style.minWidth;
  conteudo.style.minWidth = "0";
  conteudo.style.width = "max-content";
  const natural = conteudo.scrollWidth;
  conteudo.style.width = w;
  conteudo.style.minWidth = mw;
  return natural;
}

async function montar(larguraGrupoPx: number) {
  render(
    <IdiomaProvider>
      <TooltipProvider>
        <div style={{ width: larguraGrupoPx, height: 600 }}>
          <ExplorerShell />
        </div>
      </TooltipProvider>
    </IdiomaProvider>
  );
  const painel = await ate(painelArvore);
  expect(painel, "o painel da árvore não montou").toBeTruthy();
  // A árvore chega por promessa (drives); o efeito de largura roda depois dela.
  await ate(() => painel!.querySelector("button, a, [data-slot]"));
  await new Promise((r) => setTimeout(r, 400));
  return painel!;
}

const px = (el: HTMLElement) => el.getBoundingClientRect().width;

function pct(painel: HTMLElement): number {
  const grupo = painel.closest<HTMLElement>("[data-panel-group]")!;
  return (px(painel) / px(grupo)) * 100;
}

describe("#869 largura default do sidebar", () => {
  beforeEach(() => {
    // Sem isto o shell do teste anterior fica no DOM e o `querySelector`
    // devolve o painel VELHO. (E `cleanup()` no MEIO de um teste quebra o
    // React — act sobreposto —, então ele só mora aqui.)
    cleanup();
    localStorage.clear();
  });

  it("o painel fica do tamanho do TEXTO, não do default do grupo", async () => {
    const painel = await montar(1000);
    const natural = larguraNaturalDoConteudo(painel);
    expect(natural, "não consegui medir a largura natural do conteúdo").toBeGreaterThan(0);

    const esperado = natural + FOLGA_PX;
    const real = px(painel);
    // Sem a largura-auto o painel ficaria no default normalizado (~293px num
    // grupo de 1000), que é bem diferente de "o texto + a folga".
    expect(
      Math.abs(real - esperado),
      `painel com ${real.toFixed(1)}px para um conteúdo de ${natural}px (+${FOLGA_PX} de folga = ${esperado}px)`
    ).toBeLessThanOrEqual(6);
  });

  it("nenhum caption da árvore fica cortado", async () => {
    await montar(1000);
    const { total, pior } = cortados();
    expect(total, `sobrou texto cortado no sidebar — ${pior}`).toBe(0);
  });

  it("com layout salvo, o painel NÃO é redimensionado por mim", async () => {
    // Basta a chave existir: a regra é de presença ("já arrastou alguma vez"),
    // não de conteúdo — quem interpreta o layout é a própria biblioteca.
    localStorage.setItem(chaveLayout(AUTO_SAVE), "{}");
    const painel = await montar(600);
    expect(
      Math.round(pct(painel)),
      `painel foi para ${pct(painel).toFixed(1)}% apesar de haver layout salvo`
    ).toBe(Math.round(DEFAULT_NORMALIZADO_PCT));
  });
});
