import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  createSettingsUiSlice,
  type SettingsUiSlice,
} from "@/store/settings-ui-slice";

/**
 * Store único do app. Novos slices devem ser compostos aqui, sem criar outro
 * `create()` ou armazenar preferências em hooks locais.
 */
export const useAppStore = create<SettingsUiSlice>()(
  persist(
    (...args) => ({
      ...createSettingsUiSlice(...args),
    }),
    {
      name: "galaxie-toolbox.store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedSettingsItem: state.selectedSettingsItem,
      }),
    }
  )
);
