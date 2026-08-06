import type { PeopleOrg } from "@/lib/organizations";
import { normalizarAtomsPrefs, type AtomsPrefs } from "@/lib/atoms-prefs";
import type { Idioma } from "@/lib/strings";
import {
  normalizarDescricao,
  type TemplateEmail,
} from "@/lib/templates";
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
import {
  LocalCacheBackend,
  type AppPersistido,
  type KeyValueStorage,
  type LocalCacheCodec,
} from "./config-backend";
import {
  AGENDA_KEYS,
  AGENDA_VIEWS,
  type AgendaViewTipo,
} from "./agenda-slice";
import {
  BRIDGE_KEYS,
  normalizarSyncInterval,
  normalizarUndoSendDelay,
  type Assinatura,
} from "./bridge-slice";
import { FILTERS_KEYS, type FiltersPersistido } from "./filters-slice";
import { LIST_KEYS } from "./list-slice";
import { MAILBOX_KEYS } from "./mailbox-slice";
import { CLOUD_PREFS_KEYS } from "./cloud-prefs-slice";
import { ORGANIZATIONS_KEYS } from "./organizations-slice";
import {
  PERSONALIZATION_KEYS,
  TIPOS_FUNDO_ANIMADO,
  type TipoFundoAnimado,
} from "./personalization-slice";
import {
  SETTINGS_UI_KEYS,
  type SettingsItemId,
} from "./settings-ui-slice";
import {
  UI_KEYS,
  type MarcarLidoModo,
  type PeopleTab,
} from "./ui-slice";

function lerChave<T>(storage: KeyValueStorage, chave: string): T | undefined {
  try {
    const bruto = storage.getItem(chave);
    return bruto !== null ? (JSON.parse(bruto) as T) : undefined;
  } catch {
    return undefined;
  }
}

function gravarChave(
  storage: KeyValueStorage,
  chave: string,
  valor: unknown,
): void {
  if (valor === undefined) return;
  try {
    storage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* localStorage cheio/indisponível: só não persiste (igual ao usePersistedState) */
  }
}

export function organizationsSemLogoPersistido(
  organizations: PeopleOrg[],
): Array<Omit<PeopleOrg, "logo">> {
  return organizations.map(({ logo: _logo, ...organization }) => organization);
}

