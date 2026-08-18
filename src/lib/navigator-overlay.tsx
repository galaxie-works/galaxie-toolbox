import { useCallback, useEffect, useRef } from "react";

import { useAppStore } from "@/store";
// A REGRA do #1179 é pura e mora no `-core.ts` (o `node --test` não carrega .tsx).
import { cruzaWebview } from "./navigator-overlay-core";

export { cruzaWebview };
export type { RetanguloWebview } from "./navigator-overlay-core";

/**
 * Z-order do WebView2 (#275, padrão do #174): a webview nativa pinta ACIMA do
 * DOM, então QUALQUER overlay DOM que caia sobre a área da webview (menu de
 * contexto de aba, dropdown da barra de favoritos, diálogos, submenu do "+") é
 * cortado por ela. A cura é esconder a webview enquanto o overlay estiver aberto
 * e revelá-la ao fechar.
 *
 * #1163 (D1+D2, desenho do Altair em
 * `docs/reference/default-silencioso-e-overlay-webview.md`): o registrador ERA um
 * `OcultarWebviewContext` com default no-op (`() => {}`). Três furos com o mesmo
 * sintoma: (1) o default aceitava a chamada e não fazia nada; (2) o mecanismo era
 * opt-in — só 4 chamadas contra ~100 overlays; (3) o Provider ficava abaixo do
 * header, então overlays da title bar caíam no no-op. Agora:
 *  - D1: a conta vive num slice do store (`overlaysWebview`/`registrarOverlayWebview`).
 *    Não há Provider do qual estar fora, nem no-op que finja sucesso.
 *  - D2: os PRIMITIVOS de overlay (dialog, alert-dialog, dropdown, popover,
 *    context-menu, select, sheet) se registram sozinhos via `useRegistroOverlayWebview`.
 *    Overlay novo na tela do navegador nasce coberto por construção, não por alguém
 *    lembrar de ligar. (`Tooltip` fica FORA por decisão escrita — D3: hover é alta
 *    frequência e ligaria a webview a cada passagem de mouse.)
 */

/** Devolve o registrador do store — a mesma função estável em todo lugar. */
export function useRegistrarOverlayWebview(): (aberto: boolean) => void {
  return useAppStore((s) => s.registrarOverlayWebview);
}

/**
 * Enquanto `aberto` for true, mantém a webview escondida. Seguro à desmontagem:
 * o cleanup libera o registro mesmo se o overlay sumir ainda aberto (ex.: fechar
 * a aba pelo próprio menu de contexto) — assim a conta nunca fica presa.
 *
 * Use quando o "aberto" é um estado do chamador que NÃO passa por um primitivo
 * ligado ao D2 (a maioria dos overlays não precisa mais disto — o primitivo já se
 * registra). Mantido para casos fora dos primitivos padrão.
 */
export function useOcultarWebviewEnquantoAberto(aberto: boolean): void {
  const registrar = useRegistrarOverlayWebview();
  useEffect(() => {
    if (!aberto) return;
    registrar(true);
    return () => registrar(false);
  }, [aberto, registrar]);
}

/**
 * D2: hook que um PRIMITIVO de overlay usa para se auto-registrar. Devolve o
 * `onOpenChange` a repassar ao Root do primitivo (encadeando o do chamador).
 * Cobre os três modos de abertura sem que o chamador precise fazer nada:
 *  - CONTROLADO (`open` definido) — inclusive abertura PROGRAMÁTICA, que o Radix
 *    NÃO sinaliza por `onOpenChange` (ele só dispara em interação do usuário): um
 *    efeito sincroniza o store ao `open`.
 *  - NÃO-CONTROLADO (`open` undefined, aberto pelo trigger do Radix): pelo próprio
 *    `onOpenChange`.
 *  - DESMONTE com o overlay aberto: o cleanup libera o registro — auto-cura, é o
 *    que evita a webview presa escondida (tela preta) quando um dono some com o
 *    overlay aberto (regressão do #275).
 *
 * `defaultOpen` sem interação não é coberto (não há sinal de mount no Radix), mas
 * nenhum overlay da tela do navegador abre assim — todos são trigger ou controlados.
 */
