import type { StateCreator } from "zustand";

import type { AppStore } from "./index";
import { alternarPin, removerPin } from "@/lib/pinned-apps";

/**
 * #721 (SH3): apps FIXADOS no rail. Lista ordenada de ids do catálogo (#720). É
 * config comum do usuário (não org-scoped) — persiste LOCAL via o `persist` do
 * store (mesmo caminho do ui-slice); a cloud-sync entra por cima quando a chave
 * for registrada em CHAVES_CONFIG_NUVEM (Confucius, aditivo). A lógica pura vive
 * em `@/lib/pinned-apps`.
 */

export interface PinnedSlice {
  /** Ids fixados, na ordem de exibição. Persistido em `shell.appsFixados`. */
  appsFixados: string[];
  /** Alterna o pin de um app (adiciona no fim / remove). Respeita o cap. */
  alternarFixado: (id: string) => void;
  /** Remove um app dos fixados (idempotente). */
  desafixarApp: (id: string) => void;
}

/** Chave de localStorage do slice (formato: JSON cru do array). */
export const PINNED_KEYS = {
  appsFixados: "shell.appsFixados",
} as const;

/** Campos persistidos (o que o `partialize` guarda). */
export type PinnedPersistido = Pick<PinnedSlice, "appsFixados">;

export const createPinnedSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  PinnedSlice
> = (set) => ({
  appsFixados: [],
  alternarFixado: (id) =>
    set((s) => ({ appsFixados: alternarPin(s.appsFixados, id) })),
  desafixarApp: (id) =>
    set((s) => ({ appsFixados: removerPin(s.appsFixados, id) })),
});
