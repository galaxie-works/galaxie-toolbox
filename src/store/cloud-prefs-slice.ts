import type { StateCreator } from "zustand";

import { CHAVE_IDIOMA, idiomaAtual } from "@/lib/idioma-core";
import type { Idioma } from "@/lib/strings";
import type { AppStore } from "./index";

/** Preferências acionáveis que ainda viviam fora do store único. */
export interface CloudPrefsSlice {
  idioma: Idioma;
  pularConfirmacaoConexao: boolean;

  setIdioma: (idioma: Idioma) => void;
  setPularConfirmacaoConexao: (pular: boolean) => void;
}

export const CLOUD_PREFS_KEYS = {
  idioma: CHAVE_IDIOMA,
  pularConfirmacaoConexao: "galaxie-pular-confirmacao-conexao",
} as const;

export type CloudPrefsPersistido = Pick<
  CloudPrefsSlice,
  "idioma" | "pularConfirmacaoConexao"
>;

export const createCloudPrefsSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  CloudPrefsSlice
> = (set) => ({
  idioma: idiomaAtual(),
  pularConfirmacaoConexao:
    localStorage.getItem(CLOUD_PREFS_KEYS.pularConfirmacaoConexao) === "1",

  setIdioma: (idioma) => set({ idioma }),
  setPularConfirmacaoConexao: (pularConfirmacaoConexao) =>
    set({ pularConfirmacaoConexao }),
});
