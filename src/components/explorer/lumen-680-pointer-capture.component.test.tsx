// #680 (P0) — invariante de pointer-capture do marquee. Regrediu 4x:
//   #778 → #748 (marquee capturava em todo pointerdown) → #846 (adiou p/ >3px)
//   → #865 (o guard por tag-name não pegava `role=menuitem` PORTADO no body).
// Dois invariantes travados aqui (se qualquer um voltar, quebra):
//   A) captura só no arrasto REAL (>3px), nunca num clique — senão rouba o clique
//      do menu de contexto (o #846).
//   B) o marquee só inicia se o alvo DOM real está DENTRO do scrollRef — item
//      portado no body (menu Radix) nunca inicia/captura (o #865, `contains`).
// (Não é o repro do menu real — isso é browser-mode; é o invariante do hook.)
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type RefObject } from "react";

import { useMarqueeSelecao } from "./use-marquee.ts";
import { type GridMetrica } from "./marquee.ts";

const METRICA: GridMetrica = {
  cols: 1, alturaLinha: 32, largura: 400, alturaTotal: 320,
  count: 10, gap: 0, padX: 0, modoGrade: false,
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

function ptr(target: EventTarget, over: Record<string, unknown> = {}) {
  return {
    button: 0, pointerId: 7, clientX: 100, clientY: 100,
    ctrlKey: false, metaKey: false, shiftKey: false,
    target,
    ...over,
  } as never;
}

function montar() {
  const el = mockScroll();
  // #865: alvo VAZIO mas DENTRO do container (contains → true) pros casos de marquee.
  const alvoDentro = document.createElement("span");
  el.appendChild(alvoDentro);
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
  return { el, result, alvoDentro };
}

describe("#680/#865 pointer-capture do marquee", () => {
  it("A: clique (pointerdown no vazio, sem arrasto) NÃO captura o ponteiro", () => {
    const { el, result, alvoDentro } = montar();
    act(() => result.current.onPointerDown(ptr(alvoDentro)));
    expect(el.setPointerCapture).not.toHaveBeenCalled();
  });

  it("A: movimento < 3px ainda NÃO captura", () => {
    const { el, result, alvoDentro } = montar();
    act(() => result.current.onPointerDown(ptr(alvoDentro)));
    act(() => result.current.onPointerMove(ptr(alvoDentro, { clientX: 102, clientY: 101 })));
    expect(el.setPointerCapture).not.toHaveBeenCalled();
  });

  it("A: arrasto REAL (> 3px) captura o ponteiro exatamente uma vez", () => {
    const { el, result, alvoDentro } = montar();
    act(() => result.current.onPointerDown(ptr(alvoDentro)));
    act(() => result.current.onPointerMove(ptr(alvoDentro, { clientX: 120, clientY: 120 })));
    expect(el.setPointerCapture).toHaveBeenCalledTimes(1);
    expect(el.setPointerCapture).toHaveBeenCalledWith(7);
  });

  it("B (#865): alvo PORTADO fora do scrollRef (role=menuitem no body) NÃO inicia o marquee nem captura, mesmo com arrasto >3px", () => {
    const { el, result } = montar();
    // Item do menu de contexto Radix: vive no body, FORA do scrollRef.
    const portado = document.createElement("div");
    portado.setAttribute("role", "menuitem");
    document.body.appendChild(portado);
    act(() => result.current.onPointerDown(ptr(portado)));
    act(() => result.current.onPointerMove(ptr(portado, { clientX: 140, clientY: 140 })));
    // Sem o guard `contains`, o marquee iniciaria e capturaria — roubando o clique.
    expect(el.setPointerCapture).not.toHaveBeenCalled();
    document.body.removeChild(portado);
  });
});
