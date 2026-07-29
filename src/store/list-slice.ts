import type { StateCreator } from "zustand";

import type { AppStore } from "./index";
import { resolver, type Updater } from "./updater";

/**
 * Slice da lista de mensagens — preferências de apresentação (épico #125).
 * Filtros/busca/ordenação foram consolidados no `filters-slice` pela #129.
 */
export interface ListSlice {
  /** Agrupa mensagens por conversa (#29). Opt-in no primeiro ship. */
  agruparConversas: boolean;

  setAgruparConversas: (v: Updater<boolean>) => void;
}

/** Chaves legadas preservadas 1:1 do `usePersistedState`. */
export const LIST_KEYS = {
  agruparConversas: "bridge.conversationView",
} as const;

export type ListPersistido = Pick<ListSlice, "agruparConversas">;

export const createListSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  ListSlice
> = (set) => ({
  // Decisão final do PO na #133: threading ligado por padrão; o toggle permite
  // voltar literalmente ao flattening anterior quando o usuário preferir.
  agruparConversas: true,

  setAgruparConversas: (v) =>
    set((s) => ({ agruparConversas: resolver(s.agruparConversas, v) })),
});
