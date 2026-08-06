import type { StateCreator } from "zustand";

import {
  ATOMS_PREFS_KEY,
  loadAtomsPrefs,
  type AtomsPrefs,
} from "@/lib/atoms-prefs";
import { CHAVE_IDIOMA, idiomaAtual } from "@/lib/idioma-core";
import type { Idioma } from "@/lib/strings";
import type { AppStore } from "./index";

/** Preferências acionáveis que ainda viviam fora do store único. */
export interface CloudPrefsSlice {
  idioma: Idioma;
  atomsPrefs: AtomsPrefs;
  pularConfirmacaoConexao: boolean;

  setIdioma: (idioma: Idioma) => void;
  setAtomsPrefs: (patch: Partial<AtomsPrefs>) => void;
  setPularConfirmacaoConexao: (pular: boolean) => void;
}

export const CLOUD_PREFS_KEYS = {
  idioma: CHAVE_IDIOMA,
  atomsPrefs: ATOMS_PREFS_KEY,
  pularConfirmacaoConexao: "galaxie-pular-confirmacao-conexao",
} as const;

export type CloudPrefsPersistido = Pick<
  CloudPrefsSlice,
  "idioma" | "atomsPrefs" | "pularConfirmacaoConexao"
>;

export const createCloudPrefsSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  CloudPrefsSlice
> = (set) => ({
  idioma: idiomaAtual(),
  atomsPrefs: loadAtomsPrefs(),
  pularConfirmacaoConexao:
    localStorage.getItem(CLOUD_PREFS_KEYS.pularConfirmacaoConexao) === "1",

  setIdioma: (idioma) => set({ idioma }),
  setAtomsPrefs: (patch) =>
    set((state) => ({ atomsPrefs: { ...state.atomsPrefs, ...patch } })),
  setPularConfirmacaoConexao: (pularConfirmacaoConexao) =>
    set({ pularConfirmacaoConexao }),
});
