// #1058 — pontes entre os namespaces do dicionário (strings.ts, planos e chatos:
// só string por causa do tipo do `en`) e os formatos de config que os componentes
// vendorizados do reui esperam (com funções e objetos aninhados). Módulo PURO em
// `.ts` (sem JSX, só imports de tipo) para o node --test/CI e o vitest carregarem
// igual — e para o teste de contrato #1058 importar os builders direto.

import type { FilterI18nConfig } from "@/components/reui/filters";
import type { DataGridI18n } from "@/components/reui/data-grid/data-grid";
import type { DateSelectorI18nConfig } from "@/components/reui/date-selector";
import type { EventCalendarI18nOverrides } from "@/components/reui/event-calendar/event-calendar-i18n";
import type { Dicionario } from "@/lib/strings";

/** Troca `{chave}` por `valor` (mesma convenção do `preencher`, sem puxar .tsx). */
function sub(tpl: string, chave: string, valor: string): string {
  return tpl.replace(new RegExp(`\\{${chave}\\}`, "g"), valor);
}

/** Namespace `filtros` → `Partial<FilterI18nConfig>` do filter-builder reui. */
export function montarFiltrosI18n(
  f: Dicionario["filtros"],
): Partial<FilterI18nConfig> {
  return {
    addFilter: f.addFilter,
    searchFields: f.searchFields,
    noFieldsFound: f.noFieldsFound,
    noResultsFound: f.noResultsFound,
    select: f.select,
    true: f.valorVerdadeiro,
    false: f.valorFalso,
    min: f.min,
    max: f.max,
    to: f.to,
    typeAndPressEnter: f.typeAndPressEnter,
    selected: f.selected,
    selectedCount: f.selectedCount,
    percent: f.percent,
    defaultCurrency: f.defaultCurrency,
    defaultColor: f.defaultColor,
    addFilterTitle: f.addFilterTitle,
    loadingOptions: f.loadingOptions,
    errorLoadingOptions: f.errorLoadingOptions,
    operators: {
      is: f.opIs,
      isNot: f.opIsNot,
      isAnyOf: f.opIsAnyOf,
      isNotAnyOf: f.opIsNotAnyOf,
      includesAll: f.opIncludesAll,
      excludesAll: f.opExcludesAll,
      before: f.opBefore,
      after: f.opAfter,
      between: f.opBetween,
      notBetween: f.opNotBetween,
      contains: f.opContains,
      notContains: f.opNotContains,
      startsWith: f.opStartsWith,
      endsWith: f.opEndsWith,
      isExactly: f.opIsExactly,
      equals: f.opEquals,
      notEquals: f.opNotEquals,
      greaterThan: f.opGreaterThan,
      lessThan: f.opLessThan,
      overlaps: f.opOverlaps,
      includes: f.opIncludes,
      excludes: f.opExcludes,
      includesAllOf: f.opIncludesAllOf,
      includesAnyOf: f.opIncludesAnyOf,
      empty: f.opEmpty,
      notEmpty: f.opNotEmpty,
    },
    placeholders: {
      enterField: (fieldType: string) => sub(f.phEnterField, "campo", fieldType),
      selectField: f.phSelectField,
      searchField: (fieldName: string) =>
        sub(f.phSearchField, "campo", fieldName),
      enterKey: f.phEnterKey,
      enterValue: f.phEnterValue,
    },
    validation: {
      invalidEmail: f.validInvalidEmail,
      invalidUrl: f.validInvalidUrl,
      invalidTel: f.validInvalidTel,
      invalid: f.validInvalid,
    },
  };
}

/** Namespace `grid` → `Partial<DataGridI18n>` do DataGrid reui. */
export function montarGridI18n(g: Dicionario["grid"]): Partial<DataGridI18n> {
  return {
    sortAsc: g.sortAsc,
    sortDesc: g.sortDesc,
    pinToLeft: g.pinToLeft,
    pinToRight: g.pinToRight,
    moveToLeft: g.moveToLeft,
    moveToRight: g.moveToRight,
    columns: g.columns,
    unpinColumn: (column: string) => sub(g.unpinColumn, "coluna", column),
    selectRow: g.selectRow,
    selectAllRows: g.selectAllRows,
    pinRow: g.pinRow,
    unpinRow: g.unpinRow,
    emptyMessage: g.emptyMessage,
    loadingMessage: g.loadingMessage,
  };
}

/** Namespace `dateSelector` → `DateSelectorI18nConfig` completo. */
export function montarDateSelectorI18n(
  d: Dicionario["dateSelector"],
): DateSelectorI18nConfig {
  const csv = (s: string) => s.split(",");
  return {
    selectDate: d.selectDate,
    apply: d.apply,
    cancel: d.cancel,
    clear: d.clear,
    today: d.today,
    filterTypes: {
      is: d.filterTypeIs,
      before: d.filterTypeBefore,
      after: d.filterTypeAfter,
      between: d.filterTypeBetween,
    },
    periodTypes: {
      day: d.periodDay,
      month: d.periodMonth,
      quarter: d.periodQuarter,
      halfYear: d.periodHalfYear,
      year: d.periodYear,
    },
    months: csv(d.months),
    monthsShort: csv(d.monthsShort),
    quarters: csv(d.quarters),
    halfYears: csv(d.halfYears),
    weekdays: csv(d.weekdays),
    weekdaysShort: csv(d.weekdaysShort),
    placeholder: d.placeholder,
    rangePlaceholder: d.rangePlaceholder,
  };
}

/**
 * Dicionário → overrides do event-calendar (labels + viewNames). Cobre TODAS as
 * labels traduzíveis do `DEFAULT_LABELS`; `viewShortcuts` (letras de atalho, atadas
 * ao teclado) e as funções puramente de formato (`eventDetails`/`moreCompact`/
 * `timeRange`) ficam no default de propósito — ver o teste de contrato #1058.
 */
export function montarAgendaI18n(t: Dicionario): EventCalendarI18nOverrides {
  const c = t.controlRoom;
  const contarEventos = (n: number) =>
    `${n} ${n === 1 ? c.agendaPalavraEvento : c.agendaPalavraEventos}`;
  return {
    labels: {
      today: c.agendaHoje,
      previous: c.agendaAnterior,
      next: c.agendaProximo,
      addEvent: c.agendaNovoEvento,
      allDay: c.diaInteiro,
      more: (n: number) => `+${n} ${c.agendaCalMais}`,
      noEvents: c.agendaCalSemEventos,
      loading: c.agendaCalCarregando,
      event: c.agendaPalavraEvento,
      events: contarEventos,
      selectView: c.agendaSelecionarVisao,
      week: (weekNumber: number) => `${c.agendaSemanaPrefixo}${weekNumber}`,
      resources: c.agendaViewResource,
      goToDate: c.agendaIrParaData,
      dropNotAllowed: c.agendaNaoPodeAqui,
      continues: c.agendaContinua,
      timeFrom: (time: string) => sub(c.agendaHoraDe, "valor", time),
      timeUntil: (time: string) => sub(c.agendaHoraAte, "valor", time),
      toggleDayEvents: (n: number) => contarEventos(n),
    },
    viewNames: {
      month: c.agendaViewMes,
      week: c.agendaViewSemana,
      day: c.agendaViewDia,
      days: (n: number) =>
        `${n} ${n === 1 ? c.agendaPalavraDia : c.agendaPalavraDias}`,
      agenda: c.agendaViewAgenda,
      resource: c.agendaViewResource,
    },
  };
}
