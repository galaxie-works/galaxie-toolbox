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
});

const detalhe = (assunto: string): EventoDetalhe => ({
  assunto,
  inicio: "2026-07-29T09:00:00",
  fim: "2026-07-29T10:00:00",
  local: "Teams",
  online: true,
  organizador: "Galaxie",
  corpo: "<p>Pauta</p>",
  corpoTipo: "html",
  participantes: [],
  webLink: "https://outlook.office.com",
});

function criarStore(api: Parameters<typeof criarAgendaSlice>[0]) {
  const state = {} as AgendaSlice;
  const set = (
    update:
      | Partial<AgendaSlice>
      | ((atual: AgendaSlice) => Partial<AgendaSlice>),
  ) => Object.assign(state, typeof update === "function" ? update(state) : update);
  return Object.assign(
    state,
    criarAgendaSlice(api)(set as never, (() => state) as never, {} as never),
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
  assert.equal(store.agendaEventosMes, null);

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
