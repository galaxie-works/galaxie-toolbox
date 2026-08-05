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
  crResponderEvento,
} from "../lib/api.ts";
import { podeGerenciarEvento } from "../lib/agenda-permissions.ts";
import type {
  AcaoRsvp,
  Calendario,
  CategoriaCor,
  EventoAgenda,
  EventoDetalhe,
  EventoInput,
  Participante,
  RespostaConvite,
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
  // #495: `mailbox` opcional (undefined/"me" = própria; endereço = compartilhada).
  carregarEventos: (
    inicio: string,
    fim: string,
    mailbox?: string,
  ) => Promise<EventoAgenda[]>;
  carregarEventosCalendario: (
    calendarioId: string,
    inicio: string,
    fim: string,
    mailbox?: string,
  ) => Promise<EventoAgenda[]>;
  listarCalendarios: (mailbox?: string) => Promise<Calendario[]>;
  carregarCategorias: () => Promise<CategoriaCor[]>;
  criarCategoria: (nome: string, preset: string) => Promise<CategoriaCor>;
  carregarEvento: (id: string) => Promise<EventoDetalhe>;
  criarEvento: (input: EventoInput) => Promise<string>;
  editarEvento: (id: string, input: EventoInput) => Promise<void>;
  excluirEvento: (id: string) => Promise<void>;
  cancelarEvento: (id: string, comentario: string) => Promise<void>;
  responderEvento: (
    id: string,
    resposta: AcaoRsvp,
    enviarResposta: boolean,
    comentario: string,
  ) => Promise<void>;
}

export interface AgendaSlice {
  agendaDia: Date;
  agendaView: AgendaViewTipo; // preferência persistida (mês/semana/dia/agenda)
  agendaEventosMes: EventoAgenda[] | null;
  agendaErro: string | null;
  agendaRecarga: number;
  agendaCoresCategoria: Map<string, string>;
  agendaGeracao: number;
  /** #495: a QUAL caixa (`caixaAtiva`, "me" = própria) os eventos/calendários
   *  carregados pertencem. O control-room dispara recarga quando muda. */
  agendaCaixaDados: string;

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
  // #397: ao editar um recorrente, o escopo escolhido no Edit (ocorrência ×
  // série) — decidido ANTES de abrir o form. `null` = não recorrente / criar.
  agendaFormEscopo: "ocorrencia" | "serie" | null;
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
  abrirFormEditar: (
    ev: EventoAgenda,
    escopo?: "ocorrencia" | "serie",
  ) => void;
  fecharForm: () => void;
  // Escrita otimista + rollback (#211): a UI mostra o toast se a promise rejeitar.
  criarEvento: (input: EventoInput) => Promise<void>;
  editarEvento: (id: string, input: EventoInput) => Promise<void>;
  excluirEvento: (id: string) => Promise<void>;
  // Cancela (notifica os convidados), distinto de excluir (silencioso) (#260).
  cancelarEvento: (id: string, comentario: string) => Promise<void>;
  // RSVP a um convite (#287): Aceitar/Talvez/Recusar. Otimista no detalhe + na
  // lista do mês (rollback na falha); a UI toasta o resultado.
  responderEvento: (
    id: string,
    resposta: AcaoRsvp,
    enviarResposta: boolean,
    comentario: string,
  ) => Promise<void>;

  // #555: zera todo o estado tenant-scoped da agenda ao trocar de conta (não
  // toca em `agendaView`, que é preferência persistida).
  resetSessaoAgenda: () => void;
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
  responderEvento: crResponderEvento,
};

/** Estado de `responseStatus` resultante de uma ação de RSVP (#287): usado no
 *  update otimista do detalhe e da lista antes do refetch confirmar. */
