import type { StateCreator } from "zustand";

import {
  CHAVE_NOTIFICACOES,
  PREF_PADRAO,
  type EscopoNotificacao,
  type PreferenciasNotificacao,
} from "@/lib/sons-notificacao";
import {
  aplicarModoTema,
  aplicarTemaVisual,
  CHAVE_MODO_TEMA,
  CHAVE_TEMA_VISUAL,
  modoTemaSalvo,
  temaVisualSalvo,
  type ModoTema,
  type TemaVisual,
} from "@/lib/tema";
import type { AppStore } from "./index";

/**
 * Preferências da área Personalization da Settings (#119–#122).
 *
 * A #119 inaugura o slice com sons e fundo estrelado. As chaves reais são
 * gravadas pelo storage custom do store único, sem criar blob paralelo.
 */
export interface PersonalizationSlice {
  /** Sons por evento. Preserva `bridge.notificacoes` e o contrato do #48. */
  notificacoes: PreferenciasNotificacao;
  /** Exibe o fundo estrelado em todas as superfícies do app. */
  fundoEstrelado: boolean;
  /** Claro, escuro ou seguindo a preferência do sistema operacional. */
  modoTema: ModoTema;
  /** Paleta/estilo visual independente do modo claro/escuro. */
  temaVisual: TemaVisual;

  setSomNotificacao: (escopo: EscopoNotificacao, somId: string) => void;
  setFundoEstrelado: (ativo: boolean) => void;
  setModoTema: (modo: ModoTema) => void;
  setTemaVisual: (tema: TemaVisual) => void;
}

export const PERSONALIZATION_KEYS = {
  notificacoes: CHAVE_NOTIFICACOES,
  fundoEstrelado: "galaxie-toolbox.background.stars",
  modoTema: CHAVE_MODO_TEMA,
  temaVisual: CHAVE_TEMA_VISUAL,
} as const;

export type PersonalizationPersistido = Pick<
  PersonalizationSlice,
  "notificacoes" | "fundoEstrelado" | "modoTema" | "temaVisual"
>;

export const createPersonalizationSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  PersonalizationSlice
> = (set) => ({
  notificacoes: { ...PREF_PADRAO },
  fundoEstrelado: true,
  modoTema: modoTemaSalvo(),
  temaVisual: temaVisualSalvo(),

  setSomNotificacao: (escopo, somId) =>
    set((state) => ({
      notificacoes: { ...state.notificacoes, [escopo]: somId },
    })),
  setFundoEstrelado: (ativo) => set({ fundoEstrelado: ativo }),
  setModoTema: (modo) => {
    aplicarModoTema(modo);
    set({ modoTema: modo });
  },
  setTemaVisual: (tema) => {
    aplicarTemaVisual(tema);
    set({ temaVisual: tema });
  },
});
