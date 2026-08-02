import type { StateCreator } from "zustand";

import type { AppStore } from "./index";
import { resolver, type Updater } from "./updater";

/**
 * Slice de UI / preferências do Bridge — épico #125.
 *
 * Guarda o estado que o usuário "deixa" no app (colapsos, zoom, sidebar,
 * marcar-lido). Tudo aqui é PERSISTIDO em localStorage pelo `persist` middleware
 * do store (ver `index.ts`) mantendo as MESMAS chaves que o antigo
 * `usePersistedState` usava — reabrir o app não reseta nada do usuário.
 */

/** Modo de "marcar como lido" (#95). */
export type MarcarLidoModo = "imediato" | "atraso" | "manual";
export type BridgeView = "mail" | "people" | "agenda";
export type PeopleTab =
  | "contacts"
  | "directory"
  | "organizations"
  | "groups"
  | "category"
  // #278 S4: visão derivada por domínio ("Other organizations"). Aba lógica sem
  // UI de aba, dirigida pelo sidebar (como "category" do S3a).
  | "domain";

export interface UiSlice {
  /** Zoom manual do leitor (#76). 1 = auto-fit puro. Persistido em `bridge.leitorZoom`. */
  zoom: number;
  /** Colapsos de grupos POR PASTA (#86). Persistido em `bridge.gruposColapsados.v2`. */
  gruposColapsados: Record<string, string[]>;
  /** Conversas expandidas POR PASTA (#29). Desconhecidas começam recolhidas. */
  threadsExpandidas: Record<string, string[]>;
  /** Sidebar de pastas aberta/fechada. Persistido em `bridge.sidebar`. */
  sidebarAberta: boolean;
  /** Quando marcar a mensagem como lida (#95). Persistido em `bridge.marcarLidoModo`. */
  marcarLidoModo: MarcarLidoModo;
  /** Atraso (s) do modo "atraso" (#95). Persistido em `bridge.marcarLidoAtraso`. */
  marcarLidoAtraso: number;
  /** Módulo primário do Bridge nesta sessão. People/Agenda substituem os painéis de mail. */
  bridgeView: BridgeView;
  /** Visão ativa de Contacts. Persistida para reabrir o módulo no mesmo contexto. */
  peopleTab: PeopleTab;

  /** Aceita valor OU updater (mantém a semântica dos antigos `setState`). */
  setZoom: (v: Updater<number>) => void;
  setGruposColapsados: (v: Updater<Record<string, string[]>>) => void;
  setThreadsExpandidas: (v: Updater<Record<string, string[]>>) => void;
  setSidebarAberta: (v: Updater<boolean>) => void;
  toggleSidebar: () => void;
  setMarcarLidoModo: (m: MarcarLidoModo) => void;
  setMarcarLidoAtraso: (n: number) => void;
  setBridgeView: (view: BridgeView) => void;
  setPeopleTab: (tab: PeopleTab) => void;
}

/**
 * Chaves de localStorage do slice — PRESERVADAS 1:1 do `usePersistedState`
 * anterior. O `persist` grava/lê cada campo NESTA chave e NESTE formato (JSON
 * cru do valor), então o estado salvo do usuário continua válido sem migração.
 */
export const UI_KEYS = {
  zoom: "bridge.leitorZoom",
  gruposColapsados: "bridge.gruposColapsados.v2",
  threadsExpandidas: "bridge.threadsExpandidas.v1",
  sidebarAberta: "bridge.sidebar",
  marcarLidoModo: "bridge.marcarLidoModo",
  marcarLidoAtraso: "bridge.marcarLidoAtraso",
  peopleTab: "bridge.peopleTab",
} as const;

/** Campos persistidos do slice (o que o `partialize` guarda). */
export type UiPersistido = Pick<
  UiSlice,
  | "zoom"
  | "gruposColapsados"
  | "threadsExpandidas"
  | "sidebarAberta"
  | "marcarLidoModo"
  | "marcarLidoAtraso"
  | "peopleTab"
>;

/**
 * Slice creator no padrão da doc do Zustand: recebe `set`/`get` do store
 * combinado (por isso é tipado contra `AppStore` + o mutator do `persist`),
 * devolve só a sua fatia. É combinado no `create()` em `index.ts`.
 */
export const createUiSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  UiSlice
> = (set) => ({
  zoom: 1,
  gruposColapsados: {},
  threadsExpandidas: {},
  sidebarAberta: true,
  marcarLidoModo: "imediato",
  marcarLidoAtraso: 2,
  bridgeView: "mail",
  peopleTab: "contacts",

  setZoom: (v) => set((s) => ({ zoom: resolver(s.zoom, v) })),
  setGruposColapsados: (v) =>
    set((s) => ({ gruposColapsados: resolver(s.gruposColapsados, v) })),
  setThreadsExpandidas: (v) =>
    set((s) => ({ threadsExpandidas: resolver(s.threadsExpandidas, v) })),
  setSidebarAberta: (v) => set((s) => ({ sidebarAberta: resolver(s.sidebarAberta, v) })),
  toggleSidebar: () => set((s) => ({ sidebarAberta: !s.sidebarAberta })),
  setMarcarLidoModo: (m) => set({ marcarLidoModo: m }),
  setMarcarLidoAtraso: (n) => set({ marcarLidoAtraso: n }),
  setBridgeView: (bridgeView) => set({ bridgeView }),
  setPeopleTab: (peopleTab) => set({ peopleTab }),
});
