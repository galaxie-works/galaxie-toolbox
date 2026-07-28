import type { StateCreator } from "zustand";

import {
  CHAVE_NOTIFICACOES,
  PREF_PADRAO,
  type EscopoNotificacao,
  type PreferenciasNotificacao,
} from "@/lib/sons-notificacao";
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

  setSomNotificacao: (escopo: EscopoNotificacao, somId: string) => void;
  setFundoEstrelado: (ativo: boolean) => void;
}

export const PERSONALIZATION_KEYS = {
  notificacoes: CHAVE_NOTIFICACOES,
  fundoEstrelado: "galaxie-toolbox.background.stars",
} as const;

export type PersonalizationPersistido = Pick<
  PersonalizationSlice,
  "notificacoes" | "fundoEstrelado"
>;

export const createPersonalizationSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  PersonalizationSlice
> = (set) => ({
  notificacoes: { ...PREF_PADRAO },
  fundoEstrelado: true,

  setSomNotificacao: (escopo, somId) =>
    set((state) => ({
      notificacoes: { ...state.notificacoes, [escopo]: somId },
    })),
  setFundoEstrelado: (ativo) => set({ fundoEstrelado: ativo }),
});
