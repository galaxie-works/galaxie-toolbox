import type { StateCreator } from "zustand";

import {
  novoId,
  novoIdTemplate,
  TEMPLATES_KEY,
  type TemplateEmail,
} from "@/lib/templates";
import { UNDO_SEND_DELAY_MS } from "@/lib/outbox";
import type { AppStore } from "./index";

/**
 * Atrasos permitidos do "desfazer envio" (#150), em ms. A #33 fixava 10 s; aqui
 * o usuário escolhe 5/10/30 s em Settings > Galaxie Apps > Bridge, e o valor
 * alimenta o `atrasoMs` do Outbox. `UNDO_SEND_DELAY_MS` (10 s) segue como padrão.
 */
export const UNDO_SEND_DELAYS_MS = [5_000, 10_000, 30_000] as const;
export type UndoSendDelayMs = (typeof UNDO_SEND_DELAYS_MS)[number];

/** Normaliza um valor cru para o conjunto permitido; fora dele volta pro padrão. */
export function normalizarUndoSendDelay(valor: unknown): number {
  return (UNDO_SEND_DELAYS_MS as readonly number[]).includes(valor as number)
    ? (valor as number)
    : UNDO_SEND_DELAY_MS;
}

/**
 * Assinatura de e-mail do Bridge (#135). `corpo` é o HTML gerado pelo mesmo
 * Plate do compose — inserir no e-mail é só desserializar de volta, igual aos
 * templates.
 */
export interface Assinatura {
  id: string;
  nome: string;
  corpo: string;
  /** Insere esta assinatura automaticamente em respostas/encaminhamentos (#142). */
  usarEmRespostas: boolean;
}

/** Dados editáveis de uma assinatura (sem id), como vêm da Sheet. */
export interface DadosAssinatura {
  nome: string;
  corpo: string;
  /** Marca esta assinatura como a padrão (usada nos e-mails do Bridge). */
  padrao: boolean;
  /** Auto insere esta assinatura em respostas/encaminhamentos (#142). */
  usarEmRespostas: boolean;
}

/** Dados editáveis de um template (sem id), como vêm da Sheet. */
export interface DadosTemplate {
  nome: string;
  descricao: string;
  corpo: string;
}

/**
 * Estado do Bridge migrado do localStorage cru para o store único (#135):
 * assinaturas + qual é a padrão + templates de e-mail. Antes as assinaturas
 * viviam soltas em `bridge.assinatura` (string única) e os templates em
 * `bridge.templates`; agora tudo é slice persistido, sem hook local.
 */
export interface BridgeSlice {
  /** Assinaturas do usuário (a padrão é apontada por `assinaturaPadraoId`). */
  assinaturas: Assinatura[];
  /** Id da assinatura padrão; `null` = "Sem padrão". */
  assinaturaPadraoId: string | null;
  /** Templates de e-mail reutilizáveis. */
  templates: TemplateEmail[];
  /** Janela do "desfazer envio" (#150), em ms — um de `UNDO_SEND_DELAYS_MS`. */
  undoSendDelayMs: number;

  adicionarAssinatura: (dados: DadosAssinatura) => void;
  atualizarAssinatura: (id: string, dados: DadosAssinatura) => void;
  removerAssinatura: (id: string) => void;
  /** Troca a padrão (desmarca as outras); `null` volta pra "Sem padrão". */
  definirAssinaturaPadrao: (id: string | null) => void;

  adicionarTemplate: (dados: DadosTemplate) => void;
  atualizarTemplate: (id: string, dados: DadosTemplate) => void;
  removerTemplate: (id: string) => void;

  /** Troca a janela do desfazer envio; valor fora do permitido cai no padrão. */
  setUndoSendDelay: (ms: number) => void;
}

export const BRIDGE_KEYS = {
  assinaturas: "bridge.assinaturas",
  assinaturaPadraoId: "bridge.assinaturaPadrao",
  // Mesma chave legada dos templates — nada a migrar, só passa a ser dono o store.
  templates: TEMPLATES_KEY,
  undoSendDelay: "bridge.undoSendDelay",
} as const;

export type BridgePersistido = Pick<
  BridgeSlice,
  "assinaturas" | "assinaturaPadraoId" | "templates" | "undoSendDelayMs"
>;

export const createBridgeSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  BridgeSlice
> = (set) => ({
  assinaturas: [],
  assinaturaPadraoId: null,
  templates: [],
  undoSendDelayMs: UNDO_SEND_DELAY_MS,

  adicionarAssinatura: ({ nome, corpo, padrao, usarEmRespostas }) =>
    set((state) => {
      const nova: Assinatura = {
        id: novoId("sig"),
        nome,
        corpo,
        usarEmRespostas,
      };
      return {
        assinaturas: [...state.assinaturas, nova],
        assinaturaPadraoId: padrao ? nova.id : state.assinaturaPadraoId,
      };
    }),

  atualizarAssinatura: (id, { nome, corpo, padrao, usarEmRespostas }) =>
    set((state) => ({
      assinaturas: state.assinaturas.map((a) =>
        a.id === id ? { ...a, nome, corpo, usarEmRespostas } : a
      ),
      // Ligar o switch torna esta a padrão; desligar numa que era padrão volta
      // pra "Sem padrão". Mexer no switch de outra não afeta a padrão vigente.
      assinaturaPadraoId: padrao
        ? id
        : state.assinaturaPadraoId === id
          ? null
          : state.assinaturaPadraoId,
    })),

  removerAssinatura: (id) =>
    set((state) => ({
      assinaturas: state.assinaturas.filter((a) => a.id !== id),
      // Excluir a padrão volta pra "Sem padrão".
      assinaturaPadraoId:
        state.assinaturaPadraoId === id ? null : state.assinaturaPadraoId,
    })),

  definirAssinaturaPadrao: (id) => set({ assinaturaPadraoId: id }),

  adicionarTemplate: ({ nome, descricao, corpo }) =>
    set((state) => ({
      templates: [
        ...state.templates,
        { id: novoIdTemplate(), nome, descricao, corpo },
      ],
    })),

  atualizarTemplate: (id, { nome, descricao, corpo }) =>
    set((state) => ({
      templates: state.templates.map((t) =>
        t.id === id ? { ...t, nome, descricao, corpo } : t
      ),
    })),

  removerTemplate: (id) =>
    set((state) => ({
      templates: state.templates.filter((t) => t.id !== id),
    })),

  setUndoSendDelay: (ms) =>
    set({ undoSendDelayMs: normalizarUndoSendDelay(ms) }),
});
