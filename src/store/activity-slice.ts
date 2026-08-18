import type { StateCreator } from "zustand";

import type { OpAtiva } from "@/components/explorer/progresso-panel";
import type { AppStore } from "./index";

/**
 * Fila de atividades de transferência (copy/move) do Explorer — épico #898.
 *
 * #987: o sino do activity-dropdown saiu de FLUTUANTE (dentro do Explorer) pra
 * TITLE BAR do app (sempre visível). Pra o sino viver no App e as transferências
 * seguirem sendo disparadas pelo Explorer, o modelo `ops` (+ os `desfeitos` do
 * #967) subiu do estado local do `explorer-shell` pra ESTE slice compartilhado.
 * O App monta o `useOpsAtivas` UMA vez (assina o progresso do Tauri, escreve
 * aqui); o `explorer-shell` só registra tipo/destino ao iniciar a transferência.
 *
 * Todo o estado é de SESSÃO: não entra no `partialize`. Uma transferência é uma
 * operação de disco em curso, não config nem estado por-conta — por isso também
 * fica FORA do seam de reset de sessão (#555): não é tenant-scoped.
 */
export interface ActivitySlice {
  /** Ops de copy/move rastreadas por opId (ativas + terminais retidas). */
  ops: OpAtiva[];
  /** #967: opIds já desfeitos (marca a linha como "Desfeito" na dropdown). */
  desfeitos: ReadonlySet<number>;

  /** Atualiza a fila de ops (functional updater, como o `setOps` local antigo). */
  setOps: (atualizar: (prev: OpAtiva[]) => OpAtiva[]) => void;
  /** Atualiza o conjunto de desfeitos (functional updater). */
  setDesfeitos: (
    atualizar: (prev: ReadonlySet<number>) => ReadonlySet<number>,
  ) => void;
}

/** Estado inicial "nada desfeito": um só set vazio readonly compartilhado. */
const DESFEITOS_VAZIO: ReadonlySet<number> = new Set();

export const createActivitySlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  ActivitySlice
> = (set) => ({
  ops: [],
  desfeitos: DESFEITOS_VAZIO,

  setOps: (atualizar) => set((state) => ({ ops: atualizar(state.ops) })),
  setDesfeitos: (atualizar) =>
    set((state) => ({ desfeitos: atualizar(state.desfeitos) })),
});
