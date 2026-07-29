import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { createUiSlice, UI_KEYS, type UiPersistido, type UiSlice } from "./ui-slice";
import { createListSlice, LIST_KEYS, type ListPersistido, type ListSlice } from "./list-slice";
import {
  createFiltersSlice,
  FILTERS_KEYS,
  type FiltersPersistido,
  type FiltersSlice,
} from "./filters-slice";
import {
  createMailboxSlice,
  MAILBOX_KEYS,
  type MailboxPersistido,
  type MailboxSlice,
} from "./mailbox-slice";
import {
  createSettingsUiSlice,
  SETTINGS_UI_KEYS,
  type SettingsItemId,
  type SettingsUiPersistido,
  type SettingsUiSlice,
} from "./settings-ui-slice";
import {
  createPersonalizationSlice,
  PERSONALIZATION_KEYS,
  type PersonalizationPersistido,
  type PersonalizationSlice,
} from "./personalization-slice";
import {
  createBridgeSlice,
  BRIDGE_KEYS,
  type Assinatura,
  type BridgePersistido,
  type BridgeSlice,
} from "./bridge-slice";
import {
  createSelectionSlice,
  type SelectionSlice,
} from "./selection-slice";
import {
  createReaderSlice,
  type ReaderSlice,
} from "./reader-slice";
import {
  createAgendaSlice,
  type AgendaSlice,
} from "./agenda-slice";
import {
  createComposeSlice,
  type ComposeSlice,
} from "./compose-slice";
import { lerTemplates } from "@/lib/templates";
import {
  aplicarAltoContraste,
  aplicarModoTema,
  aplicarTemaVisual,
  MODOS_TEMA,
  TEMAS_VISUAIS,
  type ModoTema,
  type TemaVisual,
} from "@/lib/tema";
import {
  PREF_PADRAO,
  type PreferenciasNotificacao,
} from "@/lib/sons-notificacao";
import type { MarcarLidoModo } from "./ui-slice";

/**
 * ============================================================================
 *  STORE ÚNICO DO APP — Zustand + slices (épico #125)
 * ============================================================================
 *
 * UM store pro app inteiro. Novos slices são compostos aqui — nunca criar outro
 * `create()` nem guardar preferência em hook local.
 *
 * PADRÃO DE SLICES:
 *   1. Cada domínio vira `*-slice.ts` exportando a interface + um
 *      `createXSlice: StateCreator<AppStore, [["zustand/persist", unknown]], [], XSlice>`
 *      (tipado contra o store COMBINADO) + as `X_KEYS` legadas + o `XPersistido`.
 *   2. `AppStore` é a INTERSEÇÃO dos slices.
 *   3. `create()` combina os creators com os mesmos args.
 *   4. LEITURAS SEMPRE POR SELETOR — `useAppStore(s => s.zoom)`.
 *
 * PERSISTÊNCIA (preservando as chaves do usuário):
 *   Um `PersistStorage` CUSTOM (`legacyStorage`) mapeia cada campo persistido pra
 *   a MESMA chave/formato do `usePersistedState` (as `*_KEYS` de cada slice) — a
 *   nav da Settings ganha `SETTINGS_KEY`. Sem blob novo → reabrir não reseta nada.
 *   Novo campo persistido: registre a chave no slice e some no getItem/setItem/
 *   removeItem/partialize aqui.
 *
 * ESTADO DE SESSÃO: seleção, leitor, agenda, compose e carga de mailbox/lista
 * também vivem nas slices, mas ficam fora do `partialize`.
 * ============================================================================
 */

/** Tipo do store combinado. Cresce por interseção conforme novos slices entram. */
export type AppStore =
  & UiSlice
  & ListSlice
  & FiltersSlice
  & MailboxSlice
  & SettingsUiSlice
  & PersonalizationSlice
  & BridgeSlice
  & SelectionSlice
  & ReaderSlice
  & AgendaSlice
  & ComposeSlice;

/** O que o `persist` guarda: UI + lista + mailbox (chaves legadas) + nav da Settings. */
type AppPersistido = UiPersistido &
  ListPersistido &
  FiltersPersistido &
  MailboxPersistido &
  SettingsUiPersistido &
  PersonalizationPersistido &
  BridgePersistido;