export function useRegistroOverlayWebview(
  open: boolean | undefined,
  onOpenChange?: (aberto: boolean) => void,
): (aberto: boolean) => void {
  const registrar = useRegistrarOverlayWebview();
  const abertoRef = useRef(false);

  // Aplica uma transição real (guarda contra dobra: só conta na borda).
  const aplicar = useCallback(
    (proximo: boolean) => {
      if (proximo === abertoRef.current) return;
      abertoRef.current = proximo;
      registrar(proximo);
    },
    [registrar],
  );

  const controlado = open !== undefined;

  // Caminho controlado: o `open` é a verdade — pega a abertura programática que o
  // Radix não anuncia. (Roda também no não-controlado, mas aí é no-op: sai cedo.)
  useEffect(() => {
    if (!controlado) return;
    aplicar(!!open);
  }, [controlado, open, aplicar]);

  // Desmonte com aberto → libera. Nunca deixa a webview presa escondida.
  useEffect(() => () => aplicar(false), [aplicar]);

  return useCallback(
    (aberto: boolean) => {
      // Não-controlado: o Radix é a única fonte do estado.
      if (!controlado) aplicar(aberto);
      onOpenChange?.(aberto);
    },
    [controlado, aplicar, onOpenChange],
  );
}

/**
 * #1179: registro do TOOLTIP — devolve um ref callback pro elemento de conteúdo.
 *
 * Por que aqui e não no D2: o D2 registra pelo ESTADO (`open`), e pro tooltip isso
 * seria cedo demais — não se sabe onde a caixa vai parar antes de ela existir. Aqui
 * o registro é decidido pela GEOMETRIA REAL, depois que o Radix posicionou.
 *
 * **Por que não gera jank** (o AC do card):
 *  - só roda quando um tooltip REALMENTE abre — o `onOpenChange` do Radix já vem
 *    depois do `delayDuration` de hover; passar o mouse não executa nada;
 *  - é UM `getBoundingClientRect` por abertura, não por movimento de mouse;
 *  - hover que NÃO cruza não toca a webview: `cruzaWebview` devolve false e nenhum
 *    registro acontece — nada de esconder/revelar, nada de cintilação;
 *  - fora do Navigator (`webviewRect === null`) o custo é uma comparação com null.
 *
 * A medição é adiada um frame (`requestAnimationFrame`): o Radix posiciona o
 * conteúdo DEPOIS de montar, e medir antes disso leria a caixa na origem. A
 * animação de entrada do tooltip (fade/zoom) cobre esse frame.
 */
export function useRegistroTooltipWebview(): (el: HTMLElement | null) => void {
  const registrar = useRegistrarOverlayWebview();
  const registradoRef = useRef(false);

  // Solta o registro se o tooltip sumir ainda "cruzando" (mesma auto-cura do D2:
  // conta presa esconderia a webview pra sempre).
  useEffect(
    () => () => {
      if (registradoRef.current) {
        registradoRef.current = false;
        registrar(false);
      }
    },
    [registrar],
  );

  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) {
        if (registradoRef.current) {
          registradoRef.current = false;
          registrar(false);
        }
        return;
      }
      requestAnimationFrame(() => {
        // O tooltip pode ter fechado dentro do frame.
        if (!el.isConnected || registradoRef.current) return;
        const b = el.getBoundingClientRect();
        const caixa = { x: b.x, y: b.y, w: b.width, h: b.height };
        if (!cruzaWebview(caixa, useAppStore.getState().webviewRect)) return;
        registradoRef.current = true;
        registrar(true);
      });
    },
    [registrar],
  );
}
