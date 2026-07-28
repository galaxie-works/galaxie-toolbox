import type { StateCreator } from "zustand";

import type { AppStore } from "./index";

export const SETTINGS_ITEM_IDS = [
  "accounts",
  "personalization",
  "system",
  "galaxie-apps",
  "microsoft-365-copilot",
  "windows",
] as const;

export type SettingsItemId = (typeof SETTINGS_ITEM_IDS)[number];

export interface SettingsUiSlice {
  selectedSettingsItem: SettingsItemId;
  setSelectedSettingsItem: (item: SettingsItemId) => void;
}

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
  setSelectedSettingsItem: (item) => set({ selectedSettingsItem: item }),
});
