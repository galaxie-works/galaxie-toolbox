import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { createUiSlice, UI_KEYS, type UiPersistido, type UiSlice } from "./ui-slice";
import {
  createSettingsUiSlice,
  type SettingsItemId,
  type SettingsUiSlice,
} from "./settings-ui-slice";

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
 *      (tipado contra o store COMBINADO, então `set`/`get` enxergam tudo).
 *   2. `AppStore` é a INTERSEÇÃO dos slices.
 *   3. `create()` combina os creators com os mesmos args:
 *      `(...a) => ({ ...createUiSlice(...a), ...createSettingsUiSlice(...a) })`.
 *   4. LEITURAS SEMPRE POR SELETOR — `useAppStore(s => s.zoom)` — pra assinar só
 *      o pedaço usado. Ações (`setX`) são estáveis.
 *
 * PERSISTÊNCIA (preservando as chaves do usuário):
 *   O `persist` guarda só o que for `partialize`. Em vez de um blob único numa
 *   chave nova (que resetaria o estado salvo), um `PersistStorage` CUSTOM
 *   (`legacyStorage`) mapeia cada campo persistido pra a MESMA chave/formato que
 *   o `usePersistedState` usava (`UI_KEYS`) — a nav da Settings ganha sua chave
 *   própria (`SETTINGS_KEY`). Assim o estado antigo continua válido sem migração.
 *   Novo campo persistido: registre a chave + no getItem/setItem/removeItem.
 *
 * COEXISTÊNCIA: durante a migração incremental, o estado ainda-não-migrado segue
 * no `usePersistedState`/`useState` do control-room. Nada quebra.
 * ============================================================================
 */

/** Tipo do store combinado. Cresce por interseção conforme novos slices entram. */
export type AppStore = UiSlice & SettingsUiSlice;

/** Chave própria da nav da Settings (#118). Não é `bridge.*` porque não é do Bridge. */
const SETTINGS_KEY = "galaxie-toolbox.settingsItem";

/** O que o `persist` guarda: UI (chaves legadas) + a nav da Settings. */
type AppPersistido = UiPersistido & Pick<SettingsUiSlice, "selectedSettingsItem">;

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

/**
 * `PersistStorage` que NÃO usa uma chave única: lê/grava cada campo na sua chave
 * (as legadas `UI_KEYS` do #126 + `SETTINGS_KEY`), no mesmo formato do
 * `usePersistedState`. Campos ausentes são omitidos → o `merge` do Zustand
 * mantém o default do slice (sem "resetar" nada). Síncrono, então o store já
 * hidrata no load do módulo — a 1ª renderização já vê os valores salvos.
 */
const legacyStorage: PersistStorage<AppPersistido> = {
  getItem: (): StorageValue<AppPersistido> | null => {
    const state: Partial<AppPersistido> = {};
    const zoom = lerChave<number>(UI_KEYS.zoom);
    if (zoom !== undefined) state.zoom = zoom;
    const grupos = lerChave<Record<string, string[]>>(UI_KEYS.gruposColapsados);
    if (grupos !== undefined) state.gruposColapsados = grupos;
    const sidebar = lerChave<boolean>(UI_KEYS.sidebarAberta);
    if (sidebar !== undefined) state.sidebarAberta = sidebar;
    const modo = lerChave<AppPersistido["marcarLidoModo"]>(UI_KEYS.marcarLidoModo);
    if (modo !== undefined) state.marcarLidoModo = modo;
    const atraso = lerChave<number>(UI_KEYS.marcarLidoAtraso);
    if (atraso !== undefined) state.marcarLidoAtraso = atraso;
    const item = lerChave<SettingsItemId>(SETTINGS_KEY);
    if (item !== undefined) state.selectedSettingsItem = item;
    return { state: state as AppPersistido, version: 0 };
  },
  setItem: (_name, value: StorageValue<AppPersistido>): void => {
    const s = value.state;
    gravarChave(UI_KEYS.zoom, s.zoom);
    gravarChave(UI_KEYS.gruposColapsados, s.gruposColapsados);
    gravarChave(UI_KEYS.sidebarAberta, s.sidebarAberta);
    gravarChave(UI_KEYS.marcarLidoModo, s.marcarLidoModo);
    gravarChave(UI_KEYS.marcarLidoAtraso, s.marcarLidoAtraso);
    gravarChave(SETTINGS_KEY, s.selectedSettingsItem);
  },
  removeItem: (): void => {
    for (const chave of [...Object.values(UI_KEYS), SETTINGS_KEY]) {
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
      ...createSettingsUiSlice(...a),
    }),
    {
      // Id lógico do persist; as chaves REAIS no localStorage são as de `UI_KEYS`
      // + `SETTINGS_KEY` (o `legacyStorage` ignora este nome — não cria a chave).
      name: "galaxie-toolbox.store",
      storage: legacyStorage,
      version: 0,
      partialize: (s): AppPersistido => ({
        zoom: s.zoom,
        gruposColapsados: s.gruposColapsados,
        sidebarAberta: s.sidebarAberta,
        marcarLidoModo: s.marcarLidoModo,
        marcarLidoAtraso: s.marcarLidoAtraso,
        selectedSettingsItem: s.selectedSettingsItem,
      }),
    }
  )
);
