// #748: hook React do marquee — pointer capture, retângulo ao vivo, auto-scroll
// nas bordas (rAF), Ctrl/Shift-estende e ESC-cancela. A geometria pura vive em
// `marquee.ts` (testável no node --test); aqui é só o encanamento de DOM/estado.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import {
  indicesNoRetangulo,
  normalizarRetangulo,
  type GridMetrica,
  type RetanguloMarquee,
} from "./marquee";
import { selecionarRetangulo, type EstadoSelecao } from "./selecao";

/** Distância do topo/base do container onde o auto-scroll liga (px). */
const BORDA_AUTOSCROLL = 28;

/**
 * Controla o marquee sobre o container de scroll. Retorna os handlers de pointer
 * pra espalhar no elemento, o retângulo ao vivo (coords de conteúdo, pra desenhar
 * o overlay dentro da área virtualizada) e `arrastando` (pra desligar seleção de
 * texto). A verdade-de-layout (métrica/paths/seleção) é lida por ref pra o
 * handler nunca ficar stale sem recriar listeners.
 */
export function useMarqueeSelecao(params: {
  scrollRef: RefObject<HTMLDivElement | null>;
  metrica: GridMetrica;
  paths: string[];
  selecao: EstadoSelecao;
  setSelecao: (s: EstadoSelecao) => void;
}) {
  const { scrollRef } = params;
  const ref = useRef(params);
  ref.current = params;

  const [rect, setRect] = useState<RetanguloMarquee | null>(null);
  const ativoRef = useRef(false);
  const aditivoRef = useRef(false);
  const baseRef = useRef<EstadoSelecao>(params.selecao);
  const startRef = useRef({ x: 0, y: 0 }); // coords de conteúdo (fixas)
  const clientRef = useRef({ x: 0, y: 0 }); // último ponteiro (viewport)
  const clientStartRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const recomputar = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !ativoRef.current) return;
    const r = el.getBoundingClientRect();
    const { metrica, paths, setSelecao } = ref.current;
    const curX = Math.max(
      0,
      Math.min(metrica.largura, clientRef.current.x - r.left),
    );
    const curY = Math.max(
      0,
      Math.min(metrica.alturaTotal, clientRef.current.y - r.top + el.scrollTop),
    );
    const rectN = normalizarRetangulo(
      startRef.current.x,
      startRef.current.y,
      curX,
      curY,
    );
    setRect(rectN);
    const indices = indicesNoRetangulo(rectN, metrica);
    setSelecao(
      selecionarRetangulo(baseRef.current, paths, indices, {
        aditivo: aditivoRef.current,
      }),
    );
  }, [scrollRef]);

  const pararRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    rafRef.current = null;
    const el = scrollRef.current;
    if (!el || !ativoRef.current) return;
    const r = el.getBoundingClientRect();
    const y = clientRef.current.y;
    let dv = 0;
    if (y < r.top + BORDA_AUTOSCROLL) {
      dv = -Math.ceil((r.top + BORDA_AUTOSCROLL - y) / 2);
    } else if (y > r.bottom - BORDA_AUTOSCROLL) {
      dv = Math.ceil((y - (r.bottom - BORDA_AUTOSCROLL)) / 2);
    }
    if (dv === 0) return; // ponteiro saiu da borda: para o loop até voltar
    const antes = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + dv));
    if (el.scrollTop !== antes) recomputar();
    rafRef.current = requestAnimationFrame(tick);
  }, [scrollRef, recomputar]);

  const talvezAutoscroll = useCallback(() => {
    if (rafRef.current == null && ativoRef.current) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  const finalizar = useCallback(() => {
    ativoRef.current = false;
    pararRaf();
    setRect(null);
  }, [pararRaf]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const alvo = e.target as HTMLElement;
      // Só inicia no VAZIO: sobre item/input/menu, deixa o gesto normal (clique,
      // e — futuro — o drag-para-mover) rolar. Regra anti-conflito da issue.
      if (
        alvo.closest(
          "button, input, textarea, a, [contenteditable='true'], [data-sem-marquee]",
        )
      ) {
        return;
      }
      const el = scrollRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const { metrica, selecao } = ref.current;
      ativoRef.current = true;
      aditivoRef.current = e.ctrlKey || e.metaKey || e.shiftKey;
      baseRef.current = aditivoRef.current
        ? selecao
        : { selecionados: new Set(), ancora: null, cursor: null };
      startRef.current = {
        x: Math.max(0, Math.min(metrica.largura, e.clientX - r.left)),
        y: Math.max(
          0,
          Math.min(metrica.alturaTotal, e.clientY - r.top + el.scrollTop),
        ),
      };
      clientRef.current = { x: e.clientX, y: e.clientY };
      clientStartRef.current = { x: e.clientX, y: e.clientY };
      movedRef.current = false;
      el.focus({ preventScroll: true });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Sem pointer capture (ambiente sem suporte): degrada — o pointerup de
        // window (rede de segurança abaixo) ainda finaliza.
      }
    },
    [scrollRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!ativoRef.current) return;
      clientRef.current = { x: e.clientX, y: e.clientY };
      if (!movedRef.current) {
        const dx = e.clientX - clientStartRef.current.x;
        const dy = e.clientY - clientStartRef.current.y;
        if (dx * dx + dy * dy >= 9) movedRef.current = true; // > 3px = arrasto
      }
      recomputar();
      talvezAutoscroll();
    },
    [recomputar, talvezAutoscroll],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!ativoRef.current) return;
      try {
        scrollRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // ok
      }
      finalizar();
    },
    [scrollRef, finalizar],
  );

  // ESC cancela o arrasto e RESTAURA a seleção anterior (base). Só enquanto ativo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !ativoRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current.setSelecao(baseRef.current);
      finalizar();
    };
    // Rede de segurança: se o pointerup escapar da captura, encerra mesmo assim.
    const onUp = () => {
      if (ativoRef.current) finalizar();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerup", onUp);
    };
  }, [finalizar]);

  useEffect(() => pararRaf, [pararRaf]);

  return {
    rect,
    arrastando: rect !== null,
    /** True logo após um arrasto REAL (>3px) — pra suprimir o clique-limpa. */
    arrastouRef: movedRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
