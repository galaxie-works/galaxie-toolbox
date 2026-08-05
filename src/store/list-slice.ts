import type { StateCreator } from "zustand";

import type { EmailItem } from "@/lib/types";
import type { AppStore } from "./index";
import { resolver, type Updater } from "./updater.ts";

/**
 * Slice da lista de mensagens — apresentação + carga da sessão (épico #125).
 * Filtros/busca/ordenação ficam no `filters-slice`; a #155 traz pra cá a pasta
 * selecionada, a lista base e a paginação sem duplicar esses valores no root.
 */
export interface ListSlice {
  /** Agrupa mensagens por conversa (#29). Opt-in no primeiro ship. */
  agruparConversas: boolean;
  setAgruparConversas: (v: Updater<boolean>) => void;

  pastaSel: string;
  mensagens: EmailItem[] | null;
  /** Caixa à qual `mensagens` pertence; evita flash de outra mailbox. */
  caixaDados: string;
  /** Invalidação da lista/pasta corrente. */
  listaRecarga: number;
  temMais: boolean;
  carregandoMais: boolean;

  setPastaSel: (pasta: string) => void;
  setMensagens: (v: Updater<EmailItem[] | null>) => void;
  setCaixaDados: (caixa: string) => void;
  setListaRecarga: (v: Updater<number>) => void;
  setTemMais: (temMais: boolean) => void;
  setCarregandoMais: (carregando: boolean) => void;

  // #555: reseta a lista/paginação da sessão ao trocar de conta (não toca em `agruparConversas`, que é preferência persistida).
  resetSessaoList: () => void;
}

/** Chaves legadas preservadas 1:1 do `usePersistedState`. */
export const LIST_KEYS = {
  agruparConversas: "bridge.conversationView",
} as const;

export type ListPersistido = Pick<ListSlice, "agruparConversas">;

export const createListSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  ListSlice
> = (set) => ({
  // Decisão final do PO na #133: threading ligado por padrão; o toggle permite
  // voltar literalmente ao flattening anterior quando o usuário preferir.
  agruparConversas: true,

  setAgruparConversas: (v) =>
    set((s) => ({ agruparConversas: resolver(s.agruparConversas, v) })),

  pastaSel: "inbox",
  mensagens: null,
  caixaDados: "me",
  listaRecarga: 0,
  temMais: false,
  carregandoMais: false,

  setPastaSel: (pastaSel) => set({ pastaSel }),
  setMensagens: (v) =>
    set((s) => ({ mensagens: resolver(s.mensagens, v) })),
  setCaixaDados: (caixaDados) => set({ caixaDados }),
  setListaRecarga: (v) =>
    set((s) => ({ listaRecarga: resolver(s.listaRecarga, v) })),
  setTemMais: (temMais) => set({ temMais }),
  setCarregandoMais: (carregandoMais) => set({ carregandoMais }),

  // #555: volta ao inicial do slice, preservando `agruparConversas` (persistida).
  resetSessaoList: () =>
    set({
      pastaSel: "inbox",
      mensagens: null,
      caixaDados: "me",
      listaRecarga: 0,
      temMais: false,
      carregandoMais: false,
    }),
});
