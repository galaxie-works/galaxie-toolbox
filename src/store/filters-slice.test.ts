import assert from "node:assert/strict";
import { test } from "node:test";

import type { DateSelectorValue } from "../components/reui/date-selector.ts";
import type { Filter } from "../components/reui/filters.tsx";
import type { EmailItem } from "../lib/types.ts";
import {
  createFiltersSlice,
  escopoDeFiltros,
  passaFiltrosClient,
  serializarDataFiltro,
  type FiltersSlice,
} from "./filters-slice.ts";

function criarStoreDeTeste(): FiltersSlice {
  const state = {} as FiltersSlice;
  const set = (
    update:
      | Partial<FiltersSlice>
      | ((atual: FiltersSlice) => Partial<FiltersSlice>),
  ) => {
    Object.assign(state, typeof update === "function" ? update(state) : update);
  };
  const slice = createFiltersSlice(
    set as never,
    (() => state) as never,
    {} as never,
  );
  return Object.assign(state, slice);
}

function mensagem(overrides: Partial<EmailItem> = {}): EmailItem {
  return {
    id: "m-1",
    assunto: "Planejamento",
    de: "Ana",
    deEmail: "ana@galaxie.works",
    iniciais: "AN",
    recebido: "2026-07-15T15:00:00",
    preview: "Resumo",
    lido: false,
    temAnexos: true,
    sinalizado: true,
    ...overrides,
  };
}

test("scope selector returns only supported Graph scopes", () => {
  const filtros = [
    { id: "1", field: "status", operator: "is", values: ["unread"] },
    { id: "2", field: "scope", operator: "is", values: ["mentions"] },
  ] as Filter<string>[];

  assert.equal(escopoDeFiltros(filtros), "mentions");
  assert.equal(
    escopoDeFiltros([
      { id: "3", field: "scope", operator: "is", values: ["unknown"] },
    ] as Filter<string>[]),
    null,
  );
});

test("client predicate combines sender, status, flags, files, and date with AND", () => {
  const data = serializarDataFiltro({
    period: "day",
    operator: "between",
    startDate: new Date(2026, 6, 15),
    endDate: new Date(2026, 6, 15),
  } as DateSelectorValue);
  const filtros = [
    { id: "1", field: "from", operator: "contains", values: ["galaxie"] },
    { id: "2", field: "status", operator: "is", values: ["unread"] },
    { id: "3", field: "flagged", operator: "is", values: ["yes"] },
    { id: "4", field: "files", operator: "is", values: ["yes"] },
    { id: "5", field: "data", operator: "is", values: [data] },
  ] as Filter<string>[];

  assert.equal(passaFiltrosClient(mensagem(), filtros), true);
  assert.equal(
    passaFiltrosClient(mensagem({ sinalizado: false }), filtros),
    false,
  );
});

test("session reset clears search/results but preserves persisted preferences", () => {
  const store = criarStoreDeTeste();
  store.setOrdenar("assunto");
  store.setOrdemDesc(false);
  store.setFiltros([
    { id: "1", field: "status", operator: "is", values: ["unread"] },
  ] as Filter<string>[]);
  store.setBusca("ana");
  Object.assign(store, {
    resultadosBusca: [mensagem()],
    temMaisBusca: true,
    proximoBusca: "next-search",
    resultadosFiltro: [mensagem()],
    temMaisFiltro: true,
    proximoFiltro: "next-filter",
  });

  store.limparConsultas();

  assert.equal(store.busca, "");
  assert.equal(store.resultadosBusca, null);
  assert.equal(store.resultadosFiltro, null);
  assert.equal(store.temMaisBusca, false);
  assert.equal(store.temMaisFiltro, false);
  assert.equal(store.ordenar, "assunto");
  assert.equal(store.ordemDesc, false);
  assert.equal(store.filtros.length, 1);
});

test("optimistic result actions update both search and Graph-filter sources", () => {
  const store = criarStoreDeTeste();
  Object.assign(store, {
    resultadosBusca: [mensagem(), mensagem({ id: "m-2" })],
    resultadosFiltro: [mensagem(), mensagem({ id: "m-2" })],
  });

  store.mutarResultados((item) =>
    item.id === "m-1" ? { ...item, lido: true } : item,
  );
  assert.equal(store.resultadosBusca?.[0].lido, true);
  assert.equal(store.resultadosFiltro?.[0].lido, true);

  store.removerDosResultados(["m-2"]);
  assert.deepEqual(store.resultadosBusca?.map((item) => item.id), ["m-1"]);
  assert.deepEqual(store.resultadosFiltro?.map((item) => item.id), ["m-1"]);
});