function lerTexto<T extends string>(
  storage: KeyValueStorage,
  chave: string,
  permitidos: readonly T[],
): T | undefined {
  try {
    const bruto = storage.getItem(chave);
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

function gravarTexto(
  storage: KeyValueStorage,
  chave: string,
  valor: string | undefined,
): void {
  if (valor === undefined) return;
  try {
    storage.setItem(chave, valor);
  } catch {
    /* localStorage cheio/indisponível: só não persiste */
  }
}

/** Lê a assinatura única legada (`bridge.assinatura`, texto cru) para migração. */
function lerAssinaturaLegada(storage: KeyValueStorage): string | null {
  try {
    const valor = storage.getItem("bridge.assinatura");
    return valor && valor.trim() ? valor : null;
  } catch {
    return null;
  }
}

/** Lê templates pelo storage injetado, preservando a migração de `descricao`. */
function lerTemplatesDoStorage(storage: KeyValueStorage): TemplateEmail[] {
  try {
    const bruto = storage.getItem(BRIDGE_KEYS.templates);
    if (!bruto) return [];
    const lista = JSON.parse(bruto) as unknown;
    if (!Array.isArray(lista)) return [];
    return lista
      .filter(
        (template): template is TemplateEmail =>
          !!template &&
          typeof (template as TemplateEmail).id === "string" &&
          typeof (template as TemplateEmail).nome === "string" &&
          typeof (template as TemplateEmail).corpo === "string",
      )
      .map((template) => ({
        ...template,
        descricao: normalizarDescricao(template),
      }));
  } catch {
    return [];
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
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Todas as chaves reais no localStorage (pro clear limpar tudo). */
const TODAS_CHAVES = [
  ...Object.values(UI_KEYS),
  ...Object.values(LIST_KEYS),
  ...Object.values(FILTERS_KEYS),
  ...Object.values(MAILBOX_KEYS),
  ...Object.values(SETTINGS_UI_KEYS),
  ...Object.values(PERSONALIZATION_KEYS),
  ...Object.values(BRIDGE_KEYS),
  ...Object.values(AGENDA_KEYS),
  ...Object.values(ORGANIZATIONS_KEYS),
  ...Object.values(CLOUD_PREFS_KEYS),
  // Chave legada da assinatura única (pré-#135): limpa no reset junto do resto.
  "bridge.assinatura",
];

/**
 * #555 (P0): chaves persistidas que são TENANT-SCOPED — precisam ser purgadas do
 * disco na troca de conta pra não vazarem do tenant anterior (senão reidratam do
 * localStorage). As demais chaves persistidas são config/prefs (globais) e ficam.
 * #560 (S3): `people.organizations` SAIU daqui — virou dado de nuvem (toolbox.json),
 * então o cache local dele é purgado pelo caminho de owner-change (config-nuvem)
 * e a verdade vem da nuvem no login. O reset #555 das orgs vira "só limpar cache".
 */
const CHAVES_TENANT: readonly string[] = [
  MAILBOX_KEYS.caixasCompartilhadas,
  AGENDA_KEYS.agendaCalendariosSel,
];

/**
 * Chaves locais que são apenas cache de dado sincronizado no OneDrive: o grupo A
 * (config/prefs) + as `organizations` (#560, S3). Purgadas na troca de dono da
 * conta pra o cache anterior não semear a nova (a nuvem é a autoridade).
 */
const CHAVES_CONFIG_NUVEM_LOCAL: readonly string[] = [
  UI_KEYS.zoom,
  UI_KEYS.sidebarAberta,
  UI_KEYS.marcarLidoModo,
  UI_KEYS.marcarLidoAtraso,
  UI_KEYS.peopleTab,
  FILTERS_KEYS.ordenar,
  FILTERS_KEYS.ordemDesc,
  FILTERS_KEYS.filtros,
  LIST_KEYS.agruparConversas,
  MAILBOX_KEYS.caixasCompartilhadas,
  ...Object.values(PERSONALIZATION_KEYS),
  ...Object.values(BRIDGE_KEYS),
  ...Object.values(AGENDA_KEYS),
  ...Object.values(CLOUD_PREFS_KEYS),
  ORGANIZATIONS_KEYS.organizations,
];

/** Remove do localStorage as chaves tenant-scoped (troca de conta). */
export function purgarChavesTenant(
  storage: KeyValueStorage = localStorage,
): void {
  for (const chave of CHAVES_TENANT) {
    try {
      storage.removeItem(chave);
    } catch {
      /* ignora */
    }
  }
}

/** Troca de conta: impede que o cache da conta anterior vire seed da nova. */
export function purgarChavesConfigNuvem(
  storage: KeyValueStorage = localStorage,
): void {
  for (const chave of CHAVES_CONFIG_NUVEM_LOCAL) {
    try {
      storage.removeItem(chave);
    } catch {
      /* ignora */
    }
  }
}

/**
 * Codec 1:1 das chaves legadas. Campos ausentes são omitidos para que o merge
 * do Zustand mantenha os defaults dos slices.
 */
const localCacheCodec: LocalCacheCodec = {
  read(storage) {
    const state: Partial<AppPersistido> = {};

    const zoom = lerChave<number>(storage, UI_KEYS.zoom);
    if (zoom !== undefined) state.zoom = zoom;
    const grupos = lerChave<Record<string, string[]>>(
      storage,
      UI_KEYS.gruposColapsados,
    );
    if (grupos !== undefined) state.gruposColapsados = grupos;
    const sidebar = lerChave<boolean>(storage, UI_KEYS.sidebarAberta);
    if (sidebar !== undefined) state.sidebarAberta = sidebar;
    const modo = lerChave<MarcarLidoModo>(storage, UI_KEYS.marcarLidoModo);
    if (modo !== undefined) state.marcarLidoModo = modo;
    const atraso = lerChave<number>(storage, UI_KEYS.marcarLidoAtraso);
    if (atraso !== undefined) state.marcarLidoAtraso = atraso;
    const peopleTab = lerTexto<PeopleTab>(storage, UI_KEYS.peopleTab, [
      "contacts",
      "directory",
      "organizations",
      "groups",
      "category",
    ]);
    if (peopleTab !== undefined) state.peopleTab = peopleTab;

    const ordenar = lerChave<FiltersPersistido["ordenar"]>(
      storage,
      FILTERS_KEYS.ordenar,
    );
    if (ordenar !== undefined) state.ordenar = ordenar;
    const ordemDesc = lerChave<boolean>(storage, FILTERS_KEYS.ordemDesc);
    if (ordemDesc !== undefined) state.ordemDesc = ordemDesc;
    const filtros = lerChave<FiltersPersistido["filtros"]>(
      storage,
      FILTERS_KEYS.filtros,
    );
    if (filtros !== undefined) state.filtros = filtros;

    const agruparConversas = lerChave<boolean>(
      storage,
      LIST_KEYS.agruparConversas,
    );
    if (agruparConversas !== undefined) {
      state.agruparConversas = agruparConversas;
    }
    const threadsExpandidas = lerChave<Record<string, string[]>>(
      storage,
      UI_KEYS.threadsExpandidas,
    );
    if (threadsExpandidas !== undefined) {
      state.threadsExpandidas = threadsExpandidas;
    }

    const caixas = lerChave<string[]>(
      storage,
      MAILBOX_KEYS.caixasCompartilhadas,
    );
    if (caixas !== undefined) state.caixasCompartilhadas = caixas;

    const item = lerChave<SettingsItemId>(
      storage,
      SETTINGS_UI_KEYS.selectedSettingsItem,
    );
    if (item !== undefined) state.selectedSettingsItem = item;
    const frames = lerChave<Record<string, boolean>>(
      storage,
      SETTINGS_UI_KEYS.settingsFramesAbertos,
    );
    if (frames !== undefined) state.settingsFramesAbertos = frames;

    const notificacoes = lerChave<PreferenciasNotificacao>(
      storage,
      PERSONALIZATION_KEYS.notificacoes,
    );
    if (notificacoes !== undefined) {
      state.notificacoes = { ...PREF_PADRAO, ...notificacoes };
    }
    const fundoAnimado = lerTexto<TipoFundoAnimado>(
      storage,
      PERSONALIZATION_KEYS.fundoAnimado,
      TIPOS_FUNDO_ANIMADO,
    );
    if (fundoAnimado !== undefined) state.fundoAnimado = fundoAnimado;

    // #474: flag antigo false prevalece sobre o fundo salvo.
    const fundosAnimadosAtivoLegado = lerChave<boolean>(
      storage,
      "galaxie-toolbox.background.stars",
    );
    if (fundosAnimadosAtivoLegado === false) state.fundoAnimado = "none";

    const modoTema = lerTexto<ModoTema>(
      storage,
      PERSONALIZATION_KEYS.modoTema,
      MODOS_TEMA,
    );
    if (modoTema !== undefined) {
      state.modoTema = modoTema;
      aplicarModoTema(modoTema);
    }
    const temaVisual = lerTexto<TemaVisual>(
      storage,
      PERSONALIZATION_KEYS.temaVisual,
      TEMAS_VISUAIS,
    );
    if (temaVisual !== undefined) {
      state.temaVisual = temaVisual;
      aplicarTemaVisual(temaVisual);
    }
    const altoContraste = lerChave<boolean>(
      storage,
      PERSONALIZATION_KEYS.altoContraste,
    );
    if (altoContraste !== undefined) {
      state.altoContraste = altoContraste;
      aplicarAltoContraste(altoContraste, state.temaVisual);
    }

    const assinaturas = lerChave<Assinatura[]>(
      storage,
      BRIDGE_KEYS.assinaturas,
    );
    if (Array.isArray(assinaturas)) {
      // #142: assinaturas anteriores ao campo usam false por padrão.
      state.assinaturas = assinaturas.map((assinatura) => ({
        ...assinatura,
        usarEmRespostas: assinatura.usarEmRespostas ?? false,
      }));
    } else {
      // #135: assinatura única legada vira a coleção atual em HTML.
      const antiga = lerAssinaturaLegada(storage);
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
    const padraoId = lerChave<string | null>(
      storage,
      BRIDGE_KEYS.assinaturaPadraoId,
    );
    if (padraoId !== undefined) state.assinaturaPadraoId = padraoId;
    const templates = lerTemplatesDoStorage(storage);
    if (templates.length > 0) state.templates = templates;

    // #150: normaliza atraso para o conjunto permitido.
    const undoDelay = lerChave<number>(storage, BRIDGE_KEYS.undoSendDelay);
    if (undoDelay !== undefined) {
      state.undoSendDelayMs = normalizarUndoSendDelay(undoDelay);
    }
    // #227: normaliza intervalo para o conjunto permitido.
    const syncInterval = lerChave<number>(storage, BRIDGE_KEYS.syncInterval);
    if (syncInterval !== undefined) {
      state.syncIntervalMinutes = normalizarSyncInterval(syncInterval);
    }

    const agendaView = lerTexto<AgendaViewTipo>(
      storage,
      AGENDA_KEYS.agendaView,
      AGENDA_VIEWS,
    );
    if (agendaView !== undefined) state.agendaView = agendaView;
    const agendaCalsSel = lerChave<string[] | null>(
      storage,
      AGENDA_KEYS.agendaCalendariosSel,
    );
    if (agendaCalsSel !== undefined) {
      state.agendaCalendariosSelecionados = agendaCalsSel;
    }

    const organizations = lerChave<PeopleOrg[]>(
      storage,
      ORGANIZATIONS_KEYS.organizations,
    );
    if (Array.isArray(organizations)) {
      state.organizations = organizations.map((organization) => ({
        ...organization,
        logo: null,
      }));
    }

    const idioma = lerTexto<Idioma>(storage, CLOUD_PREFS_KEYS.idioma, [
      "pt-BR",
      "en",
    ]);
    if (idioma !== undefined) state.idioma = idioma;
    const atomsPrefs = lerChave<Partial<AtomsPrefs>>(
      storage,
      CLOUD_PREFS_KEYS.atomsPrefs,
    );
    if (atomsPrefs !== undefined) {
      state.atomsPrefs = normalizarAtomsPrefs(atomsPrefs);
    }
    try {
      const pular = storage.getItem(CLOUD_PREFS_KEYS.pularConfirmacaoConexao);
      if (pular !== null) state.pularConfirmacaoConexao = pular === "1";
    } catch {
      /* ausente/indisponível: mantém o default */
    }

    return state;
  },

  write(storage, state) {
    gravarChave(storage, UI_KEYS.zoom, state.zoom);
    gravarChave(storage, UI_KEYS.gruposColapsados, state.gruposColapsados);
    gravarChave(storage, UI_KEYS.sidebarAberta, state.sidebarAberta);
    gravarChave(storage, UI_KEYS.marcarLidoModo, state.marcarLidoModo);
    gravarChave(storage, UI_KEYS.marcarLidoAtraso, state.marcarLidoAtraso);
    gravarTexto(storage, UI_KEYS.peopleTab, state.peopleTab);
    gravarChave(storage, FILTERS_KEYS.ordenar, state.ordenar);
    gravarChave(storage, FILTERS_KEYS.ordemDesc, state.ordemDesc);
    gravarChave(storage, FILTERS_KEYS.filtros, state.filtros);
    gravarChave(storage, LIST_KEYS.agruparConversas, state.agruparConversas);
    gravarChave(storage, UI_KEYS.threadsExpandidas, state.threadsExpandidas);
    gravarChave(
      storage,
      MAILBOX_KEYS.caixasCompartilhadas,
      state.caixasCompartilhadas,
    );
    gravarChave(
      storage,
      SETTINGS_UI_KEYS.selectedSettingsItem,
      state.selectedSettingsItem,
    );
    gravarChave(
      storage,
      SETTINGS_UI_KEYS.settingsFramesAbertos,
      state.settingsFramesAbertos,
    );
    gravarChave(
      storage,
      PERSONALIZATION_KEYS.notificacoes,
      state.notificacoes,
    );
    gravarTexto(
      storage,
      PERSONALIZATION_KEYS.fundoAnimado,
      state.fundoAnimado,
    );
    gravarTexto(storage, PERSONALIZATION_KEYS.modoTema, state.modoTema);
    gravarTexto(storage, PERSONALIZATION_KEYS.temaVisual, state.temaVisual);
    gravarChave(
      storage,
      PERSONALIZATION_KEYS.altoContraste,
      state.altoContraste,
    );
    gravarChave(storage, BRIDGE_KEYS.assinaturas, state.assinaturas);
    gravarChave(
      storage,
      BRIDGE_KEYS.assinaturaPadraoId,
      state.assinaturaPadraoId,
    );
    gravarChave(storage, BRIDGE_KEYS.templates, state.templates);
    gravarChave(storage, BRIDGE_KEYS.undoSendDelay, state.undoSendDelayMs);
    gravarChave(storage, BRIDGE_KEYS.syncInterval, state.syncIntervalMinutes);
    gravarTexto(storage, AGENDA_KEYS.agendaView, state.agendaView);
    gravarChave(
      storage,
      AGENDA_KEYS.agendaCalendariosSel,
      state.agendaCalendariosSelecionados,
    );
    if (state.organizations !== undefined) {
      gravarChave(
        storage,
        ORGANIZATIONS_KEYS.organizations,
        organizationsSemLogoPersistido(state.organizations),
      );
    }
    gravarTexto(storage, CLOUD_PREFS_KEYS.idioma, state.idioma);
    gravarChave(storage, CLOUD_PREFS_KEYS.atomsPrefs, state.atomsPrefs);
    if (state.pularConfirmacaoConexao !== undefined) {
      try {
        if (state.pularConfirmacaoConexao) {
          storage.setItem(CLOUD_PREFS_KEYS.pularConfirmacaoConexao, "1");
        } else {
          storage.removeItem(CLOUD_PREFS_KEYS.pularConfirmacaoConexao);
        }
      } catch {
        /* localStorage indisponível: mantém somente o estado em memória */
      }
    }
  },

  clear(storage) {
    for (const chave of TODAS_CHAVES) {
      try {
        storage.removeItem(chave);
      } catch {
        /* ignora */
      }
    }
  },
};

/** Backend local concreto; `getSnapshot` mantém a hidratação sem flash. */
export const localCacheBackend = new LocalCacheBackend(
  localStorage,
  localCacheCodec,
);
