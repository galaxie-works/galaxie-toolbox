import type { StateCreator } from "zustand";

import {
  crEmailCorpo,
  crEmailSeguranca,
  crInsightsRemetente,
} from "../lib/api.ts";
import type {
  EmailDetalhe,
  InsightsRemetente,
  SegurancaEmail,
} from "../lib/types.ts";
import type { AppStore } from "./index";

export type InsightsEstado = "idle" | "carregando" | "ok" | "erro";

export interface LeitorAlvo {
  id: string;
  mailbox: string;
}

interface ReaderApi {
  carregarCorpo: (id: string, mailbox: string) => Promise<EmailDetalhe>;
  carregarSeguranca: (
    id: string,
    mailbox: string,
  ) => Promise<SegurancaEmail>;
  carregarInsights: (email: string) => Promise<InsightsRemetente>;
}

/**
 * Estado de SESSÃO do leitor de mensagens (#130).
 *
 * `msgSel` continua sendo a mensagem ativa canônica no selection-slice. O alvo
 * abaixo identifica somente a requisição atualmente carregada, para que corpo,
 * segurança e insights atrasados nunca vazem depois de uma troca rápida.
 */
export interface ReaderSlice {
  leitorAlvo: LeitorAlvo | null;
  leitorDetalhe: EmailDetalhe | null;
  leitorSeguranca: SegurancaEmail | null;
  leitorGeracao: number;

  insightsAberto: boolean;
  insightsEstado: InsightsEstado;
  insightsDados: InsightsRemetente | null;
  insightsEmail: string | null;
  insightsTentativa: number;
  insightsGeracao: number;

  carregarLeitor: (alvo: LeitorAlvo) => Promise<void>;
  limparLeitor: () => void;
  abrirInsights: (email: string) => Promise<void>;
  fecharInsights: () => void;
  tentarNovamenteInsights: (email: string) => Promise<void>;
}

const readerApi: ReaderApi = {
  carregarCorpo: crEmailCorpo,
  carregarSeguranca: crEmailSeguranca,
  carregarInsights: crInsightsRemetente,
};

const insightsLimpos = {
  insightsAberto: false,
  insightsEstado: "idle" as const,
  insightsDados: null,
  insightsEmail: null,
  insightsTentativa: 0,
};

/** Factory exportada para testar concorrência sem acoplar os testes ao Graph. */
export function criarReaderSlice(
  api: ReaderApi = readerApi,
): StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  ReaderSlice
> {
  return (set, get) => {
    const carregarInsights = async (email: string, tentativa: number) => {
      const geracao = get().insightsGeracao + 1;
      set({
        insightsAberto: true,
        insightsEstado: "carregando",
        insightsDados: null,
        insightsEmail: email,
        insightsTentativa: tentativa,
        insightsGeracao: geracao,
      });
      try {
        const dados = await api.carregarInsights(email);
        const atual = get();
        if (
          atual.insightsGeracao !== geracao ||
          atual.insightsEmail !== email ||
          !atual.insightsAberto
        ) {
          return;
        }
        set({ insightsDados: dados, insightsEstado: "ok" });
      } catch {
        const atual = get();
        if (
          atual.insightsGeracao === geracao &&
          atual.insightsEmail === email &&
          atual.insightsAberto
        ) {
          set({ insightsEstado: "erro" });
        }
      }
    };

    return {
      leitorAlvo: null,
      leitorDetalhe: null,
      leitorSeguranca: null,
      leitorGeracao: 0,

      ...insightsLimpos,
      insightsGeracao: 0,

      carregarLeitor: async (alvo) => {
        const geracao = get().leitorGeracao + 1;
        set((state) => ({
          leitorAlvo: alvo,
          leitorDetalhe: null,
          leitorSeguranca: null,
          leitorGeracao: geracao,
          ...insightsLimpos,
          insightsGeracao: state.insightsGeracao + 1,
        }));

        void api
          .carregarSeguranca(alvo.id, alvo.mailbox)
          .then((seguranca) => {
            const atual = get();
            if (
              atual.leitorGeracao === geracao &&
              atual.leitorAlvo?.id === alvo.id &&
              atual.leitorAlvo.mailbox === alvo.mailbox
            ) {
              set({ leitorSeguranca: seguranca });
            }
          })
          .catch(() => {
            // Segurança é best-effort: a falha não derruba nem atrasa o corpo.
          });

        try {
          const detalhe = await api.carregarCorpo(alvo.id, alvo.mailbox);
          const atual = get();
          if (
            atual.leitorGeracao === geracao &&
            atual.leitorAlvo?.id === alvo.id &&
            atual.leitorAlvo.mailbox === alvo.mailbox
          ) {
            set({ leitorDetalhe: detalhe });
          }
        } catch {
          // Mantém o comportamento atual: leitor segue no estado de carregamento.
        }
      },

      limparLeitor: () =>
        set((state) => ({
          leitorAlvo: null,
          leitorDetalhe: null,
          leitorSeguranca: null,
          leitorGeracao: state.leitorGeracao + 1,
          ...insightsLimpos,
          insightsGeracao: state.insightsGeracao + 1,
        })),
      abrirInsights: async (email) => {
        const atual = get();
        if (
          atual.insightsEmail === email &&
          (atual.insightsEstado === "ok" ||
            atual.insightsEstado === "erro" ||
            atual.insightsEstado === "carregando")
        ) {
          set({ insightsAberto: true });
          return;
        }
        await carregarInsights(email, 0);
      },

      fecharInsights: () =>
        set((state) => ({
          insightsAberto: false,
          ...(state.insightsEstado === "carregando"
            ? {
                insightsEstado: "idle" as const,
                insightsDados: null,
                insightsGeracao: state.insightsGeracao + 1,
              }
            : {}),
        })),

      tentarNovamenteInsights: async (email) => {
        await carregarInsights(email, get().insightsTentativa + 1);
      },
    };
  };
}

export const createReaderSlice = criarReaderSlice();
