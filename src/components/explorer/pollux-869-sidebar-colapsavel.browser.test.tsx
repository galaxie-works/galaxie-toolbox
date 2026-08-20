// #869 (adendo de layout do Wagner) — o painel da árvore colapsa pra um rail?
//
// Guarda por EFEITO, não por className: mede a LARGURA do painel antes e depois
// de colapsar, e confirma que o rail mostra tooltip com o nome em cada item.
// Precisa de navegador real — largura de painel e tooltip por `pointerover` não
// existem em happy-dom.
//
// Monta o `ExplorerShell` de verdade: o `api.ts` já tem caminho mock fora do
// Tauri (`if (!inTauri())`), então não preciso simular o backend e o teste
// exercita a fiação real do `react-resizable-panels`.
import "@/index.css";
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { TooltipProvider } from "@/components/ui/tooltip";
import { IdiomaProvider } from "@/lib/idioma";
import { ExplorerShell } from "./explorer-shell";

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

function botaoColapso(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[aria-expanded]');
}

describe("#869 sidebar do Files colapsável", () => {
  beforeEach(() => {
    // #1019 (flake que a CI pegou e a minha máquina não): sem `cleanup()`, a
    // árvore do teste anterior fica montada E o tooltip que ela abriu continua
    // no DOM — então a asserção "nenhum tooltip aberto ainda" via o tooltip
    // VELHO. Passava local por timing e falhava na CI.
    cleanup();
    // O layout é persistido pelo `autoSaveId` (#819) — sem limpar, o estado de
    // um teste vazaria pro outro e eu estaria medindo a sessão anterior.
    localStorage.clear();
  });

  it("colapsar ESTREITA o painel de verdade e troca a árvore pelo rail", async () => {
    render(
      <IdiomaProvider>
        <TooltipProvider>
          <div style={{ width: 1000, height: 600 }}>
            <ExplorerShell />
          </div>
        </TooltipProvider>
      </IdiomaProvider>
    );

    const painel = (await ate(painelArvore))!;
    expect(painel, "o painel da árvore não montou").toBeTruthy();
    const botao = (await ate(botaoColapso))!;
    expect(botao, "não achei o botão de colapso").toBeTruthy();

    const larguraAberta = painel.getBoundingClientRect().width;
    expect(larguraAberta, "painel aberto estreito demais").toBeGreaterThan(120);

    await userEvent.click(botao);

    // O efeito que importa: o painel encolheu. Não basta trocar de componente.
    const encolheu = await ate(() =>
      painelArvore()!.getBoundingClientRect().width < larguraAberta / 2
        ? painelArvore()
        : null
    );
    expect(
      encolheu,
      `painel seguiu com ${painelArvore()?.getBoundingClientRect().width}px (aberto: ${larguraAberta}px)`
    ).toBeTruthy();

    // E o botão vira "expandir" — mesmo controle, estado invertido.
    expect(botaoColapso()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("colapsado, cada item do rail mostra tooltip com o próprio nome", async () => {
    render(
      <IdiomaProvider>
        <TooltipProvider>
          <div style={{ width: 1000, height: 600 }}>
            <ExplorerShell />
          </div>
        </TooltipProvider>
      </IdiomaProvider>
    );

    await ate(painelArvore);
    const botao = (await ate(botaoColapso))!;
    await userEvent.click(botao);

    // Um item do rail = botão com aria-label DENTRO do painel da árvore, que não
    // seja o próprio botão de colapso (esse tem `aria-expanded`).
    const itemRail = (await ate(() => {
      const alvos = painelArvore()?.querySelectorAll<HTMLButtonElement>(
        "button[aria-label]:not([aria-expanded])"
      );
      return alvos && alvos.length > 0 ? alvos[0] : null;
    }))!;
    expect(itemRail, "o rail não renderizou nenhum destino").toBeTruthy();

    const nome = itemRail.getAttribute("aria-label")!;
    expect(nome.length, "item do rail sem nome").toBeGreaterThan(0);
    // Espera a ausência em vez de exigi-la no instante: tooltip FECHA de forma
    // assíncrona, então "não há nenhum agora" é uma pergunta com timing.
    const semTooltip = await ate(
      () => (document.querySelector('[data-slot="tooltip-content"]') ? null : document.body),
      2000,
    );
    expect(semTooltip, "havia tooltip aberto antes do hover").toBeTruthy();

    await userEvent.hover(itemRail);

    const caixa = (await ate(() =>
      document.querySelector('[data-slot="tooltip-content"]')
    )) as HTMLElement | null;
    expect(caixa, "hover no item do rail não abriu tooltip").toBeTruthy();
    expect(caixa!.textContent?.trim()).toBe(nome);
  });
});
