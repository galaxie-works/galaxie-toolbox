import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import type { AppPersistido } from "./config-backend";
import {
  localCacheBackend,
  organizationsSemLogoPersistido,
  purgarChavesConfigNuvem,
  purgarChavesTenant,
} from "./local-cache-backend";
import {
  LayeredBackend,
  OneDriveJsonBackend,
  projetarConfigNuvem,
} from "./onedrive-config-backend";
import {
  aplicarAltoContraste,
  aplicarModoTema,
  aplicarTemaVisual,
} from "@/lib/tema";

// #555 (P0): vetores de sessão fora do store, zerados pelo seam de reset.
import { limparFotos } from "@/lib/fotos";
import { invalidarBrandingCache, resetSessionMemo } from "@/lib/api";

import { createUiSlice, type UiSlice } from "./ui-slice";
import { createListSlice, type ListSlice } from "./list-slice";
import { createFiltersSlice, type FiltersSlice } from "./filters-slice";
import { createMailboxSlice, type MailboxSlice } from "./mailbox-slice";
import { createSettingsUiSlice, type SettingsUiSlice } from "./settings-ui-slice";
import {
  createPersonalizationSlice,
  type PersonalizationSlice,
} from "./personalization-slice";
import { createBridgeSlice, type BridgeSlice } from "./bridge-slice";
import {
  createSelectionSlice,
  type SelectionSlice,
} from "./selection-slice";
import {
  createReaderSlice,
  type ReaderSlice,
} from "./reader-slice";
import { createAgendaSlice, type AgendaSlice } from "./agenda-slice";
import {
  createComposeSlice,
  type ComposeSlice,
} from "./compose-slice";
import {
  createPeopleSlice,
  type PeopleSlice,
} from "./people-slice";
import { createOrganizationsSlice, type OrganizationsSlice } from "./organizations-slice";
import {
  createAuthSlice,
  type AuthSlice,
} from "./auth-slice";
import {
  createCloudPrefsSlice,
  type CloudPrefsSlice,
} from "./cloud-prefs-slice";

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
 *   Um `LocalCacheBackend` mapeia cada campo persistido pra
 *   a MESMA chave/formato do `usePersistedState` (as `*_KEYS` de cada slice) — a
 *   nav da Settings ganha `SETTINGS_KEY`. Sem blob novo → reabrir não reseta nada.
 *   Novo campo persistido: registre a chave no slice e no codec de
 *   `local-cache-backend.ts`; some também no `partialize` abaixo.
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
  & ComposeSlice
  & PeopleSlice
  & OrganizationsSlice
  & AuthSlice
  & CloudPrefsSlice;

const layeredConfigBackend = new LayeredBackend(
  localCacheBackend,
  new OneDriveJsonBackend(),
  {
    baseline: () => projetarConfigNuvem(useAppStore.getState()),
  },
);

const CONFIG_CACHE_OWNER_KEY = "galaxie-toolbox.config-cache-owner.v1";

/** Bridge do contrato híbrido para o middleware persist do Zustand. */
const zustandConfigStorage: PersistStorage<AppPersistido> = {
  getItem: (): StorageValue<AppPersistido> => ({
    state: layeredConfigBackend.getSnapshot() as AppPersistido,
    version: 0,
  }),
  setItem: (_name, value) => layeredConfigBackend.save(value.state),
  removeItem: () => layeredConfigBackend.clear(),
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
      // Contatos, seleção e carga do People são sessão e uma única fonte/cache.
      ...createPeopleSlice(...a),
      // Organizações do People são app-owned e persistidas localmente (#205).
      // A portabilidade via M365 (companyName write-back) é o #288.
      ...createOrganizationsSlice(...a),
      // Escopos ausentes descrevem somente o token atual (#235): session-only.
      ...createAuthSlice(...a),
      // Idioma, layout do Atoms e confirmação também são config acionável.
      ...createCloudPrefsSlice(...a),
    }),
    {
      name: "galaxie-toolbox.store",
      storage: zustandConfigStorage,
      version: 0,
      partialize: (s): AppPersistido => ({
        zoom: s.zoom,
        gruposColapsados: s.gruposColapsados,
        threadsExpandidas: s.threadsExpandidas,
        sidebarAberta: s.sidebarAberta,
        marcarLidoModo: s.marcarLidoModo,
        marcarLidoAtraso: s.marcarLidoAtraso,
        peopleTab: s.peopleTab,
        ordenar: s.ordenar,
        ordemDesc: s.ordemDesc,
        filtros: s.filtros,
        agruparConversas: s.agruparConversas,
        caixasCompartilhadas: s.caixasCompartilhadas,
        selectedSettingsItem: s.selectedSettingsItem,
        settingsFramesAbertos: s.settingsFramesAbertos,
        notificacoes: s.notificacoes,
        fundoAnimado: s.fundoAnimado,
        modoTema: s.modoTema,
        temaVisual: s.temaVisual,
        altoContraste: s.altoContraste,
        assinaturas: s.assinaturas,
        assinaturaPadraoId: s.assinaturaPadraoId,
        templates: s.templates,
        undoSendDelayMs: s.undoSendDelayMs,
        syncIntervalMinutes: s.syncIntervalMinutes,
        agendaView: s.agendaView,
        agendaCalendariosSelecionados: s.agendaCalendariosSelecionados,
        organizations: organizationsSemLogoPersistido(s.organizations),
        idioma: s.idioma,
        atomsPrefs: s.atomsPrefs,
        pularConfirmacaoConexao: s.pularConfirmacaoConexao,
      }),
    }
  )
);

