import type { StateCreator } from "zustand";

import type { DateSelectorValue } from "@/components/reui/date-selector";
import type { Filter } from "@/components/reui/filters";
import {
  crBuscar,
  crFiltrar,
  type OrdenarMensagens,
} from "../lib/api.ts";
import type { EmailItem } from "../lib/types";
import type { AppStore } from "./index";
import { resolver, type Updater } from "./updater.ts";

/** Escopos que dependem do Microsoft Graph em vez da lista já carregada. */
export type FiltroServidor = "tome" | "mentions" | "invites";

export interface ConsultaMensagens {
  pastaId: string;
  caixa: string;
  ignorarIds?: Iterable<string>;
}

export interface BuscaMensagens extends ConsultaMensagens {
  termo: string;
}

export interface FiltroMensagens extends ConsultaMensagens {
  escopo: FiltroServidor;
}

/**
 * Filtros, busca, ordenação e escopo Graph do Bridge (#129).
 *
 * Só `ordenar`, `ordemDesc` e `filtros` persistem. Busca, resultados, cursores
 * e gerações de request são estado de sessão e ficam fora do `partialize`.
 */
export interface FiltersSlice {
  ordenar: OrdenarMensagens;
  ordemDesc: boolean;
  filtros: Filter<string>[];
  busca: string;

  resultadosBusca: EmailItem[] | null;
  temMaisBusca: boolean;
  proximoBusca: string | null;
  resultadosFiltro: EmailItem[] | null;
  temMaisFiltro: boolean;
  proximoFiltro: string | null;

  /** Gerações invalidam respostas assíncronas de uma pasta/caixa anterior. */
  buscaRequisicao: number;
  filtroRequisicao: number;

  setOrdenar: (v: Updater<OrdenarMensagens>) => void;
  setOrdemDesc: (v: Updater<boolean>) => void;
  setFiltros: (v: Updater<Filter<string>[]>) => void;
  setBusca: (v: Updater<string>) => void;

  cancelarBusca: () => void;
  cancelarFiltroGraph: () => void;
  limparConsultas: () => void;
  buscarMensagens: (params: BuscaMensagens) => Promise<void>;
  filtrarMensagens: (params: FiltroMensagens) => Promise<void>;
  carregarMaisBusca: (params: BuscaMensagens) => Promise<boolean>;
  carregarMaisFiltro: (params: FiltroMensagens) => Promise<boolean>;
  mutarResultados: (fn: (mensagem: EmailItem) => EmailItem) => void;
  removerDosResultados: (ids: Iterable<string>) => void;
}

/** Chaves legadas preservadas 1:1 do `usePersistedState`. */
export const FILTERS_KEYS = {
  ordenar: "bridge.ordenar",
  ordemDesc: "bridge.ordemDesc",
  filtros: "bridge.filtrosLista.v2",
} as const;

export type FiltersPersistido = Pick<
  FiltersSlice,
  "ordenar" | "ordemDesc" | "filtros"
>;

/** Primeiro escopo Graph ativo; filtros client-side continuam combinando por E. */
export function escopoDeFiltros(
  filtros: readonly Filter<string>[],
): FiltroServidor | null {
  const valor = filtros.find((f) => f.field === "scope")?.values[0];
  return valor === "tome" || valor === "mentions" || valor === "invites"
    ? valor
    : null;
}

export function serializarDataFiltro(v: DateSelectorValue): string {
  return JSON.stringify(v, (_chave, valor) =>
    valor instanceof Date ? valor.toISOString() : valor,
  );
}

export function desserializarDataFiltro(
  valor: string | undefined,
): DateSelectorValue | undefined {
  if (!valor) return undefined;
  try {
    const raw = JSON.parse(valor) as DateSelectorValue;
    return {
      ...raw,
      startDate: raw.startDate ? new Date(raw.startDate) : undefined,
      endDate: raw.endDate ? new Date(raw.endDate) : undefined,
    };
  } catch {
    return undefined;
  }
}

const inicioDoDia = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
const fimDoDia = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
const inicioDoMes = (ano: number, mes: number) =>
  new Date(ano, mes, 1, 0, 0, 0, 0).getTime();
const fimDoMes = (ano: number, mes: number) =>
  new Date(ano, mes + 1, 0, 23, 59, 59, 999).getTime();

function mesesDoPeriodo(
  period: DateSelectorValue["period"],
  value: number,
): { mesIni: number; mesFim: number } {
  switch (period) {
    case "quarter":
      return { mesIni: value * 3, mesFim: value * 3 + 2 };
    case "half-year":
      return { mesIni: value * 6, mesFim: value * 6 + 5 };
    case "year":
      return { mesIni: 0, mesFim: 11 };
    default:
      return { mesIni: value, mesFim: value };
  }
}

