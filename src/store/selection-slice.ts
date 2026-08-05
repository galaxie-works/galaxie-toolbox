import type { StateCreator } from "zustand";

import type { AppStore } from "./index";

/**
 * Seleção de mensagens do Bridge (#128).
 *
 * Todo o estado é de SESSÃO: não entra no `partialize`/legacyStorage. Reabrir o
 * app começa sem multi-seleção, mensagem ativa ou âncora de range herdadas.
 */
export interface SelectionSlice {
  /** IDs marcados para ações em lote. */
  selecionados: Set<string>;
  /** ID da mensagem aberta/ativa no leitor. */
  msgSel: string | null;
  /** Último alvo de navegação/clique usado como início do Shift+clique. */
  ancoraSelecao: string | null;

  /** Atualiza somente a mensagem ativa (fetch/reconcile não muda a âncora). */
  setMensagemAtiva: (id: string | null) => void;
  /** Clique/navegação: ativa a mensagem e a torna a nova âncora. */
  selecionarMensagem: (id: string) => void;
  /** Ctrl/⌘+clique ou `x`: alterna o ID e atualiza a âncora. */
  alternarSelecionado: (id: string) => void;
  /** Limpa multi-seleção e âncora, preservando a mensagem ativa. */
  limparSelecao: () => void;
  /** Ctrl/⌘+A ou checkbox da barra: substitui pela coleção informada. */
  selecionarTudo: (ids: Iterable<string>) => void;
  /**
   * Acrescenta o intervalo entre a âncora e `alvo` na ordem exibida.
   * Retorna false quando não existe uma âncora válida para o caller cair no
   * comportamento de clique simples.
   */
  selecionarRange: (idsExibidos: readonly string[], alvo: string) => boolean;
  /** Remove IDs que saíram da lista e reconcilia ativa/âncora. */
  removerDaSelecao: (ids: Iterable<string>) => void;

  // #555: zera seleção/mensagem ativa/âncora ao trocar de conta.
  resetSessaoSelection: () => void;
}

export const createSelectionSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  SelectionSlice
> = (set) => ({
  selecionados: new Set(),
  msgSel: null,
  ancoraSelecao: null,

  setMensagemAtiva: (id) => set({ msgSel: id }),

  selecionarMensagem: (id) =>
    set({ msgSel: id, ancoraSelecao: id }),

  alternarSelecionado: (id) =>
    set((state) => {
      const selecionados = new Set(state.selecionados);
      if (selecionados.has(id)) selecionados.delete(id);
      else selecionados.add(id);
      return { selecionados, ancoraSelecao: id };
    }),

  limparSelecao: () =>
    set({ selecionados: new Set(), ancoraSelecao: null }),

  selecionarTudo: (ids) =>
    set({ selecionados: new Set(ids) }),

  selecionarRange: (idsExibidos, alvo) => {
    let aplicado = false;
    set((state) => {
      const ancora = state.ancoraSelecao;
      if (!ancora || ancora === alvo) return {};
      const inicio = idsExibidos.indexOf(ancora);
      const fim = idsExibidos.indexOf(alvo);
      if (inicio < 0 || fim < 0) return {};
      const [lo, hi] = inicio < fim ? [inicio, fim] : [fim, inicio];
      const selecionados = new Set(state.selecionados);
      for (const id of idsExibidos.slice(lo, hi + 1)) selecionados.add(id);
      aplicado = true;
      return { selecionados };
    });
    return aplicado;
  },

  removerDaSelecao: (ids) =>
    set((state) => {
      const removidos = new Set(ids);
      if (removidos.size === 0) return {};
      const selecionados = new Set(state.selecionados);
      for (const id of removidos) selecionados.delete(id);
      return {
        selecionados,
        msgSel:
          state.msgSel && removidos.has(state.msgSel) ? null : state.msgSel,
        ancoraSelecao:
          state.ancoraSelecao && removidos.has(state.ancoraSelecao)
            ? null
            : state.ancoraSelecao,
      };
    }),

  // #555: volta ao inicial do slice (nenhuma seleção herdada entre contas).
  resetSessaoSelection: () =>
    set({ selecionados: new Set(), msgSel: null, ancoraSelecao: null }),
});
