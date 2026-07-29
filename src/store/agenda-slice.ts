import type { StateCreator } from "zustand";

import { crAgenda, crCategorias, crEventoCorpo } from "../lib/api.ts";
import type {
  CategoriaCor,
  EventoAgenda,
  EventoDetalhe,
} from "../lib/types.ts";
import type { AppStore } from "./index";

interface AgendaApi {
  carregarEventos: (inicio: string, fim: string) => Promise<EventoAgenda[]>;
  carregarCategorias: () => Promise<CategoriaCor[]>;
  carregarEvento: (id: string) => Promise<EventoDetalhe>;
}

export interface AgendaSlice {
  agendaDia: Date;
  agendaEventosMes: EventoAgenda[] | null;
  agendaErro: string | null;
  agendaRecarga: number;
  agendaCoresCategoria: Map<string, string>;
  agendaGeracao: number;

  agendaEventoId: string | null;
  agendaEventoDetalhe: EventoDetalhe | null;
  agendaEventoGeracao: number;

  setAgendaDia: (dia: Date) => void;
  carregarMesAgenda: (inicio: string, fim: string) => Promise<void>;
  recarregarAgenda: () => void;
  carregarCoresAgenda: () => Promise<void>;
  selecionarEventoAgenda: (id: string) => Promise<void>;
  fecharEventoAgenda: () => void;
}

const agendaApi: AgendaApi = {
  carregarEventos: crAgenda,
  carregarCategorias: crCategorias,
  carregarEvento: crEventoCorpo,
};

/** Factory exportada para testar concorrência sem depender do Graph. */
export function criarAgendaSlice(
  api: AgendaApi = agendaApi,
): StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  AgendaSlice
> {
  return (set, get) => ({
    agendaDia: new Date(),
    agendaEventosMes: null,
    agendaErro: null,
    agendaRecarga: 0,
    agendaCoresCategoria: new Map(),
    agendaGeracao: 0,

    agendaEventoId: null,
    agendaEventoDetalhe: null,
    agendaEventoGeracao: 0,

    setAgendaDia: (dia) => set({ agendaDia: dia }),

    carregarMesAgenda: async (inicio, fim) => {
      const geracao = get().agendaGeracao + 1;
      set({
        agendaEventosMes: null,
        agendaErro: null,
        agendaGeracao: geracao,
      });
      try {
        const eventos = await api.carregarEventos(inicio, fim);
        if (get().agendaGeracao === geracao) {
          set({ agendaEventosMes: eventos });
        }
      } catch (erro) {
        if (get().agendaGeracao === geracao) {
          set({
            agendaErro: String(erro),
            agendaEventosMes: [],
          });
        }
      }
    },

    recarregarAgenda: () =>
      set((state) => ({ agendaRecarga: state.agendaRecarga + 1 })),

    carregarCoresAgenda: async () => {
      try {
        const categorias = await api.carregarCategorias();
        set({
          agendaCoresCategoria: new Map(
            categorias.map((categoria) => [categoria.nome, categoria.cor]),
          ),
        });
      } catch {
        // Cores são best-effort; a UI mantém a barra com a cor primária.
      }
    },

    selecionarEventoAgenda: async (id) => {
      const geracao = get().agendaEventoGeracao + 1;
      set({
        agendaEventoId: id,
        agendaEventoDetalhe: null,
        agendaEventoGeracao: geracao,
      });
      try {
        const detalhe = await api.carregarEvento(id);
        const atual = get();
        if (
          atual.agendaEventoGeracao === geracao &&
          atual.agendaEventoId === id
        ) {
          set({ agendaEventoDetalhe: detalhe });
        }
      } catch {
        // Mantém o comportamento atual: o Sheet segue no loading.
      }
    },

    fecharEventoAgenda: () =>
      set((state) => ({
        agendaEventoId: null,
        agendaEventoDetalhe: null,
        agendaEventoGeracao: state.agendaEventoGeracao + 1,
      })),
  });
}

export const createAgendaSlice = criarAgendaSlice();
