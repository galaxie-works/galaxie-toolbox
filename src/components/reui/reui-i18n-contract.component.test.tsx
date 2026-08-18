// #1058 (teste de contrato) — trava a REGRESSÃO SILENCIOSA de i18n dos componentes
// vendorizados do reui: cada chave dos defaults ingleses (`DEFAULT_I18N` do Filters,
// `DEFAULT_LABELS` do EventCalendar, e ainda DateSelector/DataGrid) TEM que ser
// coberta pelo builder que o app monta a partir do dicionário. Se alguém adicionar
// uma chave nova ao componente sem cabear a tradução, este teste quebra — mesmo
// espírito do `lumen-863-atalhos-cross-check` (catálogo↔handler).
//
// Roda no vitest (`pnpm test:component`, projeto `component`/happy-dom): importa os
// componentes .tsx (JSX) que o `node --test` não carrega. Os builders vivem num
// módulo puro (`@/lib/reui-i18n`) e são importados direto.
import { describe, it, expect } from "vitest";

import { DEFAULT_I18N } from "@/components/reui/filters";
import { DEFAULT_EVENT_CALENDAR_I18N } from "@/components/reui/event-calendar/event-calendar-i18n";
import { DEFAULT_DATE_SELECTOR_I18N } from "@/components/reui/date-selector";
import { DEFAULT_DATA_GRID_I18N } from "@/components/reui/data-grid/data-grid";
import {
  montarFiltrosI18n,
  montarGridI18n,
  montarDateSelectorI18n,
  montarAgendaI18n,
} from "@/lib/reui-i18n";
import { DICIONARIOS } from "@/lib/strings";

const PT = DICIONARIOS["pt-BR"];

/** Caminhos-folha de um config aninhado. Função e array contam como folha. */
function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return [prefix];
  }
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flatten(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe("#1058 contrato i18n reui: nenhum default inglês fica sem tradução", () => {
  it("Filters: montarFiltrosI18n cobre todas as chaves de DEFAULT_I18N", () => {
    const esperadas = flatten(DEFAULT_I18N);
    const cobertas = new Set(flatten(montarFiltrosI18n(PT.filtros)));
    // `helpers.formatOperator` é lógica de formato (troca `_` por espaço), não
    // copy traduzível — fica no default de propósito.
    const NEUTRAS = new Set(["helpers.formatOperator"]);
    const faltando = esperadas.filter(
      (k) => !cobertas.has(k) && !NEUTRAS.has(k),
    );
    expect(faltando).toEqual([]);
  });

  it("EventCalendar: montarAgendaI18n cobre todas as labels de DEFAULT_LABELS", () => {
    const esperadas = Object.keys(DEFAULT_EVENT_CALENDAR_I18N.labels);
    const cobertas = new Set(
      Object.keys(montarAgendaI18n(PT).labels ?? {}),
    );
    // Neutras de idioma: `viewShortcuts` são letras de atalho de teclado; as demais
    // são funções de puro formato (título/contagem) sem texto traduzível.
    const NEUTRAS = new Set([
      "viewShortcuts",
      "eventDetails",
      "moreCompact",
      "timeRange",
    ]);
    const faltando = esperadas.filter(
      (k) => !cobertas.has(k) && !NEUTRAS.has(k),
    );
    expect(faltando).toEqual([]);
  });

  it("DateSelector: montarDateSelectorI18n cobre todo DEFAULT_DATE_SELECTOR_I18N", () => {
    const esperadas = flatten(DEFAULT_DATE_SELECTOR_I18N);
    const cobertas = new Set(flatten(montarDateSelectorI18n(PT.dateSelector)));
    expect(esperadas.filter((k) => !cobertas.has(k))).toEqual([]);
  });

  it("DataGrid: montarGridI18n cobre todo DEFAULT_DATA_GRID_I18N", () => {
    const esperadas = flatten(DEFAULT_DATA_GRID_I18N);
    const cobertas = new Set(flatten(montarGridI18n(PT.grid)));
    expect(esperadas.filter((k) => !cobertas.has(k))).toEqual([]);
  });
});
