import type { StateCreator } from "zustand";

import type { AppStore } from "./index";

export const SETTINGS_ITEM_IDS = [
  "accounts",
  "personalization",
  // #580: "privacy" removido — a seção morreu (telemetria migrou pra System).
  "system",
  "galaxie-apps",
  "bridge",
  "navigator",
  "microsoft-365-copilot",
  "organization",
  "windows",
] as const;

export type SettingsItemId = (typeof SETTINGS_ITEM_IDS)[number];

export interface SettingsUiSlice {
  selectedSettingsItem: SettingsItemId;
  /** Estado dos frames por `item:frame`; persiste expansão entre sessões. */
  settingsFramesAbertos: Record<string, boolean>;
  /** #498: nonce de sessão (NÃO persistido). Bumpado por `abrirConfigAssinaturas`;
   *  o App observa e troca pra tela de Settings. */
  navConfigNonce: number;
  setSelectedSettingsItem: (item: SettingsItemId) => void;
  setSettingsFrameAberto: (frame: string, aberto: boolean) => void;
  /** #498: abre a config de assinaturas (Bridge > Envio) de qualquer lugar —
   *  seleciona a seção, abre o frame e sinaliza o App pra trocar de tela. */
  abrirConfigAssinaturas: () => void;
}

export const SETTINGS_UI_KEYS = {
  selectedSettingsItem: "galaxie-toolbox.settingsItem",
  settingsFramesAbertos: "galaxie-toolbox.settingsFrames",
} as const;

export type SettingsUiPersistido = Pick<
  SettingsUiSlice,
  "selectedSettingsItem" | "settingsFramesAbertos"
>;

/**
 * Navegação da Settings. Preferências de produto entram em slices próprios;
 * este slice só mantém qual área a pessoa deixou aberta.
 */
export const createSettingsUiSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  SettingsUiSlice
> = (set) => ({
  selectedSettingsItem: "accounts",
  settingsFramesAbertos: {},
  navConfigNonce: 0,
  setSelectedSettingsItem: (item) => set({ selectedSettingsItem: item }),
  setSettingsFrameAberto: (frame, aberto) =>
    set((state) => ({
      settingsFramesAbertos: {
        ...state.settingsFramesAbertos,
        [frame]: aberto,
      },
    })),
  abrirConfigAssinaturas: () =>
    set((state) => ({
      selectedSettingsItem: "bridge",
      settingsFramesAbertos: {
        ...state.settingsFramesAbertos,
        "bridge:sending": true,
      },
      navConfigNonce: state.navConfigNonce + 1,
    })),
});
