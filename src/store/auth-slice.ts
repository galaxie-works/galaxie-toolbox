import type { StateCreator } from "zustand";

import type { AppStore } from "./index";

/**
 * Estado de sessão do aviso de reautenticação (#235).
 *
 * Nomes de escopo nunca são persistidos: eles descrevem somente o token atual
 * e precisam ser recalculados pelo backend depois de cada login/restauração.
 */
export interface AuthSlice {
  reauthMissingScopes: string[];
  reauthDismissed: boolean;

  setReauthMissingScopes: (scopes: string[]) => void;
  dismissReauth: () => void;
  clearReauth: () => void;
}

export const createAuthSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  AuthSlice
> = (set) => ({
  reauthMissingScopes: [],
  reauthDismissed: false,

  setReauthMissingScopes: (scopes) => {
    const reauthMissingScopes = Array.from(
      new Set(scopes.map((scope) => scope.trim()).filter(Boolean)),
    );
    set({
      reauthMissingScopes,
      reauthDismissed: false,
    });
  },

  dismissReauth: () => set({ reauthDismissed: true }),

  clearReauth: () =>
    set({
      reauthMissingScopes: [],
      reauthDismissed: false,
    }),
});