/**
 * Abre a raia cloud só depois da autenticação. Na primeira migração preserva o
 * cache legado; em troca real de conta elimina o seed da conta anterior antes
 * de qualquer tela autenticada ser mostrada.
 */
export function prepararConfiguracaoNuvem(accountEmail: string): void {
  layeredConfigBackend.deactivate();
  const account = accountEmail.trim().toLowerCase();
  let owner: string | null = null;
  try {
    owner = localStorage.getItem(CONFIG_CACHE_OWNER_KEY);
  } catch {
    // Cache indisponível: o arquivo no drive ainda isola a autoridade.
  }

  if (owner !== null && owner !== account) {
    purgarChavesConfigNuvem();
    const defaults = projetarConfigNuvem(
      useAppStore.getInitialState() as AppPersistido,
    );
    useAppStore.setState(defaults as Partial<AppStore>);
  }
  try {
    localStorage.setItem(CONFIG_CACHE_OWNER_KEY, account);
  } catch {
    // Best-effort; a nuvem segue sendo a fonte da verdade.
  }
  layeredConfigBackend.activate();
}

/** Reconciliador pós-login: local imediato, OneDrive assíncrono. */
export async function reconciliarConfiguracaoNuvem(): Promise<void> {
  const cloud = await layeredConfigBackend.load();
  useAppStore.setState(cloud as Partial<AppStore>);
  const state = useAppStore.getState();
  aplicarModoTema(state.modoTema);
  aplicarTemaVisual(state.temaVisual);
  aplicarAltoContraste(state.altoContraste, state.temaVisual);
}

/** Cancela write-through pendente antes de o token mudar de conta. */
export function suspenderConfiguracaoNuvem(): void {
  layeredConfigBackend.deactivate();
}

/**
 * #555 (P0): SEAM ÚNICO de reset de sessão. Zera TODO o estado tenant-scoped na
 * troca de conta, num lugar só — impossível esquecer um store (o teste de
 * herança-zero garante a cobertura). Chamado nas FRONTEIRAS DE CONTA (login novo
 * e logout), não no restore (mesma conta). PRESERVA config/prefs: tema, idioma,
 * som, fundo, zoom, sidebar, assinaturas/templates, ordenação e filtros salvos.
 *
 * Se um slice novo tiver estado por-conta, adicione seu reset aqui — e o teste
 * `store/reset-sessao.test.ts` (herança-zero) falha se algo escapar.
 */
export function resetSessaoCompleta(): void {
  suspenderConfiguracaoNuvem();
  const s = useAppStore.getState();
  // Slices tenant-scoped (reusa limpar*/fechar* existentes + os resets do #555).
  s.resetSessaoMailbox();
  s.resetSessaoList();
  s.resetSessaoSelection();
  s.limparLeitor(); // reader (#130): e-mail aberto + insights
  s.limparConsultas(); // filters (#129): busca + resultados
  s.fecharCompose(); // compose (#132): rascunho + destinatários + anexos
  s.resetSessaoAgenda();
  s.resetPeopleSession(); // people (+ categorias/merge, estendido no #555)
  s.resetSessaoOrganizations();
  s.resetNavegacao(); // #568: nav (bridgeView→mail, peopleTab→contacts)
  s.clearReauth(); // auth (#235): escopos ausentes do token
  // Vetores FORA do store.
  limparFotos(); // cache de fotos (módulo + localStorage)
  invalidarBrandingCache(); // memo do logo do tenant (#541)
  void resetSessionMemo(); // memo curto do Graph no Rust (best-effort)
  // Persistência: purga as chaves tenant-scoped do disco (senão reidratam).
  purgarChavesTenant();
}
