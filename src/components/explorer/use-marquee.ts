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
  // #680: id do ponteiro do gesto em curso — a captura é ADIADA pro 1º arrasto
  // real (não em todo pointerdown), pra um clique nunca prender os pointer-events.
  const pointerIdRef = useRef<number | null>(null);
  const capturadoRef = useRef(false);
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
    // #680: solta a captura (se foi pega no arrasto) — centralizado aqui pra o
    // pointerup do elemento E a rede de segurança de window liberarem igual.
    const el = scrollRef.current;
    if (el && capturadoRef.current && pointerIdRef.current != null) {
      try {
        el.releasePointerCapture(pointerIdRef.current);
      } catch {
        // já solto / sem suporte
      }
    }
    capturadoRef.current = false;
    pointerIdRef.current = null;
  }, [pararRaf, scrollRef]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const alvo = e.target as HTMLElement;
      // #865 (P1): o React propaga o pointerdown de itens PORTADOS (o item do
      // menu de contexto Radix vive no `body`) por ESTA árvore de componentes —
      // o handler dispara mesmo com o nó DOM FORA do scrollRef. O guard por
      // tag-name não pega `role=menuitem` (é div, não button), então o marquee
      // começava, capturava o ponteiro num drag >3px e roubava o clique do menu
      // (o #680 que o audit pegou de volta). Só inicia se o alvo REAL do DOM está
      // DENTRO do container — item portado no body nunca passa.
      if (!scrollRef.current?.contains(alvo)) return;
      // Só inicia no VAZIO: sobre item/input/menu dentro da lista, deixa o gesto
      // normal (clique, e — futuro — o drag-para-mover) rolar. Anti-conflito.
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
      pointerIdRef.current = e.pointerId;
      capturadoRef.current = false;
      el.focus({ preventScroll: true });
      // #680: NÃO captura o ponteiro aqui. Capturar em todo pointerdown deixava
      // o `scrollRef` com pointer-capture ativo e, com o menu de contexto Radix
      // aberto (portado no body), os pointer-events do item do menu eram
      // redirecionados pro container → o `onSelect` nunca disparava e o menu não
      // fechava (a regressão do #680). A captura é adiada pro 1º arrasto REAL
      // (>3px) no `onPointerMove` — um clique simples nunca prende o ponteiro.
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
      // #680: captura o ponteiro só quando o arrasto REALMENTE começou (>3px) —
      // aí o marquee precisa dos eventos mesmo fora do container. Um clique (sem
      // arrasto) nunca chega aqui, então nunca prende os pointer-events (o que
      // matava o clique nos itens do menu de contexto).
      const el = scrollRef.current;
      if (el && movedRef.current && !capturadoRef.current) {
        capturadoRef.current = true;
        const pid = pointerIdRef.current;
        if (pid != null) {
          try {
            el.setPointerCapture(pid);
          } catch {
            // Sem pointer capture (ambiente sem suporte): o pointerup de window
            // (rede de segurança) ainda finaliza.
          }
        }
      }
      recomputar();
      talvezAutoscroll();
    },
    [recomputar, talvezAutoscroll, scrollRef],
  );

  const onPointerUp = useCallback(() => {
    if (!ativoRef.current) return;
    // #680: a liberação da captura (se houve arrasto) é centralizada no
    // `finalizar` — mesmo caminho pro pointerup do elemento e o de window.
    finalizar();
  }, [finalizar]);

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
