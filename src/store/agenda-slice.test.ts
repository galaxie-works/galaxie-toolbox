import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  CategoriaCor,
  EventoAgenda,
  EventoDetalhe,
} from "../lib/types.ts";
import {
  criarAgendaSlice,
  type AgendaSlice,
} from "./agenda-slice.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const evento = (id: string): EventoAgenda => ({
  id,
  assunto: id,
  inicio: "2026-07-29T09:00:00",
  fim: "2026-07-29T10:00:00",
  local: "Teams",
  online: true,
  diaInteiro: false,
  categoria: "meeting",
  participantes: [],
  totalParticipantes: 0,
  temAnexos: false,
  categorias: [],
  resposta: "organizer",
  souOrganizador: true,
  respostaSolicitada: false,
  organizadorEmail: "contato@galaxie.works",
  tipo: "singleInstance",
});

const detalhe = (assunto: string): EventoDetalhe => ({
  assunto,
  inicio: "2026-07-29T09:00:00",
  fim: "2026-07-29T10:00:00",
  local: "Teams",
  online: true,
  organizador: "Galaxie",
  organizadorEmail: "contato@galaxie.works",
  souOrganizador: true,
  resposta: "organizer",
  respostaSolicitada: false,
  corpo: "<p>Pauta</p>",
  corpoTipo: "html",
  participantes: [],
  webLink: "https://outlook.office.com",
});

// Base completa da AgendaApi: no-ops realistas pra cada método. Cada teste passa
// só o subconjunto que exercita; o resto vem daqui (mock completo, sem `as any`).
const apiBase: Parameters<typeof criarAgendaSlice>[0] = {
  carregarEventos: async () => [],
  carregarEventosCalendario: async () => [],
  listarCalendarios: async () => [],
  carregarCategorias: async () => [],
  criarCategoria: async (nome) => ({ nome, cor: "#4f46e5" }),
  carregarEvento: async () => detalhe("evento"),
  criarEvento: async () => "evento-1",
  editarEvento: async () => {},
  reagendarEvento: async () => {},
  excluirEvento: async () => {},
  cancelarEvento: async () => {},
  responderEvento: async () => {},
};

function criarStore(
  api: Partial<Parameters<typeof criarAgendaSlice>[0]> = {},
) {
  const state = {} as AgendaSlice;
  const set = (
    update:
      | Partial<AgendaSlice>
      | ((atual: AgendaSlice) => Partial<AgendaSlice>),
  ) => Object.assign(state, typeof update === "function" ? update(state) : update);
  return Object.assign(
    state,
    criarAgendaSlice(
      { ...apiBase, ...api } as Parameters<typeof criarAgendaSlice>[0],
    )(set as never, (() => state) as never, {} as never),
  );
}

test("month generation ignores an older calendarView response", async () => {
  const pedidos = new Map<string, ReturnType<typeof deferred<EventoAgenda[]>>>();
  const store = criarStore({
    carregarEventos: (inicio) => {
      const pedido = deferred<EventoAgenda[]>();
      pedidos.set(inicio, pedido);
      return pedido.promise;
    },
    carregarCategorias: async () => [],
    carregarEvento: async () => detalhe("evento"),
  });

  const antigo = store.carregarMesAgenda("julho", "agosto");
  const atual = store.carregarMesAgenda("agosto", "setembro");
  pedidos.get("julho")!.resolve([evento("antigo")]);
  await antigo;
  // Lido num local pra o `asserts actual is null` do node não estreitar a
  // propriedade do store — que o refetch abaixo repovoa — pra `null` permanente.
  const aposAntigo = store.agendaEventosMes;
  assert.equal(aposAntigo, null);

  pedidos.get("agosto")!.resolve([evento("atual")]);
  await atual;
  assert.deepEqual(store.agendaEventosMes?.map((item) => item.id), ["atual"]);
});

test("calendar error remains distinct from an empty month and retry is session state", async () => {
  const store = criarStore({
    carregarEventos: async () => {
      throw new Error("calendarView 403");
    },
    carregarCategorias: async () => [],
    carregarEvento: async () => detalhe("evento"),
  });

  await store.carregarMesAgenda("inicio", "fim");
  assert.match(store.agendaErro ?? "", /calendarView 403/);
  assert.deepEqual(store.agendaEventosMes, []);
  store.recarregarAgenda();
  assert.equal(store.agendaRecarga, 1);
});

test("closing an event invalidates its in-flight detail and categories stay mapped", async () => {
  const eventoPendente = deferred<EventoDetalhe>();
  const categorias: CategoriaCor[] = [{ nome: "Crítico", cor: "#d13438" }];
  const store = criarStore({
    carregarEventos: async () => [],
    carregarCategorias: async () => categorias,
    carregarEvento: async () => eventoPendente.promise,
  });

  await store.carregarCoresAgenda();
  assert.equal(store.agendaCoresCategoria.get("Crítico"), "#d13438");

  const carga = store.selecionarEventoAgenda("ev-1");
  store.fecharEventoAgenda();
  eventoPendente.resolve(detalhe("não deve aparecer"));
  await carga;
  assert.equal(store.agendaEventoId, null);
  assert.equal(store.agendaEventoDetalhe, null);
});

