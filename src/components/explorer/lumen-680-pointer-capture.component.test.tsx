// #680 (P0) — teste de COMPONENTE do invariante de pointer-capture do marquee.
//
// O bug que REGRIDIU 3x (#778 → #748 → #846): o `useMarqueeSelecao` capturava o
// ponteiro (`el.setPointerCapture`) em TODO `pointerdown` no scrollRef. Com o
// menu de contexto Radix aberto (portado no body), os pointer-events do item do
// menu eram redirecionados pro container capturante → o `onSelect` nunca
// disparava e o menu não fechava (o "menu morto").
//
// Fix (#846): NÃO captura no pointerdown; adia pro 1º arrasto REAL (>3px) no
// pointermove. Este teste trava a CAUSA: um clique (sem arrasto) NUNCA prende o
// ponteiro — se alguém voltar o `setPointerCapture` pro `onPointerDown`, quebra.
// (Não é o repro do menu real — isso é browser-mode; é o invariante do hook.)
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type RefObject } from "react";

import { useMarqueeSelecao } from "./use-marquee.ts";
import { type GridMetrica } from "./marquee.ts";

const METRICA: GridMetrica = {
  cols: 1,
  alturaLinha: 32,
  largura: 400,
  alturaTotal: 320,
  count: 10,
  gap: 0,
  padX: 0,
  modoGrade: false,
};
const PATHS = Array.from({ length: 10 }, (_, i) => `/f/${i}`);

function mockScroll() {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 400, bottom: 320, width: 400, height: 320, x: 0, y: 0, toJSON() {} }) as DOMRect;
  Object.defineProperty(el, "scrollHeight", { value: 320, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 320, configurable: true });
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  el.focus = vi.fn();
  return el;
}

function ptr(over: Record<string, unknown> = {}) {
  return {
    button: 0,
    pointerId: 7,
    clientX: 100,
    clientY: 100,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    // alvo no VAZIO (não button/input/menu) — senão o marquee nem inicia.
    target: document.createElement("span"),
    ...over,
  } as never;
}

function montar() {
  const el = mockScroll();
  const scrollRef = { current: el } as RefObject<HTMLDivElement>;
  const setSelecao = vi.fn();
  const { result } = renderHook(() =>
    useMarqueeSelecao({
      scrollRef,
      metrica: METRICA,
      paths: PATHS,
      selecao: { selecionados: new Set<string>(), ancora: null, cursor: null } as never,
      setSelecao,
    }),
  );
  return { el, result };
}

describe("#680 pointer-capture do marquee", () => {
  it("um CLIQUE (pointerdown no vazio, sem arrasto) NÃO captura o ponteiro", () => {
    const { el, result } = montar();
    act(() => result.current.onPointerDown(ptr()));
    // A regressão: capturar aqui roubava o clique do menu de contexto portado.
    expect(el.setPointerCapture).not.toHaveBeenCalled();
  });

  it("movimento < 3px ainda NÃO captura", () => {
    const { el, result } = montar();
    act(() => result.current.onPointerDown(ptr()));
    act(() => result.current.onPointerMove(ptr({ clientX: 102, clientY: 101 })));
    expect(el.setPointerCapture).not.toHaveBeenCalled();
  });

  it("arrasto REAL (> 3px) captura o ponteiro exatamente uma vez", () => {
    const { el, result } = montar();
    act(() => result.current.onPointerDown(ptr()));
    act(() => result.current.onPointerMove(ptr({ clientX: 120, clientY: 120 })));
    expect(el.setPointerCapture).toHaveBeenCalledTimes(1);
    expect(el.setPointerCapture).toHaveBeenCalledWith(7);
  });
});