function faixaBaseData(v: DateSelectorValue): { s: number; e: number } | null {
  if (v.period === "day") {
    if (v.startDate && v.endDate) {
      return { s: inicioDoDia(v.startDate), e: fimDoDia(v.endDate) };
    }
    if (v.startDate) {
      return { s: inicioDoDia(v.startDate), e: fimDoDia(v.startDate) };
    }
    return null;
  }

  const unidade =
    v.period === "month"
      ? v.month
      : v.period === "quarter"
        ? v.quarter
        : v.period === "half-year"
          ? v.halfYear
          : 0;
  if (v.rangeStart && v.rangeEnd) {
    const ini = mesesDoPeriodo(v.period, v.rangeStart.value);
    const fim = mesesDoPeriodo(v.period, v.rangeEnd.value);
    return {
      s: inicioDoMes(v.rangeStart.year, ini.mesIni),
      e: fimDoMes(v.rangeEnd.year, fim.mesFim),
    };
  }
  if (v.year !== undefined && (v.period === "year" || unidade !== undefined)) {
    const { mesIni, mesFim } = mesesDoPeriodo(v.period, unidade ?? 0);
    return { s: inicioDoMes(v.year, mesIni), e: fimDoMes(v.year, mesFim) };
  }
  return null;
}

export function resolveIntervaloData(
  v: DateSelectorValue,
): { ini: number | null; fim: number | null } | null {
  const base = faixaBaseData(v);
  if (!base) return null;
  switch (v.operator) {
    case "before":
      return { ini: null, fim: base.s - 1 };
    case "after":
      return { ini: base.e + 1, fim: null };
    default:
      return { ini: base.s, fim: base.e };
  }
}

function isoUtc(iso: string): string {
  return iso.endsWith("Z") ? iso : `${iso}Z`;
}

/** Predicado client-side canônico de From/Status/Flagged/Files/Data (AND). */
export function passaFiltrosClient(
  mensagem: EmailItem,
  filtros: readonly Filter<string>[],
): boolean {
  for (const filtro of filtros) {
    const valor = filtro.values[0];
    if (filtro.field === "from") {
      const termo = String(valor ?? "").trim().toLowerCase();
      if (!termo) continue;
      const contem = `${mensagem.de} ${mensagem.deEmail}`
        .toLowerCase()
        .includes(termo);
      if (filtro.operator === "not_contains" ? contem : !contem) return false;
    } else if (filtro.field === "status") {
      if (valor == null) continue;
      const bate = valor === "unread" ? !mensagem.lido : mensagem.lido;
      if (filtro.operator === "is_not" ? bate : !bate) return false;
    } else if (filtro.field === "flagged") {
      if (valor == null) continue;
      const bate =
        valor === "yes" ? mensagem.sinalizado : !mensagem.sinalizado;
      if (filtro.operator === "is_not" ? bate : !bate) return false;
    } else if (filtro.field === "files") {
      if (valor == null) continue;
      const bate =
        valor === "yes" ? mensagem.temAnexos : !mensagem.temAnexos;
      if (filtro.operator === "is_not" ? bate : !bate) return false;
    } else if (filtro.field === "data") {
      const data = desserializarDataFiltro(valor as string | undefined);
      if (!data) continue;
      const intervalo = resolveIntervaloData(data);
      if (!intervalo) continue;
      const quando = new Date(isoUtc(mensagem.recebido)).getTime();
      if (Number.isNaN(quando)) return false;
      if (intervalo.ini !== null && quando < intervalo.ini) return false;
      if (intervalo.fim !== null && quando > intervalo.fim) return false;
    }
  }
  return true;
}

function semIgnorados(
  mensagens: EmailItem[],
  ignorarIds?: Iterable<string>,
): EmailItem[] {
  if (!ignorarIds) return mensagens;
  const ignorados = new Set(ignorarIds);
  return ignorados.size === 0
    ? mensagens
    : mensagens.filter((mensagem) => !ignorados.has(mensagem.id));
}

function juntarResultados(
  anteriores: EmailItem[],
  novos: EmailItem[],
  ignorarIds?: Iterable<string>,
): EmailItem[] {
  const ignorados = new Set(ignorarIds);
  const vistos = new Set(anteriores.map((mensagem) => mensagem.id));
  return [
    ...anteriores.filter((mensagem) => !ignorados.has(mensagem.id)),
    ...novos.filter(
      (mensagem) =>
        !ignorados.has(mensagem.id) && !vistos.has(mensagem.id),
    ),
  ];
}

