import type { StateCreator } from "zustand";

import type { OrdenarMensagens } from "@/lib/api";
import type { Filter } from "@/components/reui/filters";
import type { AppStore } from "./index";
import { resolver, type Updater } from "./updater";

/**
 * Slice da lista de mensagens — preferências de VIEW (épico #125):
 * ordenação (campo + direção → $orderby, #32) e filtros multi-condição (#31).
 */
export interface ListSlice {
  /** Campo de ordenação. Persistido em `bridge.ordenar`. */
  ordenar: OrdenarMensagens;
  /** Direção descendente. Persistido em `bridge.ordemDesc`. */
  ordemDesc: boolean;
  /** Filtros do builder (#31), multi-condição (AND). Persistido em `bridge.filtrosLista.v2`. */
  filtros: Filter<string>[];

  setOrdenar: (v: Updater<OrdenarMensagens>) => void;
  setOrdemDesc: (v: Updater<boolean>) => void;
  setFiltros: (v: Updater<Filter<string>[]>) => void;
}

/** Chaves legadas preservadas 1:1 do `usePersistedState`. */
export const LIST_KEYS = {
  ordenar: "bridge.ordenar",
  ordemDesc: "bridge.ordemDesc",
  filtros: "bridge.filtrosLista.v2",
} as const;

export type ListPersistido = Pick<ListSlice, "ordenar" | "ordemDesc" | "filtros">;

export const createListSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  ListSlice
> = (set) => ({
  ordenar: "data",
  ordemDesc: true,
  filtros: [],

  setOrdenar: (v) => set((s) => ({ ordenar: resolver(s.ordenar, v) })),
  setOrdemDesc: (v) => set((s) => ({ ordemDesc: resolver(s.ordemDesc, v) })),
  setFiltros: (v) => set((s) => ({ filtros: resolver(s.filtros, v) })),
});
