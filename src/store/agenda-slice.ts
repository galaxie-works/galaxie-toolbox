import type { StateCreator } from "zustand";

import {
  crAgenda,
  crAgendaCalendario,
  crCalendarios,
  crCategorias,
  crCriarCategoria,
  crCancelarEvento,
  crCriarEvento,
  crEditarEvento,
  crEventoCorpo,
  crExcluirEvento,
} from "../lib/api.ts";
import type {
  Calendario,
  CategoriaCor,
  EventoAgenda,
  EventoDetalhe,
  EventoInput,
  Participante,
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

/** Chaves reais no localStorage das preferências persistidas da agenda. */
export const AGENDA_KEYS = {
  agendaView: "agenda.view",
  // Seleção de calendários (#233): array de ids, ou `null` (não inicializado).
  agendaCalendariosSel: "agenda.calendarios.selecao",
} as const;

/** O que a agenda persiste entre sessões: view + seleção de calendários. */
export interface AgendaPersistido {
  agendaView: AgendaViewTipo;
  agendaCalendariosSelecionados: string[] | null;
}

interface AgendaApi {
  carregarEventos: (inicio: string, fim: string) => Promise<EventoAgenda[]>;
  carregarEventosCalendario: (
    calendarioId: string,
    inicio: string,
    fim: string,
  ) => Promise<EventoAgenda[]>;
  listarCalendarios: () => Promise<Calendario[]>;
  carregarCategorias: () => Promise<CategoriaCor[]>;
  criarCategoria: (nome: string, preset: string) => Promise<CategoriaCor>;
  carregarEvento: (id: string) => Promise<EventoDetalhe>;
  criarEvento: (input: EventoInput) => Promise<string>;
  editarEvento: (id: string, input: EventoInput) => Promise<void>;
  excluirEvento: (id: string) => Promise<void>;
  cancelarEvento: (id: string, comentario: string) => Promise<void>;
}

export interface AgendaSlice {
  agendaDia: Date;
  agendaView: AgendaViewTipo; // preferência persistida (mês/semana/dia/agenda)
  agendaEventosMes: EventoAgenda[] | null;
  agendaErro: string | null;
  agendaRecarga: number;
  agendaCoresCategoria: Map<string, string>;
  agendaGeracao: number;

  // Calendários do usuário (#233): lista + seleção ativa (persistida). `null` na
  // seleção = ainda não inicializada (usa o padrão até os calendários carregarem).
  agendaCalendarios: Calendario[] | null;
  agendaCalendariosErro: string | null;
  agendaCalendariosSelecionados: string[] | null;

  agendaEventoId: string | null;
  agendaEventoDetalhe: EventoDetalhe | null;
  agendaEventoGeracao: number;

  // Formulário de criar/editar (#211) — estado só de sessão.
  agendaFormAberto: boolean;
  agendaFormModo: "criar" | "editar";
  agendaFormEvento: EventoAgenda | null;
  agendaFormInicio: string | null; // preset ao criar clicando num dia/slot
  // Convidados COMPLETOS do evento em edição (#240). O resumo do mês
  // (`agendaFormEvento.participantes`) trunca em 5 e o PATCH substitui a coleção
  // de attendees; então, ao abrir o Sheet de edição, buscamos os attendees
  // completos (`carregarEvento`/cr_evento_corpo) e o form popula a partir daqui.
  // `null` = criar / ainda sem seed. `agendaFormConvidadosCarregando` bloqueia o
  // salvar até a lista completa chegar (senão o save perderia convidados >5).
  agendaFormConvidados: Participante[] | null;
  agendaFormConvidadosCarregando: boolean;
  agendaFormGeracao: number;

  setAgendaDia: (dia: Date) => void;
  setAgendaView: (view: AgendaViewTipo) => void;
  carregarMesAgenda: (inicio: string, fim: string) => Promise<void>;
  // Lista os calendários (#233) e, na 1ª vez, seleciona o padrão.
  carregarCalendarios: () => Promise<void>;
  // Liga/desliga um calendário na seleção e re-busca os eventos.
  alternarCalendario: (id: string) => void;
  recarregarAgenda: () => void;
  carregarCoresAgenda: () => Promise<void>;
  // Cria uma categoria mestra e a injeta no mapa de cores (#211). Devolve o
  // nome criado para o form já selecioná-la.
  criarCategoria: (nome: string, preset: string) => Promise<string>;
  selecionarEventoAgenda: (id: string) => Promise<void>;
  fecharEventoAgenda: () => void;

  abrirFormCriar: (inicio?: string) => void;
  // Abre o form de edição e dispara a busca dos attendees COMPLETOS (#240).
  abrirFormEditar: (ev: EventoAgenda) => void;
  fecharForm: () => void;
  // Escrita otimista + rollback (#211): a UI mostra o toast se a promise rejeitar.
  criarEvento: (input: EventoInput) => Promise<void>;
  editarEvento: (id: string, input: EventoInput) => Promise<void>;
  excluirEvento: (id: string) => Promise<void>;
  // Cancela (notifica os convidados), distinto de excluir (silencioso) (#260).
  cancelarEvento: (id: string, comentario: string) => Promise<void>;
}

const agendaApi: AgendaApi = {
  carregarEventos: crAgenda,
  carregarEventosCalendario: crAgendaCalendario,
  listarCalendarios: crCalendarios,
  carregarCategorias: crCategorias,
  criarCategoria: crCriarCategoria,
  carregarEvento: crEventoCorpo,
  criarEvento: crCriarEvento,
  editarEvento: crEditarEvento,
  excluirEvento: crExcluirEvento,
  cancelarEvento: crCancelarEvento,
};

/** Converte hora-de-parede local (sem Z) para ISO UTC, para o calendário
 *  posicionar o evento otimista no dia/horário certo do fuso local. */
function localParaUtc(wall: string): string {
  const d = new Date(wall); // sem Z + com hora => interpretado como local
  return Number.isNaN(d.getTime()) ? wall : d.toISOString();
}

/** Iniciais a partir de nome/e-mail (fallback do avatar otimista). */
function iniciaisDe(nome: string, email: string): string {
  const base = nome && !nome.includes("@") ? nome : email.split("@")[0];
  const partes = base.split(/[\s._-]+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** Monta um EventoAgenda de exibição a partir dos dados do formulário. */
function eventoDeInput(id: string, input: EventoInput): EventoAgenda {
  const participantes = input.convidados.map((c) => ({
    nome: c.nome || c.email,
    email: c.email,
    iniciais: iniciaisDe(c.nome, c.email),
    foto: null,
  }));
  return {
    id,
    assunto: input.assunto,
    inicio: localParaUtc(input.inicio),
    fim: localParaUtc(input.fim),
    local: input.local,
    online: input.reuniaoTeams,
    diaInteiro: input.diaInteiro,
    categoria: participantes.length > 0 ? "meeting" : "event",
    participantes,
    totalParticipantes: participantes.length,
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

    agendaCalendarios: null,
    agendaCalendariosErro: null,
    agendaCalendariosSelecionados: null,

    agendaEventoId: null,
    agendaEventoDetalhe: null,
    agendaEventoGeracao: 0,

    agendaFormAberto: false,
    agendaFormModo: "criar",
    agendaFormEvento: null,
    agendaFormInicio: null,
    agendaFormConvidados: null,
    agendaFormConvidadosCarregando: false,
    agendaFormGeracao: 0,

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
        const sel = get().agendaCalendariosSelecionados;
        const cals = get().agendaCalendarios ?? [];
        let eventos: EventoAgenda[];
        if (sel === null || cals.length === 0) {
          // Ainda não inicializado (ou lista vazia): calendário padrão (#211).
          eventos = await api.carregarEventos(inicio, fim);
        } else {
          const alvos = cals.filter((c) => sel.includes(c.id));
          if (alvos.length === 0) {
            // Usuário desmarcou tudo → nada a exibir (estado vazio).
            eventos = [];
          } else {
            // Merge dos eventos de cada calendário, marcando cada evento com o
            // id e a cor do seu calendário de origem (#233).
            const listas = await Promise.all(
              alvos.map(async (c) => {
                const evs = await api.carregarEventosCalendario(c.id, inicio, fim);
                return evs.map((e) => ({
                  ...e,
                  calendarioId: c.id,
                  corCalendario: c.cor,
                }));
              }),
            );
            eventos = listas.flat();
          }
        }
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

    carregarCalendarios: async () => {
      set({ agendaCalendariosErro: null });
      try {
        const cals = await api.listarCalendarios();
        set({ agendaCalendarios: cals });
        // 1ª carga: sem seleção persistida, começa no calendário padrão.
        if (get().agendaCalendariosSelecionados === null) {
          const padrao = cals.find((c) => c.isDefaultCalendar) ?? cals[0];
          if (padrao) set({ agendaCalendariosSelecionados: [padrao.id] });
        }
        // Re-busca para refletir a seleção (agora por calendário, com cores).
        get().recarregarAgenda();
      } catch (erro) {
        set({ agendaCalendarios: [], agendaCalendariosErro: String(erro) });
      }
    },

    alternarCalendario: (id) => {
      set((s) => {
        const atual = s.agendaCalendariosSelecionados ?? [];
        const prox = atual.includes(id)
          ? atual.filter((x) => x !== id)
          : [...atual, id];
        return { agendaCalendariosSelecionados: prox };
      });
      get().recarregarAgenda();
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

    criarCategoria: async (nome, preset) => {
      const criada = await api.criarCategoria(nome, preset);
      set((s) => {
        const mapa = new Map(s.agendaCoresCategoria);
        mapa.set(criada.nome, criada.cor);
        return { agendaCoresCategoria: mapa };
      });
      return criada.nome;
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
      set((s) => ({
        agendaFormAberto: true,
        agendaFormModo: "criar",
        agendaFormEvento: null,
        agendaFormInicio: inicio ?? null,
        // Criar não tem attendees pré-existentes; invalida qualquer busca de
        // edição ainda em voo (#240).
        agendaFormConvidados: null,
        agendaFormConvidadosCarregando: false,
        agendaFormGeracao: s.agendaFormGeracao + 1,
      })),

    // Ao editar, buscamos os attendees COMPLETOS antes de o form montar o PATCH
    // (#240): `ev.participantes` vem do resumo do mês truncado em 5, e o PATCH
    // /me/events/{id} substitui a coleção — sem a lista completa, editar um
    // evento com >5 convidados perderia os demais. Fazemos um seed imediato com
    // o que temos (até 5) e substituímos pela lista completa do detalhe
    // (cr_evento_corpo, mesmo caminho do #34) assim que ela chega; o salvar fica
    // bloqueado enquanto carrega. Guardado por geração (mesma técnica do #211).
    abrirFormEditar: (ev) => {
      const geracao = get().agendaFormGeracao + 1;
      set({
        agendaFormAberto: true,
        agendaFormModo: "editar",
        agendaFormEvento: ev,
        agendaFormInicio: null,
        agendaFormConvidados: ev.participantes,
        agendaFormConvidadosCarregando: true,
        agendaFormGeracao: geracao,
      });
      void (async () => {
        try {
          const detalhe = await api.carregarEvento(ev.id);
          const atual = get();
          if (
            atual.agendaFormGeracao === geracao &&
            atual.agendaFormEvento?.id === ev.id
          ) {
            set({
              agendaFormConvidados: detalhe.participantes,
              agendaFormConvidadosCarregando: false,
            });
          }
        } catch {
          // Detalhe é o mesmo GET do #34; se falhar, libera o salvar com o seed
          // truncado (não travar a edição) — best-effort como o resto (#211).
          if (get().agendaFormGeracao === geracao) {
            set({ agendaFormConvidadosCarregando: false });
          }
        }
      })();
    },

    fecharForm: () => set({ agendaFormAberto: false }),

    // Otimista: insere já na lista do mês; troca o id temporário pelo real no
    // sucesso, ou remove o otimista e propaga o erro (a UI toasta) na falha.
    criarEvento: async (input) => {
      const tempId = `temp-${Date.now()}`;
      const otimista = eventoDeInput(tempId, input);
      // Marca o evento otimista com a cor do calendário-alvo (#233) para casar
      // com o merge multi-calendário na hora de renderizar.
      const calAlvo = input.calendarioId
        ? (get().agendaCalendarios ?? []).find((c) => c.id === input.calendarioId)
        : undefined;
      if (calAlvo) {
        otimista.calendarioId = calAlvo.id;
        otimista.corCalendario = calAlvo.cor;
      }
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

    // Cancela um evento organizado pelo usuário (#260): notifica os convidados
    // com o cancelamento (POST /events/{id}/cancel) e remove o evento. Mesma
    // remoção otimista + rollback do excluir; a distinção é a notificação.
    cancelarEvento: async (id, comentario) => {
      const antes = get().agendaEventosMes ?? [];
      set({ agendaEventosMes: antes.filter((e) => e.id !== id) });
      try {
        await api.cancelarEvento(id, comentario);
      } catch (erro) {
        set({ agendaEventosMes: antes });
        throw erro;
      }
    },
  });
}

export const createAgendaSlice = criarAgendaSlice();
