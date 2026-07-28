import type { StateCreator } from "zustand";

import type { OrdenarMensagens } from "@/lib/api";
import type { AppStore } from "./index";
import { resolver, type Updater } from "./updater";

/**
 * Slice da lista de mensagens — preferências de VIEW (épico #125).
 * Hoje: ordenação (campo + direção → $orderby no Graph, #32). Os filtros (#31)
 * entram aqui num próximo passe.
 */
export interface ListSlice {
  /** Campo de ordenação. Persistido em `bridge.ordenar`. */
  ordenar: OrdenarMensagens;
  /** Direção descendente. Persistido em `bridge.ordemDesc`. */
  ordemDesc: boolean;

  setOrdenar: (v: Updater<OrdenarMensagens>) => void;
  setOrdemDesc: (v: Updater<boolean>) => void;
}

/** Chaves legadas preservadas 1:1 do `usePersistedState`. */
export const LIST_KEYS = {
  ordenar: "bridge.ordenar",
  ordemDesc: "bridge.ordemDesc",
} as const;

export type ListPersistido = Pick<ListSlice, "ordenar" | "ordemDesc">;

export const createListSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  ListSlice
> = (set) => ({
  ordenar: "data",
  ordemDesc: true,

  setOrdenar: (v) => set((s) => ({ ordenar: resolver(s.ordenar, v) })),
  setOrdemDesc: (v) => set((s) => ({ ordemDesc: resolver(s.ordemDesc, v) })),
});
