import type { StateCreator } from "zustand";

import type { AnexoEnvio } from "@/lib/api";
import type { AppStore } from "./index";
import { resolver, type Updater } from "./updater.ts";

export type ComposeModo =
  | "novo"
  | "responder"
  | "responderTodos"
  | "encaminhar"
  | null;

type ComposeModoAtivo = Exclude<ComposeModo, null>;

/**
 * Estado de SESSÃO da composição (#132).
 *
 * O slice guarda somente os valores de domínio do rascunho e a orquestração
 * comum aos Sheets. A instância Plate, o HTML vivo do editor, drag/drop,
 * erros/cache do uploader e o ciclo de envio/undo-send continuam locais nos
 * componentes que os implementam.
 */
export interface ComposeSlice {
  composeModo: ComposeModo;
  composeGeracao: number;
  composeRemetente: string;
  composePara: string[];
  composeCc: string[];
  composeCco: string[];
  composeAssunto: string;
  composeAnexos: AnexoEnvio[];

  abrirCompose: (modo: ComposeModoAtivo, remetente: string) => void;
  fecharCompose: () => void;
  setComposeRemetente: (remetente: string) => void;
  setComposePara: (valor: Updater<string[]>) => void;
  setComposeCc: (valor: Updater<string[]>) => void;
  setComposeCco: (valor: Updater<string[]>) => void;
  setComposeAssunto: (assunto: string) => void;
  setComposeAnexos: (valor: Updater<AnexoEnvio[]>) => void;
}

const rascunhoVazio = {
  composePara: [] as string[],
  composeCc: [] as string[],
  composeCco: [] as string[],
  composeAssunto: "",
  composeAnexos: [] as AnexoEnvio[],
};

export const createComposeSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  ComposeSlice
> = (set) => ({
  composeModo: null,
  composeGeracao: 0,
  composeRemetente: "me",
  ...rascunhoVazio,

  abrirCompose: (modo, remetente) =>
    set((state) => ({
      composeModo: modo,
      composeGeracao: state.composeGeracao + 1,
      composeRemetente: remetente,
      ...rascunhoVazio,
    })),

  fecharCompose: () =>
    set((state) => ({
      composeModo: null,
      composeGeracao: state.composeGeracao + 1,
      composeRemetente: "me",
      ...rascunhoVazio,
    })),

  setComposeRemetente: (composeRemetente) => set({ composeRemetente }),
  setComposePara: (valor) =>
    set((state) => ({ composePara: resolver(state.composePara, valor) })),
  setComposeCc: (valor) =>
    set((state) => ({ composeCc: resolver(state.composeCc, valor) })),
  setComposeCco: (valor) =>
    set((state) => ({ composeCco: resolver(state.composeCco, valor) })),
  setComposeAssunto: (composeAssunto) => set({ composeAssunto }),
  setComposeAnexos: (valor) =>
    set((state) => ({ composeAnexos: resolver(state.composeAnexos, valor) })),
});