const RSVP_PARA_RESPOSTA: Record<AcaoRsvp, RespostaConvite> = {
  accept: "accepted",
  tentativelyAccept: "tentativelyAccepted",
  decline: "declined",
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
    // #397: evento otimista reflete o Graph `type` — com recorrência é a série
    // mãe, senão instância única. Sem isso o mock/optimista não bate EventoAgenda.
    tipo: input.recorrencia ? "seriesMaster" : "singleInstance",
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
    // Evento criado/editado pelo próprio usuário: organizador, sem RSVP (#287).
    resposta: "organizer",
    souOrganizador: true,
    // #570: otimista não tem o e-mail do organizador em escopo; o auto-refresh
    // (#396) traz o EventoAgenda real do Graph com o organizadorEmail.
    organizadorEmail: "",
    respostaSolicitada: false,
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
    agendaCaixaDados: "me",

    agendaCalendarios: null,
    agendaCalendariosErro: null,
    agendaCalendariosSelecionados: null,

    agendaEventoId: null,
    agendaEventoDetalhe: null,
    agendaEventoGeracao: 0,

    agendaFormAberto: false,
    agendaFormModo: "criar",
    agendaFormEvento: null,
    agendaFormEscopo: null,
    agendaFormInicio: null,
    agendaFormConvidados: null,
    agendaFormConvidadosCarregando: false,
    agendaFormGeracao: 0,

    // #555: volta todo o estado tenant-scoped ao inicial do slice; as gerações
    // são incrementadas (não zeradas) pra invalidar qualquer fetch em voo.
    resetSessaoAgenda: () =>
      set({
        agendaDia: new Date(),
        agendaEventosMes: null,
        agendaErro: null,
        agendaRecarga: 0,
        agendaCoresCategoria: new Map(),
        agendaGeracao: get().agendaGeracao + 1,
        agendaCaixaDados: "me",
        agendaCalendarios: null,
        agendaCalendariosErro: null,
        agendaCalendariosSelecionados: null,
        agendaEventoId: null,
        agendaEventoDetalhe: null,
        agendaEventoGeracao: get().agendaEventoGeracao + 1,
        agendaFormAberto: false,
        agendaFormModo: "criar",
        agendaFormEvento: null,
        agendaFormEscopo: null,
        agendaFormInicio: null,
        agendaFormConvidados: null,
        agendaFormConvidadosCarregando: false,
        agendaFormGeracao: get().agendaFormGeracao + 1,
      }),

    setAgendaDia: (dia) => set({ agendaDia: dia }),

    setAgendaView: (view) => set({ agendaView: view }),

    carregarMesAgenda: async (inicio, fim) => {
      // #495: eventos seguem a caixa selecionada. `agendaEventosMes: null` já
      // limpa a lista da caixa anterior na hora (estado de loading), então não
      // há vazamento visual ao trocar.
      const caixa = get().caixaAtiva;
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
          eventos = await api.carregarEventos(inicio, fim, caixa);
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
                const evs = await api.carregarEventosCalendario(
                  c.id,
                  inicio,
                  fim,
                  caixa,
                );
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
        // Guarda anti-leak: só aplica se a geração E a caixa ainda batem.
        if (get().agendaGeracao === geracao && get().caixaAtiva === caixa) {
          set({ agendaEventosMes: eventos, agendaCaixaDados: caixa });
        }
      } catch (erro) {
        if (get().agendaGeracao === geracao && get().caixaAtiva === caixa) {
          set({
            agendaErro: String(erro),
            agendaEventosMes: [],
            agendaCaixaDados: caixa,
          });
        }
      }
    },

    carregarCalendarios: async () => {
      // #495: calendários são da caixa selecionada (/me ou /users/{addr}).
      const caixa = get().caixaAtiva;
      set({ agendaCalendariosErro: null });
      try {
        const cals = await api.listarCalendarios(caixa);
        if (get().caixaAtiva !== caixa) return;
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
        agendaFormEscopo: null,
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
    abrirFormEditar: (ev, escopo) => {
      // Convidados só podem responder ao convite. Este guard mantém a regra do
      // detalhe e do menu de contexto mesmo se outro caller tentar abrir o form.
      if (!podeGerenciarEvento(ev)) return;
      const geracao = get().agendaFormGeracao + 1;
      set({
        agendaFormAberto: true,
        agendaFormModo: "editar",
        agendaFormEvento: ev,
        // #397: o escopo é decidido no Edit (menu ocorrência × série) e o form
        // apenas o respeita ao salvar — sem prompt no meio do fluxo de save.
        agendaFormEscopo: escopo ?? null,
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
        // #396: recarrega o range após criar — o otimista mostra 1 evento, mas
        // uma SÉRIE recorrente só aparece expandida (calendarView) após refetch;
        // e garante que o evento único reflita sem sair/voltar da agenda.
        get().recarregarAgenda();
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
          e.id === id
            ? {
                ...e,
                ...eventoDeInput(id, input),
                // Preserva o tipo real (recorrente) + a série no update otimista.
                tipo: e.tipo,
                seriesMasterId: e.seriesMasterId,
              }
            : e,
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

    // RSVP a um convite (#287): POST /events/{id}/{accept|tentativelyAccept|
    // decline}. Otimista — reflete o novo `responseStatus` no detalhe aberto e
    // no evento da lista do mês; restaura ambos na falha (mesmo padrão do
    // cancelar/excluir). O refetch pós-escrita reconcilia com o servidor.
    responderEvento: async (id, resposta, enviarResposta, comentario) => {
      const novaResposta = RSVP_PARA_RESPOSTA[resposta];
      const detalheAntes = get().agendaEventoDetalhe;
      const eventosAntes = get().agendaEventosMes ?? [];
      set((s) => ({
        agendaEventoDetalhe:
          s.agendaEventoDetalhe && s.agendaEventoId === id
            ? { ...s.agendaEventoDetalhe, resposta: novaResposta }
            : s.agendaEventoDetalhe,
        agendaEventosMes: (s.agendaEventosMes ?? []).map((e) =>
          e.id === id ? { ...e, resposta: novaResposta } : e,
        ),
      }));
      try {
        await api.responderEvento(id, resposta, enviarResposta, comentario);
      } catch (erro) {
        set({
          agendaEventoDetalhe: detalheAntes,
          agendaEventosMes: eventosAntes,
        });
        throw erro;
      }
    },
  });
}

export const createAgendaSlice = criarAgendaSlice();
