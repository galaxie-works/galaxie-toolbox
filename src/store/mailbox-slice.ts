import type { StateCreator } from "zustand";

import type { EmailItem, PastaEmail } from "@/lib/types";
import type { AppStore } from "./index";
import { resolver, type Updater } from "./updater.ts";

/**
 * Entrada do cache em memória de uma pasta (#108): a lista já carregada +
 * a âncora de paginação (`carregados` = skip do Graph, não `mensagens.length`)
 * + se ainda há mais páginas. Restaurar isto ao voltar pra pasta evita
 * refetch, mantém as páginas já roladas e não repete requests ao Graph.
 */
export interface CachePastaEntry {
  mensagens: EmailItem[];
  carregados: number;
  temMais: boolean;
}

/**
 * Slice da(s) caixa(s) de correio — épico #125.
 *
 * Só a lista de caixas compartilhadas é persistida. Caixa ativa, raízes,
 * contadores, subpastas e refresh são estado de sessão (#155), assim como o
 * cache por pasta.
 */
export interface MailboxSlice {
  /** Endereços de caixas compartilhadas adicionadas. Persistido em `bridge.caixasCompartilhadas`. */
  caixasCompartilhadas: string[];
  setCaixasCompartilhadas: (v: Updater<string[]>) => void;

  /** Caixa ativa da sessão (`me` ou endereço compartilhado). */
  caixaAtiva: string;
  /** Pastas raiz com os contadores retornados pelo Graph; `null` = carregando. */
  pastas: PastaEmail[] | null;
  /** Cache sob demanda de childFolders, compartilhado pelo sidebar e pelo mover. */
  subpastas: Record<string, PastaEmail[]>;
  /** Invalidação independente dos contadores/raízes do sidebar. */
  recargaPastas: number;

  setCaixaAtiva: (caixa: string) => void;
  setPastas: (v: Updater<PastaEmail[] | null>) => void;
  setSubpastas: (v: Updater<Record<string, PastaEmail[]>>) => void;
  setRecargaPastas: (v: Updater<number>) => void;

  // #555: reseta o estado tenant-scoped da(s) caixa(s) ao trocar de conta.
  resetSessaoMailbox: () => void;

  /**
   * Cache de SESSÃO por pasta (#108) — NÃO persistido (arrays de mensagens são
   * grandes; nunca vão pro localStorage, fora do `partialize`). Chave =
   * `${caixaAtiva}|${pastaId}|${ordenar}|${ordemDesc}` — escopada por caixa
   * ativa (#111) e ordenação pra que caixa compartilhada e troca de sort não
   * colidam. Reseta a cada sessão (default `{}`).
   */
  cachePastas: Record<string, CachePastaEntry>;

  /** Grava/sobrescreve a entrada de uma pasta. */
  setCachePasta: (chave: string, entry: CachePastaEntry) => void;
  /** Transforma a entrada de uma pasta (map/filter das mensagens); no-op se não existir. */
  atualizarCachePasta: (
    chave: string,
    updater: (entry: CachePastaEntry) => CachePastaEntry
  ) => void;
  /** Invalida (remove) a entrada de uma pasta. */
  limparCachePasta: (chave: string) => void;
}

/** Chave legada preservada 1:1 do `usePersistedState`. */
export const MAILBOX_KEYS = {
  caixasCompartilhadas: "bridge.caixasCompartilhadas",
} as const;

export type MailboxPersistido = Pick<MailboxSlice, "caixasCompartilhadas">;

export const createMailboxSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  MailboxSlice
> = (set) => ({
  caixasCompartilhadas: [],

  setCaixasCompartilhadas: (v) =>
    set((s) => ({ caixasCompartilhadas: resolver(s.caixasCompartilhadas, v) })),

  caixaAtiva: "me",
  pastas: null,
  subpastas: {},
  recargaPastas: 0,

  setCaixaAtiva: (caixaAtiva) => set({ caixaAtiva }),
  setPastas: (v) => set((s) => ({ pastas: resolver(s.pastas, v) })),
  setSubpastas: (v) =>
    set((s) => ({ subpastas: resolver(s.subpastas, v) })),
  setRecargaPastas: (v) =>
    set((s) => ({ recargaPastas: resolver(s.recargaPastas, v) })),

  // #555: volta tudo ao inicial do slice (caixa própria, sem pastas/cache/compartilhadas).
  resetSessaoMailbox: () =>
    set({
      caixaAtiva: "me",
      pastas: null,
      subpastas: {},
      recargaPastas: 0,
      cachePastas: {},
      caixasCompartilhadas: [],
    }),

  // Cache de sessão (#108): default vazio, nunca vai pro partialize.
  cachePastas: {},

  setCachePasta: (chave, entry) =>
    set((s) => ({ cachePastas: { ...s.cachePastas, [chave]: entry } })),

  atualizarCachePasta: (chave, updater) =>
    set((s) => {
      const atual = s.cachePastas[chave];
      if (!atual) return {};
      return { cachePastas: { ...s.cachePastas, [chave]: updater(atual) } };
    }),

  limparCachePasta: (chave) =>
    set((s) => {
      if (!(chave in s.cachePastas)) return {};
      const { [chave]: _descartada, ...resto } = s.cachePastas;
      return { cachePastas: resto };
    }),
});
