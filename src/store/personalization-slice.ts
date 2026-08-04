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
  /** #474: switcher liga/desliga o fundo animado em todas as superfícies. */
  fundosAnimadosAtivo: boolean;
  /** #474: qual fundo animado (Animate UI) é pintado quando o switcher liga. */
  fundoAnimado: TipoFundoAnimado;
  /** Claro, escuro ou seguindo a preferência do sistema operacional. */
  modoTema: ModoTema;
  /** Paleta/estilo visual independente do modo claro/escuro. */
  temaVisual: TemaVisual;
  /** Alto contraste (#136): sobrepõe o Mood com o preset `high-contrast`. */
  altoContraste: boolean;

  setSomNotificacao: (escopo: EscopoNotificacao, somId: string) => void;
  setFundosAnimadosAtivo: (ativo: boolean) => void;
  setFundoAnimado: (tipo: TipoFundoAnimado) => void;
  setModoTema: (modo: ModoTema) => void;
  setTemaVisual: (tema: TemaVisual) => void;
  setAltoContraste: (ativo: boolean) => void;
}

export const PERSONALIZATION_KEYS = {
  notificacoes: CHAVE_NOTIFICACOES,
  fundosAnimadosAtivo: "galaxie-toolbox.background.stars",
  fundoAnimado: "galaxie-toolbox.background.animated",
  modoTema: CHAVE_MODO_TEMA,
  temaVisual: CHAVE_TEMA_VISUAL,
  altoContraste: CHAVE_ALTO_CONTRASTE,
} as const;

export type PersonalizationPersistido = Pick<
  PersonalizationSlice,
  | "notificacoes"
  | "fundosAnimadosAtivo"
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
  fundosAnimadosAtivo: true,
  fundoAnimado: "starry",
  modoTema: modoTemaSalvo(),
  temaVisual: temaVisualSalvo(),
  altoContraste: altoContrasteSalvo(),

  setSomNotificacao: (escopo, somId) =>
    set((state) => ({
      notificacoes: { ...state.notificacoes, [escopo]: somId },
    })),
  setFundosAnimadosAtivo: (ativo) => set({ fundosAnimadosAtivo: ativo }),
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