export const createFiltersSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  FiltersSlice
> = (set, get) => ({
  ordenar: "data",
  ordemDesc: true,
  filtros: [],
  busca: "",
  resultadosBusca: null,
  temMaisBusca: false,
  proximoBusca: null,
  resultadosFiltro: null,
  temMaisFiltro: false,
  proximoFiltro: null,
  buscaRequisicao: 0,
  filtroRequisicao: 0,

  setOrdenar: (v) => set((s) => ({ ordenar: resolver(s.ordenar, v) })),
  setOrdemDesc: (v) => set((s) => ({ ordemDesc: resolver(s.ordemDesc, v) })),
  setFiltros: (v) => set((s) => ({ filtros: resolver(s.filtros, v) })),
  setBusca: (v) => set((s) => ({ busca: resolver(s.busca, v) })),

  cancelarBusca: () =>
    set((s) => ({
      buscaRequisicao: s.buscaRequisicao + 1,
      resultadosBusca: null,
      temMaisBusca: false,
      proximoBusca: null,
    })),

  cancelarFiltroGraph: () =>
    set((s) => ({
      filtroRequisicao: s.filtroRequisicao + 1,
      resultadosFiltro: null,
      temMaisFiltro: false,
      proximoFiltro: null,
    })),

  limparConsultas: () =>
    set((s) => ({
      busca: "",
      buscaRequisicao: s.buscaRequisicao + 1,
      filtroRequisicao: s.filtroRequisicao + 1,
      resultadosBusca: null,
      temMaisBusca: false,
      proximoBusca: null,
      resultadosFiltro: null,
      temMaisFiltro: false,
      proximoFiltro: null,
    })),

  buscarMensagens: async ({ pastaId, termo, caixa, ignorarIds }) => {
    const requisicao = get().buscaRequisicao + 1;
    set({
      buscaRequisicao: requisicao,
      resultadosBusca: null,
      temMaisBusca: false,
      proximoBusca: null,
    });
    try {
      const pagina = await crBuscar(pastaId, termo, null, caixa);
      if (get().buscaRequisicao !== requisicao) return;
      set({
        resultadosBusca: semIgnorados(pagina.itens, ignorarIds),
        temMaisBusca: pagina.proximo !== null,
        proximoBusca: pagina.proximo,
      });
    } catch {
      if (get().buscaRequisicao !== requisicao) return;
      set({
        resultadosBusca: [],
        temMaisBusca: false,
        proximoBusca: null,
      });
    }
  },

  filtrarMensagens: async ({ pastaId, escopo, caixa, ignorarIds }) => {
    const requisicao = get().filtroRequisicao + 1;
    set({
      filtroRequisicao: requisicao,
      resultadosFiltro: null,
      temMaisFiltro: false,
      proximoFiltro: null,
    });
    try {
      const pagina = await crFiltrar(pastaId, escopo, null, caixa);
      if (get().filtroRequisicao !== requisicao) return;
      set({
        resultadosFiltro: semIgnorados(pagina.itens, ignorarIds),
        temMaisFiltro: pagina.proximo !== null,
        proximoFiltro: pagina.proximo,
      });
    } catch {
      if (get().filtroRequisicao !== requisicao) return;
      // #109: falha do escopo mantém o chip e mostra o empty state.
      set({
        resultadosFiltro: [],
        temMaisFiltro: false,
        proximoFiltro: null,
      });
    }
  },

  carregarMaisBusca: async ({ pastaId, termo, caixa, ignorarIds }) => {
    const { proximoBusca, buscaRequisicao } = get();
    if (!termo.trim() || !proximoBusca) return false;
    try {
      const pagina = await crBuscar(pastaId, termo, proximoBusca, caixa);
      if (get().buscaRequisicao !== buscaRequisicao) return true;
      set((s) => ({
        resultadosBusca: juntarResultados(
          s.resultadosBusca ?? [],
          pagina.itens,
          ignorarIds,
        ),
        temMaisBusca: pagina.proximo !== null,
        proximoBusca: pagina.proximo,
      }));
    } catch {
      // Paginação é best-effort, como antes da migração.
    }
    return true;
  },

  carregarMaisFiltro: async ({ pastaId, escopo, caixa, ignorarIds }) => {
    const { proximoFiltro, filtroRequisicao } = get();
    if (!proximoFiltro) return false;
    try {
      const pagina = await crFiltrar(pastaId, escopo, proximoFiltro, caixa);
      if (get().filtroRequisicao !== filtroRequisicao) return true;
      set((s) => ({
        resultadosFiltro: juntarResultados(
          s.resultadosFiltro ?? [],
          pagina.itens,
          ignorarIds,
        ),
        temMaisFiltro: pagina.proximo !== null,
        proximoFiltro: pagina.proximo,
      }));
    } catch {
      // Paginação é best-effort, como antes da migração.
    }
    return true;
  },

  mutarResultados: (fn) =>
    set((s) => ({
      resultadosBusca: s.resultadosBusca?.map(fn) ?? s.resultadosBusca,
      resultadosFiltro: s.resultadosFiltro?.map(fn) ?? s.resultadosFiltro,
    })),

  removerDosResultados: (ids) =>
    set((s) => {
      const removidos = new Set(ids);
      return {
        resultadosBusca:
          s.resultadosBusca?.filter(
            (mensagem) => !removidos.has(mensagem.id),
          ) ?? s.resultadosBusca,
        resultadosFiltro:
          s.resultadosFiltro?.filter(
            (mensagem) => !removidos.has(mensagem.id),
          ) ?? s.resultadosFiltro,
      };
    }),
});