test("#396 creating an event refreshes the range so a new series shows at once", async () => {
  let criados = 0;
  const store = criarStore({
    carregarEventos: async () => [],
    carregarCategorias: async () => [],
    carregarEvento: async () => detalhe("evento"),
    criarEvento: async () => {
      criados += 1;
      return "real-1";
    },
  });

  const recargaAntes = store.agendaRecarga;
  await store.criarEvento({
    assunto: "Daily",
    inicio: "2026-08-05T09:00:00",
    fim: "2026-08-05T09:30:00",
    diaInteiro: false,
    local: "",
    corpo: "",
    categorias: [],
    timeZone: "America/Sao_Paulo",
    convidados: [],
    reuniaoTeams: false,
    recorrencia: { tipo: "daily", intervalo: 1 },
  } as never);

  assert.equal(criados, 1);
  // O otimista troca o tempId pelo real e dispara o refetch do range (#396).
  assert.equal(store.agendaRecarga, recargaAntes + 1);
});

test("#397 opening the edit form keeps the chosen recurrence scope", () => {
  const store = criarStore({
    carregarEventos: async () => [],
    carregarCategorias: async () => [],
    carregarEvento: async () => detalhe("evento"),
  });
  const recorrente: EventoAgenda = {
    ...evento("occ-1"),
    tipo: "occurrence",
    seriesMasterId: "master-1",
  };

  store.abrirFormEditar(recorrente, "serie");
  assert.equal(store.agendaFormAberto, true);
  assert.equal(store.agendaFormEscopo, "serie");

  store.abrirFormEditar(recorrente, "ocorrencia");
  assert.equal(store.agendaFormEscopo, "ocorrencia");

  // Sem escopo (evento único) volta a null.
  store.abrirFormEditar(evento("single"));
  assert.equal(store.agendaFormEscopo, null);
});

test("an invited attendee cannot open the organizer edit flow", () => {
  let detalhesCarregados = 0;
  const store = criarStore({
    carregarEventos: async () => [],
    carregarCategorias: async () => [],
    carregarEvento: async () => {
      detalhesCarregados += 1;
      return detalhe("evento");
    },
  });
  const convite: EventoAgenda = {
    ...evento("convite"),
    resposta: "notResponded",
    souOrganizador: false,
    respostaSolicitada: true,
  };

  store.abrirFormEditar(convite);

  assert.equal(store.agendaFormAberto, false);
  assert.equal(store.agendaFormEvento, null);
  assert.equal(detalhesCarregados, 0);
});

test("#213 dragging reschedules optimistically and forwards only timing", async () => {
  let chamada: {
    id: string;
    inicio: string;
    fim: string;
    diaInteiro: boolean;
    tz: string;
  } | null = null;
  const store = criarStore({
    carregarEventos: async () => [],
    carregarCategorias: async () => [],
    carregarEvento: async () => detalhe("evento"),
    reagendarEvento: async (id, inicio, fim, diaInteiro, tz) => {
      chamada = { id, inicio, fim, diaInteiro, tz };
    },
  });
  store.agendaEventosMes = [evento("ev1")];

  await store.reagendarEvento(
    "ev1",
    "2026-07-29T14:00:00",
    "2026-07-29T15:00:00",
    false,
    "America/Sao_Paulo",
  );

  // Otimista: o evento na lista já está no novo horário (guardado como ISO UTC).
  const ev = store.agendaEventosMes![0];
  assert.equal(
    new Date(ev.inicio).getTime(),
    new Date("2026-07-29T14:00:00").getTime(),
  );
  assert.equal(
    new Date(ev.fim).getTime(),
    new Date("2026-07-29T15:00:00").getTime(),
  );
  assert.equal(ev.diaInteiro, false);
  // Convidados/corpo intactos: só início/fim/dia-inteiro vão pro Graph.
  assert.deepEqual(chamada, {
    id: "ev1",
    inicio: "2026-07-29T14:00:00",
    fim: "2026-07-29T15:00:00",
    diaInteiro: false,
    tz: "America/Sao_Paulo",
  });
});

test("#213 a failed reschedule rolls back to the original event", async () => {
  const store = criarStore({
    carregarEventos: async () => [],
    carregarCategorias: async () => [],
    carregarEvento: async () => detalhe("evento"),
    reagendarEvento: async () => {
      throw new Error("PATCH 500");
    },
  });
  const original = evento("ev1");
  store.agendaEventosMes = [original];

  await assert.rejects(
    store.reagendarEvento(
      "ev1",
      "2026-07-29T14:00:00",
      "2026-07-29T15:00:00",
      false,
      "America/Sao_Paulo",
    ),
  );

  // Rollback: restaura o evento original (mesma referência), sem escrita fantasma.
  assert.equal(store.agendaEventosMes![0], original);
  assert.equal(store.agendaEventosMes![0].inicio, "2026-07-29T09:00:00");
});
