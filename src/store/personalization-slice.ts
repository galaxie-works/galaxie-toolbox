import type { StateCreator } from "zustand";

import {
  CHAVE_NOTIFICACOES,
  PREF_PADRAO,
  type EscopoNotificacao,
  type PreferenciasNotificacao,
} from "@/lib/sons-notificacao";
import {
  aplicarAltoContraste,
  aplicarModoTema,
  aplicarTemaVisual,
  altoContrasteSalvo,
  CHAVE_ALTO_CONTRASTE,
  CHAVE_MODO_TEMA,
  CHAVE_TEMA_VISUAL,
  modoTemaSalvo,
  temaVisualSalvo,
  type ModoTema,
  type TemaVisual,
} from "@/lib/tema";
import type { AppStore } from "./index";

/**
 * #474: fundos animados disponíveis. Cada valor mapeia 1:1 pra um componente do
 * registry Animate UI (ver `fundo-animado.tsx`). A ordem é a do preview no
 * Settings; serve também de allowlist na hidratação (`lerTexto`).
 */
export const TIPOS_FUNDO_ANIMADO = [
  // #474 (rework 2): "none" = sem fundo animado. É a 1ª opção do seletor e o
  // jeito de DESLIGAR o fundo (não há mais switch on/off).
  "none",
  "starry",
  "supernova",
  "spacehive",
  "gravity",
] as const;

export type TipoFundoAnimado = (typeof TIPOS_FUNDO_ANIMADO)[number];

/**
 * Preferências da área Personalization da Settings (#119–#122).
 *
 * A #119 inaugura o slice com sons e fundo estrelado. As chaves reais são
 * gravadas pelo storage custom do store único, sem criar blob paralelo.
 */
export interface PersonalizationSlice {
  /** Sons por evento. Preserva `bridge.notificacoes` e o contrato do #48. */
  notificacoes: PreferenciasNotificacao;
  /** #474: qual fundo animado (Animate UI) é pintado. `"none"` = nenhum
   *  (desligado — não há mais switch, a opção "Nenhum" do seletor desliga). */
  fundoAnimado: TipoFundoAnimado;
  /** Claro, escuro ou seguindo a preferência do sistema operacional. */
  modoTema: ModoTema;
  /** Paleta/estilo visual independente do modo claro/escuro. */
  temaVisual: TemaVisual;
  /** Alto contraste (#136): sobrepõe o Mood com o preset `high-contrast`. */
  altoContraste: boolean;

  setSomNotificacao: (escopo: EscopoNotificacao, somId: string) => void;
  setFundoAnimado: (tipo: TipoFundoAnimado) => void;
  setModoTema: (modo: ModoTema) => void;
  setTemaVisual: (tema: TemaVisual) => void;
  setAltoContraste: (ativo: boolean) => void;
}

export const PERSONALIZATION_KEYS = {
  notificacoes: CHAVE_NOTIFICACOES,
  fundoAnimado: "galaxie-toolbox.background.animated",
  modoTema: CHAVE_MODO_TEMA,
  temaVisual: CHAVE_TEMA_VISUAL,
  altoContraste: CHAVE_ALTO_CONTRASTE,
} as const;

export type PersonalizationPersistido = Pick<
  PersonalizationSlice,
  | "notificacoes"
  | "fundoAnimado"
  | "modoTema"
  | "temaVisual"
  | "altoContraste"
>;

export const createPersonalizationSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  PersonalizationSlice
> = (set, get) => ({
  notificacoes: { ...PREF_PADRAO },
  fundoAnimado: "starry",
  modoTema: modoTemaSalvo(),
  temaVisual: temaVisualSalvo(),
  altoContraste: altoContrasteSalvo(),

  setSomNotificacao: (escopo, somId) =>
    set((state) => ({
      notificacoes: { ...state.notificacoes, [escopo]: somId },
    })),
  setFundoAnimado: (tipo) => set({ fundoAnimado: tipo }),
  setModoTema: (modo) => {
    aplicarModoTema(modo);
    set({ modoTema: modo });
  },
  setTemaVisual: (tema) => {
    aplicarTemaVisual(tema);
    set({ temaVisual: tema });
  },
  setAltoContraste: (ativo) => {
    // Ligado sobrepõe o Mood; desligado volta ao Mood atual.
    aplicarAltoContraste(ativo, get().temaVisual);
    set({ altoContraste: ativo });
  },
});