// --- storage custom: mapeia o blob persistido pras chaves reais 1:1 -----------

function lerChave<T>(chave: string): T | undefined {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto !== null ? (JSON.parse(bruto) as T) : undefined;
  } catch {
    return undefined;
  }
}

function gravarChave(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* localStorage cheio/indisponível: só não persiste (igual ao usePersistedState) */
  }
}

function lerTexto<T extends string>(
  chave: string,
  permitidos: readonly T[]
): T | undefined {
  try {
    const bruto = localStorage.getItem(chave);
    if (bruto === null) return undefined;
    let valor = bruto;
    try {
      const parsed = JSON.parse(bruto);
      if (typeof parsed === "string") valor = parsed;
    } catch {
      // O formato legado de `galaxie-theme` é texto cru.
    }
    return permitidos.includes(valor as T) ? (valor as T) : undefined;
  } catch {
    return undefined;
  }
}

function gravarTexto(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* localStorage cheio/indisponível: só não persiste */
  }
}

/** Lê a assinatura única legada (`bridge.assinatura`, texto cru) para migração. */
function lerAssinaturaLegada(): string | null {
  try {
    const v = localStorage.getItem("bridge.assinatura");
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** Texto multi-linha → HTML (uma linha por parágrafo), casando o Plate. */
function textoParaHtml(texto: string): string {
  return texto
    .split(/\r?\n/)
    .map((linha) => `<p>${escaparHtml(linha) || "<br>"}</p>`)
    .join("");
}

/** Escapa os caracteres perigosos do HTML na migração da assinatura. */
function escaparHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Todas as chaves reais no localStorage (pro removeItem limpar tudo). */
const TODAS_CHAVES = [
  ...Object.values(UI_KEYS),
  ...Object.values(LIST_KEYS),
  ...Object.values(FILTERS_KEYS),
  ...Object.values(MAILBOX_KEYS),
  ...Object.values(SETTINGS_UI_KEYS),
  ...Object.values(PERSONALIZATION_KEYS),
  ...Object.values(BRIDGE_KEYS),
  // Chave legada da assinatura única (pré-#135): limpa no reset junto do resto.
  "bridge.assinatura",
];

/**
 * `PersistStorage` que NÃO usa uma chave única: lê/grava cada campo na sua chave
 * legada, no mesmo formato do `usePersistedState`. Campos ausentes são omitidos →
 * o `merge` do Zustand mantém o default do slice. Síncrono → o store hidrata no
 * load do módulo (1ª renderização já vê os valores salvos, sem flash).
 */
const legacyStorage: PersistStorage<AppPersistido> = {
  getItem: (): StorageValue<AppPersistido> | null => {
    const state: Partial<AppPersistido> = {};
    // UI
    const zoom = lerChave<number>(UI_KEYS.zoom);
    if (zoom !== undefined) state.zoom = zoom;
    const grupos = lerChave<Record<string, string[]>>(UI_KEYS.gruposColapsados);
    if (grupos !== undefined) state.gruposColapsados = grupos;
    const sidebar = lerChave<boolean>(UI_KEYS.sidebarAberta);
    if (sidebar !== undefined) state.sidebarAberta = sidebar;
    const agenda = lerChave<boolean>(UI_KEYS.agendaAberta);
    if (agenda !== undefined) state.agendaAberta = agenda;
    const modo = lerChave<MarcarLidoModo>(UI_KEYS.marcarLidoModo);
    if (modo !== undefined) state.marcarLidoModo = modo;
    const atraso = lerChave<number>(UI_KEYS.marcarLidoAtraso);
    if (atraso !== undefined) state.marcarLidoAtraso = atraso;
    // Filtros / busca / ordenação (#129)
    const ordenar = lerChave<FiltersPersistido["ordenar"]>(
      FILTERS_KEYS.ordenar
    );
    if (ordenar !== undefined) state.ordenar = ordenar;
    const ordemDesc = lerChave<boolean>(FILTERS_KEYS.ordemDesc);
    if (ordemDesc !== undefined) state.ordemDesc = ordemDesc;
    const filtros = lerChave<FiltersPersistido["filtros"]>(
      FILTERS_KEYS.filtros
    );
    if (filtros !== undefined) state.filtros = filtros;
    // Lista
    const agruparConversas = lerChave<boolean>(LIST_KEYS.agruparConversas);
    if (agruparConversas !== undefined) {
      state.agruparConversas = agruparConversas;
    }
    const threadsExpandidas = lerChave<Record<string, string[]>>(
      UI_KEYS.threadsExpandidas
    );
    if (threadsExpandidas !== undefined) {
      state.threadsExpandidas = threadsExpandidas;
    }
    // Mailbox
    const caixas = lerChave<string[]>(MAILBOX_KEYS.caixasCompartilhadas);
    if (caixas !== undefined) state.caixasCompartilhadas = caixas;
    // Settings
    const item = lerChave<SettingsItemId>(SETTINGS_UI_KEYS.selectedSettingsItem);
    if (item !== undefined) state.selectedSettingsItem = item;
    const frames = lerChave<Record<string, boolean>>(
      SETTINGS_UI_KEYS.settingsFramesAbertos
    );
    if (frames !== undefined) state.settingsFramesAbertos = frames;
    // Personalization
    const notificacoes = lerChave<PreferenciasNotificacao>(
      PERSONALIZATION_KEYS.notificacoes
    );
    if (notificacoes !== undefined) {
      state.notificacoes = { ...PREF_PADRAO, ...notificacoes };
    }
    const fundoEstrelado = lerChave<boolean>(
      PERSONALIZATION_KEYS.fundoEstrelado
    );
    if (fundoEstrelado !== undefined) state.fundoEstrelado = fundoEstrelado;
    const modoTema = lerTexto<ModoTema>(
      PERSONALIZATION_KEYS.modoTema,
      MODOS_TEMA
    );
    if (modoTema !== undefined) {
      state.modoTema = modoTema;
      aplicarModoTema(modoTema);
    }
    const temaVisual = lerTexto<TemaVisual>(
      PERSONALIZATION_KEYS.temaVisual,
      TEMAS_VISUAIS
    );
    if (temaVisual !== undefined) {
      state.temaVisual = temaVisual;
      aplicarTemaVisual(temaVisual);
    }
    // Aplicado DEPOIS do temaVisual para sobrepor o Mood quando ligado.
    const altoContraste = lerChave<boolean>(
      PERSONALIZATION_KEYS.altoContraste
    );
    if (altoContraste !== undefined) {
      state.altoContraste = altoContraste;
      aplicarAltoContraste(altoContraste, state.temaVisual);
    }
    // Bridge (#135): assinaturas + padrão + templates.
    const assinaturas = lerChave<Assinatura[]>(BRIDGE_KEYS.assinaturas);
    if (Array.isArray(assinaturas)) {
      // Back-compat (#142): assinaturas salvas antes do campo não têm
      // `usarEmRespostas` — normaliza pra `false` em vez de `undefined`.
      state.assinaturas = assinaturas.map((a) => ({
        ...a,
        usarEmRespostas: a.usarEmRespostas ?? false,
      }));
    } else {
      // Migração da assinatura única legada (`bridge.assinatura`, texto cru):
      // vira uma assinatura padrão com o corpo em HTML (uma linha por <p>).
      const antiga = lerAssinaturaLegada();
      if (antiga) {
        const migrada: Assinatura = {
          id: "sig-legada",
          nome: "Minha assinatura",
          corpo: textoParaHtml(antiga),
          usarEmRespostas: false,
        };
        state.assinaturas = [migrada];
        state.assinaturaPadraoId = migrada.id;
      }
    }
    const padraoId = lerChave<string | null>(BRIDGE_KEYS.assinaturaPadraoId);
    if (padraoId !== undefined) state.assinaturaPadraoId = padraoId;
    const templates = lerTemplates();
    if (templates.length > 0) state.templates = templates;
    return { state: state as AppPersistido, version: 0 };
  },
  setItem: (_name, value: StorageValue<AppPersistido>): void => {
    const s = value.state;
    gravarChave(UI_KEYS.zoom, s.zoom);
    gravarChave(UI_KEYS.gruposColapsados, s.gruposColapsados);
    gravarChave(UI_KEYS.sidebarAberta, s.sidebarAberta);
    gravarChave(UI_KEYS.agendaAberta, s.agendaAberta);
    gravarChave(UI_KEYS.marcarLidoModo, s.marcarLidoModo);
    gravarChave(UI_KEYS.marcarLidoAtraso, s.marcarLidoAtraso);
    gravarChave(FILTERS_KEYS.ordenar, s.ordenar);
    gravarChave(FILTERS_KEYS.ordemDesc, s.ordemDesc);
    gravarChave(FILTERS_KEYS.filtros, s.filtros);
    gravarChave(LIST_KEYS.agruparConversas, s.agruparConversas);
    gravarChave(UI_KEYS.threadsExpandidas, s.threadsExpandidas);
    gravarChave(MAILBOX_KEYS.caixasCompartilhadas, s.caixasCompartilhadas);
    gravarChave(
      SETTINGS_UI_KEYS.selectedSettingsItem,
      s.selectedSettingsItem
    );
    gravarChave(
      SETTINGS_UI_KEYS.settingsFramesAbertos,
      s.settingsFramesAbertos
    );
    gravarChave(PERSONALIZATION_KEYS.notificacoes, s.notificacoes);
    gravarChave(PERSONALIZATION_KEYS.fundoEstrelado, s.fundoEstrelado);
    gravarTexto(PERSONALIZATION_KEYS.modoTema, s.modoTema);
    gravarTexto(PERSONALIZATION_KEYS.temaVisual, s.temaVisual);
    gravarChave(PERSONALIZATION_KEYS.altoContraste, s.altoContraste);
    gravarChave(BRIDGE_KEYS.assinaturas, s.assinaturas);
    gravarChave(BRIDGE_KEYS.assinaturaPadraoId, s.assinaturaPadraoId);
    gravarChave(BRIDGE_KEYS.templates, s.templates);
  },
  removeItem: (): void => {
    for (const chave of TODAS_CHAVES) {
      try {
        localStorage.removeItem(chave);
      } catch {
        /* ignora */
      }
    }
  },
};

/**
 * Store único do app. Novos slices devem ser compostos aqui, sem criar outro
 * `create()` ou armazenar preferências em hooks locais.
 */
export const useAppStore = create<AppStore>()(
  persist(
    (...a) => ({
      ...createUiSlice(...a),
      ...createListSlice(...a),
      ...createFiltersSlice(...a),
      ...createMailboxSlice(...a),
      ...createSettingsUiSlice(...a),
      ...createPersonalizationSlice(...a),
      ...createBridgeSlice(...a),
      // Seleção do Bridge (#128) é estado de sessão, fora do partialize.
      ...createSelectionSlice(...a),
      // Conteúdo do leitor (#130) é estado de sessão, fora do partialize.
      ...createReaderSlice(...a),
      // Dados/seleção da agenda (#131) são sessão, fora do partialize.
      ...createAgendaSlice(...a),
      // Orquestração/rascunho do compose (#132) são sessão, fora do partialize.
      ...createComposeSlice(...a),
    }),
    {
      name: "galaxie-toolbox.store",
      storage: legacyStorage,
      version: 0,
      partialize: (s): AppPersistido => ({
        zoom: s.zoom,
        gruposColapsados: s.gruposColapsados,
        threadsExpandidas: s.threadsExpandidas,
        sidebarAberta: s.sidebarAberta,
        agendaAberta: s.agendaAberta,
        marcarLidoModo: s.marcarLidoModo,
        marcarLidoAtraso: s.marcarLidoAtraso,
        ordenar: s.ordenar,
        ordemDesc: s.ordemDesc,
        filtros: s.filtros,
        agruparConversas: s.agruparConversas,
        caixasCompartilhadas: s.caixasCompartilhadas,
        selectedSettingsItem: s.selectedSettingsItem,
        settingsFramesAbertos: s.settingsFramesAbertos,
        notificacoes: s.notificacoes,
        fundoEstrelado: s.fundoEstrelado,
        modoTema: s.modoTema,
        temaVisual: s.temaVisual,
        altoContraste: s.altoContraste,
        assinaturas: s.assinaturas,
        assinaturaPadraoId: s.assinaturaPadraoId,
        templates: s.templates,
      }),
    }
  )
);
