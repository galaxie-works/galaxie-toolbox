// #1179 — o TOOLTIP entra no mecanismo do #1163 pela GEOMETRIA, não por lista.
// A regra pura tem gate próprio (`lib/cruza-webview.test.ts`); aqui provamos a
// FIAÇÃO: um tooltip aberto mede a própria caixa e só cede a webview se cruzar.
//   • cruza  → conta de overlays sobe (a webview esconde, o tooltip aparece inteiro)
//   • não cruza → conta FICA EM 0 (nada de esconder/revelar = sem cintilação, D3)
//   • fora do Navigator (`webviewRect: null`) → nunca aciona
//   • desmonte com o tooltip aberto → libera a conta (anti-tela-preta)
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore } from "@/store";

const WEBVIEW = { x: 0, y: 48, w: 1000, h: 700 };

function conta() {
  return useAppStore.getState().overlaysWebview;
}

/** happy-dom devolve rect zerado: forjamos a caixa que o Radix teria posicionado. */
function fixarCaixaDoTooltip(caixa: DOMRect | { x: number; y: number; w: number; h: number }) {
  const c = caixa as { x: number; y: number; w: number; h: number };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: c.x,
    y: c.y,
    width: c.w,
    height: c.h,
    top: c.y,
    left: c.x,
    right: c.x + c.w,
    bottom: c.y + c.h,
    toJSON: () => ({}),
  } as DOMRect);
}

/** O ref callback mede dentro de um rAF — roda os frames pendentes. */
async function passarUmFrame() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));
  });
}

function montar() {
  return render(
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger>alvo</TooltipTrigger>
        <TooltipContent>dica</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useAppStore.setState({ overlaysWebview: 0, webviewRect: WEBVIEW });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#1179 tooltip cede a webview só quando cruza", () => {
  it("tooltip que CRUZA a webview registra (a webview esconde)", async () => {
    fixarCaixaDoTooltip({ x: 120, y: 60, w: 160, h: 28 }); // dentro da webview
    montar();
    await passarUmFrame();
    expect(screen.getAllByText("dica").length).toBeGreaterThan(0);
    expect(conta()).toBe(1);
  });

  it("tooltip que NÃO cruza (title bar) não registra — sem cintilação", async () => {
    fixarCaixaDoTooltip({ x: 120, y: 8, w: 160, h: 28 }); // acima de y=48
    montar();
    await passarUmFrame();
    expect(conta()).toBe(0);
  });

  it("fora do Navigator (webviewRect null) nunca aciona", async () => {
    useAppStore.setState({ webviewRect: null });
    fixarCaixaDoTooltip({ x: 120, y: 300, w: 160, h: 28 });
    montar();
    await passarUmFrame();
    expect(conta()).toBe(0);
  });

  it("desmonte com o tooltip aberto libera a conta (anti-tela-preta)", async () => {
    fixarCaixaDoTooltip({ x: 120, y: 60, w: 160, h: 28 });
    const { unmount } = montar();
    await passarUmFrame();
    expect(conta()).toBe(1);
    unmount();
    expect(conta()).toBe(0);
  });
});
