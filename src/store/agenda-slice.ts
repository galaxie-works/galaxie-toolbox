import type { StateCreator } from "zustand";

import {
  crAgenda,
  crCategorias,
  crCriarEvento,
  crEditarEvento,
  crEventoCorpo,
  crExcluirEvento,
} from "../lib/api.ts";
import type {
  CategoriaCor,
  EventoAgenda,
  EventoDetalhe,
  EventoInput,
} from "../lib/types.ts";
import type { AppStore } from "./index";

/** Views suportadas pela Agenda (subconjunto do reui event-calendar). */
export type AgendaViewTipo = "month" | "week" | "day" | "agenda";
export const AGENDA_VIEWS: readonly AgendaViewTipo[] = [
  "month",
  "week",
  "day",
  "agenda",
];

/** Chave real no localStorage da preferência de view (persistida). */
export const AGENDA_KEYS = { agendaView: "agenda.view" } as const;

/** O que a agenda persiste entre sessões: só a preferência de view. */
export interface AgendaPersistido {
  agendaView: AgendaViewTipo;
}

interface AgendaApi {
  carregarEventos: (inicio: string, fim: string) => Promise<EventoAgenda[]>;
  carregarCategorias: () => Promise<CategoriaCor[]>;
  carregarEvento: (id: string) => Promise<EventoDetalhe>;
  criarEvento: (input: EventoInput) => Promise<string>;
  editarEvento: (id: string, input: EventoInput) => Promise<void>;
  excluirEvento: (id: string) => Promise<void>;
}

export interface AgendaSlice {
  agendaDia: Date;
  agendaView: AgendaViewTipo; // preferência persistida (mês/semana/dia/agenda)
  agendaEventosMes: EventoAgenda[] | null;
  agendaErro: string | null;
  agendaRecarga: number;
  agendaCoresCategoria: Map<string, string>;
  agendaGeracao: number;

  agendaEventoId: string | null;
  agendaEventoDetalhe: EventoDetalhe | null;
  agendaEventoGeracao: number;

  // Formulário de criar/editar (#211) — estado só de sessão.
  agendaFormAberto: boolean;
  agendaFormModo: "criar" | "editar";
  agendaFormEvento: EventoAgenda | null;
  agendaFormInicio: string | null; // preset ao criar clicando num dia/slot

  setAgendaDia: (dia: Date) => void;
  setAgendaView: (view: AgendaViewTipo) => void;
  carregarMesAgenda: (inicio: string, fim: string) => Promise<void>;
  recarregarAgenda: () => void;
  carregarCoresAgenda: () => Promise<void>;
  selecionarEventoAgenda: (id: string) => Promise<void>;
  fecharEventoAgenda: () => void;

  abrirFormCriar: (inicio?: string) => void;
  abrirFormEditar: (ev: EventoAgenda) => void;
  fecharForm: () => void;
  // Escrita otimista + rollback (#211): a UI mostra o toast se a promise rejeitar.
  criarEvento: (input: EventoInput) => Promise<void>;
  editarEvento: (id: string, input: EventoInput) => Promise<void>;
  excluirEvento: (id: string) => Promise<void>;
}

const agendaApi: AgendaApi = {
  carregarEventos: crAgenda,
  carregarCategorias: crCategorias,
  carregarEvento: crEventoCorpo,
  criarEvento: crCriarEvento,
  editarEvento: crEditarEvento,
  excluirEvento: crExcluirEvento,
};

/** Converte hora-de-parede local (sem Z) para ISO UTC, para o calendário
 *  posicionar o evento otimista no dia/horário certo do fuso local. */
function localParaUtc(wall: string): string {
  const d = new Date(wall); // sem Z + com hora => interpretado como local
  return Number.isNaN(d.getTime()) ? wall : d.toISOString();
}

/** Monta um EventoAgenda de exibição a partir dos dados do formulário. */
function eventoDeInput(id: string, input: EventoInput): EventoAgenda {
  return {
    id,
    assunto: input.assunto,
    inicio: localParaUtc(input.inicio),
    fim: localParaUtc(input.fim),
    local: input.local,
    online: false,
    diaInteiro: input.diaInteiro,
    categoria: "event",
    participantes: [],
    totalParticipantes: 0,
    temAnexos: false,
    categorias: input.categorias,
  };
}

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
    agendaView: "month",
    agendaEventosMes: null,
    agendaErro: null,
    agendaRecarga: 0,
    agendaCoresCategoria: new Map(),
    agendaGeracao: 0,

    agendaEventoId: null,
    agendaEventoDetalhe: null,
    agendaEventoGeracao: 0,

    agendaFormAberto: false,
    agendaFormModo: "criar",
    agendaFormEvento: null,
    agendaFormInicio: null,

    setAgendaDia: (dia) => set({ agendaDia: dia }),

    setAgendaView: (view) => set({ agendaView: view }),

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

    abrirFormCriar: (inicio) =>
      set({
        agendaFormAberto: true,
        agendaFormModo: "criar",
        agendaFormEvento: null,
        agendaFormInicio: inicio ?? null,
      }),

    abrirFormEditar: (ev) =>
      set({
        agendaFormAberto: true,
        agendaFormModo: "editar",
        agendaFormEvento: ev,
        agendaFormInicio: null,
      }),

    fecharForm: () => set({ agendaFormAberto: false }),

    // Otimista: insere já na lista do mês; troca o id temporário pelo real no
    // sucesso, ou remove o otimista e propaga o erro (a UI toasta) na falha.
    criarEvento: async (input) => {
      const tempId = `temp-${Date.now()}`;
      const otimista = eventoDeInput(tempId, input);
      const antes = get().agendaEventosMes ?? [];
      set({ agendaEventosMes: [...antes, otimista] });
      try {
        const realId = await api.criarEvento(input);
        set((s) => ({
          agendaEventosMes: (s.agendaEventosMes ?? []).map((e) =>
            e.id === tempId ? { ...e, id: realId || e.id } : e,
          ),
        }));
      } catch (erro) {
        set((s) => ({
          agendaEventosMes: (s.agendaEventosMes ?? []).filter(
            (e) => e.id !== tempId,
          ),
        }));
        throw erro;
      }
    },

    // Otimista: aplica o patch na lista; restaura o evento original na falha.
    editarEvento: async (id, input) => {
      const antes = get().agendaEventosMes ?? [];
      const original = antes.find((e) => e.id === id);
      set({
        agendaEventosMes: antes.map((e) =>
          e.id === id ? { ...e, ...eventoDeInput(id, input) } : e,
        ),
      });
      try {
        await api.editarEvento(id, input);
      } catch (erro) {
        if (original) {
          set((s) => ({
            agendaEventosMes: (s.agendaEventosMes ?? []).map((e) =>
              e.id === id ? original : e,
            ),
          }));
        }
        throw erro;
      }
    },

    // Otimista: remove da lista; restaura a lista anterior na falha.
    excluirEvento: async (id) => {
      const antes = get().agendaEventosMes ?? [];
      set({ agendaEventosMes: antes.filter((e) => e.id !== id) });
      try {
        await api.excluirEvento(id);
      } catch (erro) {
        set({ agendaEventosMes: antes });
        throw erro;
      }
    },
  });
}

export const createAgendaSlice = criarAgendaSlice();
