import type { StateCreator } from "zustand";

import type { AppStore } from "./index";

export const SETTINGS_ITEM_IDS = [
  "accounts",
  "personalization",
  "system",
  "galaxie-apps",
  "bridge",
  "navigator",
  "microsoft-365-copilot",
  "windows",
] as const;

export type SettingsItemId = (typeof SETTINGS_ITEM_IDS)[number];

export interface SettingsUiSlice {
  selectedSettingsItem: SettingsItemId;
  /** Estado dos frames por `item:frame`; persiste expansão entre sessões. */
  settingsFramesAbertos: Record<string, boolean>;
  setSelectedSettingsItem: (item: SettingsItemId) => void;
  setSettingsFrameAberto: (frame: string, aberto: boolean) => void;
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
  setSelectedSettingsItem: (item) => set({ selectedSettingsItem: item }),
  setSettingsFrameAberto: (frame, aberto) =>
    set((state) => ({
      settingsFramesAbertos: {
        ...state.settingsFramesAbertos,
        [frame]: aberto,
      },
    })),
});
