import type { StateCreator } from "zustand";

import type { AppStore } from "./index";
import { resolver, type Updater } from "./updater";

/**
 * Slice da(s) caixa(s) de correio — épico #125.
 * Hoje: lista de caixas compartilhadas adicionadas (#111), persistida. A caixa
 * ATIVA reseta pra própria (/me) a cada sessão, então não fica no store persistido.
 */
export interface MailboxSlice {
  /** Endereços de caixas compartilhadas adicionadas. Persistido em `bridge.caixasCompartilhadas`. */
  caixasCompartilhadas: string[];

  setCaixasCompartilhadas: (v: Updater<string[]>) => void;
}

/** Chave legada preservada 1:1 do `usePersistedState`. */
export const MAILBOX_KEYS = {
  caixasCompartilhadas: "bridge.caixasCompartilhadas",
} as const;

export type MailboxPersistido = Pick<MailboxSlice, "caixasCompartilhadas">;

export const createMailboxSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  MailboxSlice
> = (set) => ({
  caixasCompartilhadas: [],

  setCaixasCompartilhadas: (v) =>
    set((s) => ({ caixasCompartilhadas: resolver(s.caixasCompartilhadas, v) })),
});
