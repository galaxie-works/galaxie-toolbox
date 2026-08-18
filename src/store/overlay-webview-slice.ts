import type { StateCreator } from "zustand";

import type { AppStore } from "./index";

/**
 * Contador de overlays DOM abertos SOBRE a webview do Navigator — #1163 (D1 do
 * desenho do Altair em `docs/reference/default-silencioso-e-overlay-webview.md`).
 *
 * A webview nativa do WebView2 pinta ACIMA do DOM (#275/#174), então qualquer
 * overlay (menu, dropdown, diálogo, popover) que caia sobre ela é cortado. A cura
 * é esconder a webview enquanto houver overlay aberto. Isto ERA um `useState`
 * local do `NavegadorScreen` exposto por um `OcultarWebviewContext` — mas o
 * default do contexto era um no-op (`() => {}`) que ACEITAVA a chamada e não fazia
 * nada (Furo 1), e um consumidor fora do Provider (title bar, #876) caía nele
 * silenciosamente (Furo 3). O #1163 regrediu por isso.
 *
 * D1: o registrador vira slice do store. Não existe Provider do qual estar fora, e
 * a POSIÇÃO na árvore React deixa de ser condição de correção — qualquer overlay,
 * em qualquer lugar da árvore, registra na mesma junção (precedente: o #987 subiu
 * `ops` do explorer-shell pra um slice app-level pelo mesmo motivo).
 *
 * Estado de SESSÃO puro (uma conta de overlays abertos AGORA): fora do
 * `partialize` e fora do reset tenant-scoped (#555) — não é config nem por-conta.
 */
import type { RetanguloWebview } from "@/lib/navigator-overlay-core";

export interface OverlayWebviewSlice {
  /** Quantos overlays estão abertos sobre a webview. Enquanto > 0, ela fica escondida. */
  overlaysWebview: number;
  /**
   * #1179: a REGIÃO que a webview do Navigator ocupa, ou `null` quando não há
   * webview em jogo (outra tela, aba interna, sem aba). Publicada pelo
   * `NavegadorScreen`, que já mede essa área pra posicionar a webview nativa.
   *
   * Existe pra que a regra do tooltip (*a caixa cruza o retângulo da webview?*)
   * seja decidível de QUALQUER lugar da árvore — o `TooltipContent` é global e não
   * conhece o Navigator. `null` ⇒ nenhum tooltip aciona nada (custo zero fora do
   * Navigator). É a região que a webview OCUPA, não "está pintando agora": manter
   * estável enquanto escondida evita que um overlay já aberto mude de veredito no
   * meio da vida dele.
   */
  webviewRect: RetanguloWebview | null;
  /** Publica (ou limpa, com `null`) a região da webview. */
  definirWebviewRect: (rect: RetanguloWebview | null) => void;
  /**
   * Registra a abertura (`true`) ou o fechamento (`false`) de UM overlay. Clampa
   * em 0: um decremento órfão (ex.: cleanup dobrado) nunca deixa a conta negativa
   * — e negativa presa esconderia a webview pra sempre (tela preta).
   */
  registrarOverlayWebview: (aberto: boolean) => void;
}

export const createOverlayWebviewSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  OverlayWebviewSlice
> = (set) => ({
  overlaysWebview: 0,
  webviewRect: null,
  registrarOverlayWebview: (aberto) =>
    set((s) => ({
      overlaysWebview: Math.max(0, s.overlaysWebview + (aberto ? 1 : -1)),
    })),
  definirWebviewRect: (rect) =>
    set((s) => {
      // Igualdade estrutural: o ResizeObserver dispara em rajada e um `set` por
      // pixel idêntico re-renderizaria a árvore à toa.
      const a = s.webviewRect;
      if (a === rect) return {};
      if (
        a &&
        rect &&
        a.x === rect.x &&
        a.y === rect.y &&
        a.w === rect.w &&
        a.h === rect.h
      ) {
        return {};
      }
      return { webviewRect: rect };
    }),
});
