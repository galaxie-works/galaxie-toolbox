import type { StateCreator } from "zustand";

import * as api from "../lib/api.ts";
import {
  applyPeopleEnrichment,
  mergePeopleGroupMembers,
  mergePeopleRecords,
  resolvePerson,
  type PeopleContact,
} from "../lib/people.ts";
import type { Filter } from "../components/reui/filters";
import type { MergePlan } from "../lib/people-merge";
import { telAcaoConcluida } from "../lib/telemetria.ts";
// #464 (S2): i18n fora do React — o store não usa o hook `useIdioma`, então lê o
// idioma atual (mesmo localStorage do provider) e resolve a string na hora, pra
// erros de People pararem de vazar em inglês pra UI.
import { DICIONARIOS } from "../lib/strings.ts";
import { idiomaAtual } from "../lib/idioma-core.ts";

/** Strings de People (namespace controlRoom) no idioma atual. */
function strPeople() {
  return DICIONARIOS[idiomaAtual()].controlRoom;
}
import type {
  PeopleBulkDetailsChange,
  PeopleBulkDetailsField,
  PeopleContactEdit,
  PeopleEnrichFieldKey,
  PeopleEnrichPreview,
  PeopleGroup,
  PeopleTenantOrganization,
  Pessoa,
} from "../lib/types";
import type { AppStore } from "./index";

type PeopleApi = Pick<
  typeof api,
  | "crPeopleList"
  | "crPessoas"
  | "crPeopleOrganization"
  | "crPeopleDirectory"
  | "crPeopleGroups"
  | "crPeopleGroupMembers"
  | "crPeopleEnrichPreview"
  | "crPeopleCompanyWrite"
  | "crPeopleDetailsWrite"
  | "crPeopleContactUpdate"
  | "crPeopleContactCategories"
  | "crPeopleContactCreate"
  | "crPeopleContactDelete"
  | "crCategorias"
  | "crCriarCategoria"
>;

/** Fases da execução do merge (#379), na ordem segura do #376. */
export type PeopleMergePhase =
  | "snapshot"
  | "master"
  | "absorbed"
  | "refetch"
  | "done";

/** Progresso por unidades concluídas (1 PATCH + M DELETEs + 1 refetch). */
export interface PeopleMergeProgress {
  phase: PeopleMergePhase;
  completed: number;
  total: number;
}

/** Resultado da execução do merge, com status por item dos DELETEs. */
export interface PeopleMergeResult {
  ok: boolean;
  masterUpdated: boolean;
  deleted: string[];
  failedDeletes: Array<{ contactId: string; error: string }>;
  error?: string;
}

/** Resultado do Undo por recriação (oldId→newId), com casos parciais. */
export interface PeopleMergeUndoResult {
  masterRestored: boolean;
  recreated: Array<{ oldId: string; newId: string }>;
  failed: Array<{ contactId: string; error: string }>;
  error?: string;
}

/** Snapshot do Undo no store (vive além do toast; restart encerra). */
export interface PeopleMergeUndoState {
  plan: MergePlan;
  deleted: string[];
}

const resolveInFlight = new Map<string, Promise<PeopleContact | null>>();
const directoryEnrichInFlight = new Map<
  string,
  Promise<PeopleEnrichPreview>
>();
const DIRECTORY_AUTO_ENRICH_FIELDS = new Set<PeopleEnrichFieldKey>([
  "companyName",
  "department",
  "jobTitle",
  "officeLocation",
  "manager",
]);

function peopleResultError(
  failures: string[],
  missingScopes: string[],
): string | null {
  return [...failures, ...missingScopes].join(" · ") || null;
}

type PeopleBulkDetailsSnapshot = Pick<
  PeopleContact,
  | "company"
  | "companySource"
  | "department"
  | "departmentSource"
  | "officeLocation"
  | "officeLocationSource"
>;

function normalizeBulkDetailsChanges(
  changes: PeopleBulkDetailsChange[],
): PeopleBulkDetailsChange[] {
  if (changes.length === 0) {
    throw new Error("At least one details change is required.");
  }

  const seen = new Set<PeopleBulkDetailsField>();
  return changes.map((change) => {
    if (seen.has(change.field)) {
      throw new Error(`Duplicate bulk details field: ${change.field}.`);
    }
    seen.add(change.field);

    if (change.value === null) return change;

    const value = change.value.trim();
    if (value.length === 0 || new TextEncoder().encode(value).length > 256) {
      throw new Error(`Invalid value for bulk details field: ${change.field}.`);
    }
    return { ...change, value };
  });
}

function bulkDetailsValue(
  contact: PeopleContact,
  field: PeopleBulkDetailsField,
): string | null {
  switch (field) {
    case "companyName":
      return contact.company ?? null;
    case "department":
      return contact.department ?? null;
    case "officeLocation":
      return contact.officeLocation ?? null;
  }
}

function applyBulkDetailsChanges(
  contact: PeopleContact,
  changes: PeopleBulkDetailsChange[],
): PeopleContact {
  let next = contact;
  for (const change of changes) {
    const source = change.value == null ? undefined : "contacts";
    switch (change.field) {
      case "companyName":
        next = {
          ...next,
          company: change.value,
          companySource: source,
        };
        break;
      case "department":
        next = {
          ...next,
          department: change.value,
          departmentSource: source,
        };
        break;
      case "officeLocation":
        next = {
          ...next,
          officeLocation: change.value,
          officeLocationSource: source,
        };
        break;
    }
  }
  return next;
}

function bulkDetailsSnapshot(
  contact: PeopleContact,
): PeopleBulkDetailsSnapshot {
  return {
    company: contact.company,
    companySource: contact.companySource,
    department: contact.department,
    departmentSource: contact.departmentSource,
    officeLocation: contact.officeLocation,
    officeLocationSource: contact.officeLocationSource,
  };
}

function personFromSuggestion(person: Pessoa): PeopleContact {
  const email = person.email.trim();
  const source = person.origem === "organizacao" ? "directory" : "contacts";
  return {
    id: `resolved:${email.toLocaleLowerCase()}`,
    contactId: null,
    peopleId: null,
    name: person.nome || email,
    emails: [{ address: email, source }],
    phones: [],
    jobTitle: person.cargo,
    jobTitleSource: person.cargo ? source : undefined,
    photo: person.foto,
    photoSource: person.foto ? source : undefined,
    organization: source === "directory",
    frequent: false,
    sources: [source],
    categories: [],
  };
}

/** Cache único e exclusivamente de sessão do módulo People (#166). */
export interface PeopleSlice {
  peopleSearchQuery: string;
  peopleContacts: PeopleContact[];
  peopleSelectedId: string | null;
  peopleLoading: boolean;
  peopleLoaded: boolean;
  peopleError: string | null;
  peopleMissingScopes: string[];
  peopleNextLinks: string[];
  peopleFetchingMore: boolean;
  peopleFilters: Filter<string>[];
  peopleView: "table" | "cards";
  peopleColumnVisibility: Record<string, boolean>;
  peopleRequestGeneration: number;
  peopleSessionGeneration: number;
  peopleDirectoryEnrichedEmails: string[];
  peopleM365Generation: number;
  peopleM365Loading: boolean;
  peopleM365Loaded: boolean;
  peopleM365Error: string | null;
  peopleTenantOrganization: PeopleTenantOrganization | null;
  peopleTenantOrganizationLoading: boolean;
  peopleTenantOrganizationLoaded: boolean;
  peopleTenantOrganizationError: string | null;
  peopleTenantOrganizationMissingScopes: string[];
  peopleDirectory: PeopleContact[];
  peopleDirectoryLoading: boolean;
  peopleDirectoryLoaded: boolean;
  peopleDirectoryError: string | null;
  peopleDirectoryMissingScopes: string[];
  peopleGroups: PeopleGroup[];
  peopleGroupsLoading: boolean;
  peopleGroupsLoaded: boolean;
  peopleGroupsError: string | null;
  peopleSelectedGroupId: string | null;
  peopleGroupMembersById: Record<string, PeopleContact[]>;
  peopleGroupMembersLoadingId: string | null;
  peopleGroupMembersError: string | null;
  peopleMergeRunning: boolean;
  peopleMergeUndo: PeopleMergeUndoState | null;
  /** #406: categorias do Outlook (nome→cor hex), hidratadas no login. */
  peopleCategorias: Map<string, string>;
  /** #406: categoria selecionada no sidebar (filtra a grid). */
  peopleSelectedCategory: string | null;

  loadPeople: () => Promise<void>;
  loadMorePeople: () => Promise<void>;
  resolvePeoplePerson: (
    email: string,
    fallback?: Pessoa,
  ) => Promise<PeopleContact | null>;
  selectPerson: (id: string | null) => void;
  setPeopleFilters: (filters: Filter<string>[]) => void;
  setPeopleView: (view: "table" | "cards") => void;
  setPeopleColumnVisibility: (visibility: Record<string, boolean>) => void;
  setPeopleSearchQuery: (query: string) => void;
  hydratePeopleM365: (options?: { force?: boolean }) => Promise<void>;
  resetPeopleSession: () => void;
  selectPeopleDirectory: (id?: string | null) => void;
  loadPeopleGroups: () => Promise<void>;
  selectPeopleGroup: (groupId: string) => Promise<void>;
  /** #406: seleciona uma categoria no sidebar (filtra a grid por ela). */
  selectPeopleCategory: (nome: string) => void;
  /** #406: (re)carrega as categorias do Outlook (masterCategories). */
  carregarCategoriasPeople: () => Promise<void>;
  /**
   * #278 S3b: define as categorias de UM contato (PATCH parcial). Otimista;
   * reverte no erro. Só contatos editáveis (com `contactId`) — diretório não.
   */
  setPeopleContactCategorias: (
    id: string,
    categorias: string[],
  ) => Promise<void>;
  /**
   * #278 S3b: cria uma categoria do Outlook inline (durante o assign) e já a
   * insere no mapa `peopleCategorias` pra aparecer no seletor na hora. `preset`
   * = nome do preset de cor do Outlook ("preset0".."preset24").
   */
  criarCategoriaPeople: (nome: string, preset: string) => Promise<void>;
  /**
   * #278 S3c: atribui/remove categorias do Outlook em BULK. Para cada contato
   * editável, `add` entram (union) e `remove` saem; contatos não-editáveis
   * (sem `contactId`) são pulados. Otimista + rollback por item. Reporta
   * updated/skipped/unchanged/failed como o `bulkEditPeopleDetails`.
   */
  bulkSetPeopleCategorias: (
    contactIds: string[],
    add: string[],
    remove: string[],
  ) => Promise<{
    updated: number;
    skipped: number;
    failed: number;
    unchanged: number;
  }>;
  autoEnrichDirectoryContact: (
    id: string,
    sameOrganization: boolean,
  ) => Promise<void>;
  assignPeopleOrganization: (
    organizationId: string,
    contactIds: string[],
  ) => Promise<{
    assigned: number;
    skipped: number;
    failed: number;
  }>;
  bulkEditPeopleDetails: (
    contactIds: string[],
    changes: PeopleBulkDetailsChange[],
  ) => Promise<{
    updated: number;
    skipped: number;
    failed: number;
    unchanged: number;
  }>;
  updatePeopleContact: (id: string, input: PeopleContactEdit) => Promise<void>;
  mergePeopleContacts: (
    plan: MergePlan,
    onProgress?: (progress: PeopleMergeProgress) => void,
  ) => Promise<PeopleMergeResult>;
  undoMergeContacts: () => Promise<PeopleMergeUndoResult>;
}

export function criarPeopleSlice(
  overrides: Partial<PeopleApi> = {},
): StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  PeopleSlice
> {
  const client = { ...api, ...overrides } as PeopleApi;
  return (set, get) => ({
  peopleSearchQuery: "",
  peopleContacts: [],
  peopleSelectedId: null,
  peopleLoading: false,
  peopleLoaded: false,
  peopleError: null,
  peopleMissingScopes: [],
  peopleNextLinks: [],
  peopleFetchingMore: false,
  peopleFilters: [],
  peopleView: "table",
  peopleColumnVisibility: {
    name: true,
    company: false,
    title: false,
    email: true,
    phone: false,
    source: false,
    actions: true,
  },
  peopleRequestGeneration: 0,
  peopleSessionGeneration: 0,
  peopleDirectoryEnrichedEmails: [],
  peopleM365Generation: 0,
  peopleM365Loading: false,
  peopleM365Loaded: false,
  peopleM365Error: null,
  peopleTenantOrganization: null,
  peopleTenantOrganizationLoading: false,
  peopleTenantOrganizationLoaded: false,
  peopleTenantOrganizationError: null,
  peopleTenantOrganizationMissingScopes: [],
  peopleDirectory: [],
  peopleDirectoryLoading: false,
  peopleDirectoryLoaded: false,
  peopleDirectoryError: null,
  peopleDirectoryMissingScopes: [],
  peopleGroups: [],
  peopleGroupsLoading: false,
  peopleGroupsLoaded: false,
  peopleGroupsError: null,
  peopleSelectedGroupId: null,
  peopleGroupMembersById: {},
  peopleGroupMembersLoadingId: null,
  peopleGroupMembersError: null,
  peopleMergeRunning: false,
  peopleMergeUndo: null,
  peopleCategorias: new Map(),
  peopleSelectedCategory: null,

  loadPeople: async () => {
    const generation = get().peopleRequestGeneration + 1;
    const sessionGeneration = get().peopleSessionGeneration;
    set({
      peopleLoading: true,
      peopleError: null,
      peopleRequestGeneration: generation,
    });
    try {
      const result = await client.crPeopleList();
      if (
        get().peopleRequestGeneration !== generation ||
        get().peopleSessionGeneration !== sessionGeneration
      ) {
        return;
      }
      const contacts = mergePeopleRecords(result.records);
      for (const cached of get().peopleContacts) {
        if (
          !cached.emails.some((email) => resolvePerson(contacts, email.address))
        ) {
          contacts.push(cached);
        }
      }
      const current = get().peopleSelectedId;
      set({
        peopleContacts: contacts,
        peopleSelectedId:
          current && contacts.some((contact) => contact.id === current)
            ? current
            : null,
        peopleLoading: false,
        peopleLoaded: true,
        peopleMissingScopes: result.missingScopes,
        peopleNextLinks: result.nextLinks,
        peopleError: result.failures.length > 0 ? result.failures.join(" · ") : null,
        peopleDirectoryEnrichedEmails: [],
      });
    } catch (error) {
      if (
        get().peopleRequestGeneration !== generation ||
        get().peopleSessionGeneration !== sessionGeneration
      ) {
        return;
      }
      set({
        peopleLoading: false,
        peopleLoaded: true,
        peopleError: String(error),
      });
    }
  },

  loadMorePeople: async () => {
    const { peopleFetchingMore, peopleNextLinks } = get();
    if (peopleFetchingMore || peopleNextLinks.length === 0) return;
    const sessionGeneration = get().peopleSessionGeneration;
    set({ peopleFetchingMore: true });
    try {
      const result = await client.crPeopleList(peopleNextLinks);
      if (get().peopleSessionGeneration !== sessionGeneration) return;
      const previous = get().peopleContacts;
      const incoming = mergePeopleRecords(result.records);
      const appended = previous.map((contact) => ({
        ...contact,
        emails: [...contact.emails],
        phones: [...contact.phones],
        sources: [...contact.sources],
      }));
      for (const contact of incoming) {
        const existing = contact.emails
          .map((email) => resolvePerson(appended, email.address))
          .find(Boolean);
        if (!existing) {
          appended.push(contact);
          continue;
        }
        existing.emails = Array.from(
          new Map(
            [...existing.emails, ...contact.emails].map((email) => [
              email.address.trim().toLocaleLowerCase(),
              email,
            ]),
          ).values(),
        );
        existing.phones = Array.from(
          new Map(
            [...existing.phones, ...contact.phones].map((phone) => [
              phone.number.replace(/\s+/g, ""),
              phone,
            ]),
          ).values(),
        );
        existing.peopleId ||= contact.peopleId;
        existing.contactId ||= contact.contactId;
        existing.sources = Array.from(
          new Set([...existing.sources, ...contact.sources]),
        );
        existing.organization ||= contact.organization;
        existing.frequent ||= contact.frequent;
      }
      set({
        peopleContacts: appended,
        peopleNextLinks: result.nextLinks,
        peopleFetchingMore: false,
        peopleMissingScopes: Array.from(
          new Set([...get().peopleMissingScopes, ...result.missingScopes]),
        ),
        peopleError:
          result.failures.length > 0
            ? [get().peopleError, ...result.failures].filter(Boolean).join(" · ")
            : get().peopleError,
      });
    } catch (error) {
      if (get().peopleSessionGeneration !== sessionGeneration) return;
      set({ peopleFetchingMore: false, peopleError: String(error) });
    }
  },

  resolvePeoplePerson: async (email, fallback) => {
    const normalized = email.trim().toLocaleLowerCase();
    if (!normalized) return null;

    const cached = resolvePerson(get().peopleContacts, normalized);
    if (cached) return cached;

    const existingRequest = resolveInFlight.get(normalized);
    if (existingRequest) return existingRequest;

    const sessionGeneration = get().peopleSessionGeneration;
    const request = (async () => {
      let person =
        fallback?.origem && fallback.email.trim().toLocaleLowerCase() === normalized
          ? fallback
          : undefined;
      if (!person) {
        const suggestions = await client.crPessoas(email);
        person = suggestions.find(
          (candidate) =>
            candidate.email.trim().toLocaleLowerCase() === normalized,
        );
      }
      if (!person) return null;
      if (get().peopleSessionGeneration !== sessionGeneration) return null;

      const current = resolvePerson(get().peopleContacts, normalized);
      if (current) return current;

      const contact = personFromSuggestion(person);
      set((state) => ({
        peopleContacts: [...state.peopleContacts, contact],
      }));
      return contact;
    })().catch(() => null);

    resolveInFlight.set(normalized, request);
    void request.finally(() => {
      if (resolveInFlight.get(normalized) === request) {
        resolveInFlight.delete(normalized);
      }
    });
    return request;
  },

  selectPerson: (peopleSelectedId) => set({ peopleSelectedId }),
  setPeopleFilters: (peopleFilters) => set({ peopleFilters }),
  setPeopleView: (peopleView) => set({ peopleView }),
  setPeopleColumnVisibility: (peopleColumnVisibility) =>
    set({ peopleColumnVisibility }),
  setPeopleSearchQuery: (peopleSearchQuery) => set({ peopleSearchQuery }),
  hydratePeopleM365: async (options) => {
    const force = options?.force === true;
    const current = get();
    if (
      (!force && current.peopleM365Loaded) ||
      (!force && current.peopleM365Loading)
    ) {
      return;
    }

    const generation = current.peopleM365Generation + 1;
    const sessionGeneration = current.peopleSessionGeneration;
    if (force) {
      directoryEnrichInFlight.clear();
    }
    set({
      peopleM365Generation: generation,
      peopleM365Loading: true,
      peopleM365Error: null,
      peopleTenantOrganizationLoading: true,
      peopleTenantOrganizationLoaded: false,
      peopleTenantOrganizationError: null,
      peopleDirectoryLoading: true,
      peopleDirectoryLoaded: false,
      peopleDirectoryError: null,
      peopleGroupsLoading: true,
      peopleGroupsLoaded: false,
      peopleGroupsError: null,
      ...(force
        ? {
            peopleDirectoryEnrichedEmails: [],
            peopleSelectedGroupId: null,
            peopleGroupMembersById: {},
            peopleGroupMembersLoadingId: null,
            peopleGroupMembersError: null,
          }
        : {}),
    });

    const [organizationResult, directoryResult, groupsResult, categoriasResult] =
      await Promise.allSettled([
        client.crPeopleOrganization(),
        client.crPeopleDirectory(),
        client.crPeopleGroups(),
        client.crCategorias(),
      ]);
    if (
      get().peopleM365Generation !== generation ||
      get().peopleSessionGeneration !== sessionGeneration
    ) {
      return;
    }

    const organization =
      organizationResult.status === "fulfilled"
        ? organizationResult.value.organization ?? null
        : null;
    const organizationMissingScopes =
      organizationResult.status === "fulfilled"
        ? organizationResult.value.missingScopes
        : [];
    const organizationError =
      organizationResult.status === "fulfilled"
        ? peopleResultError(
            organizationResult.value.failures,
            organizationMissingScopes,
          )
        : String(organizationResult.reason);

    const directoryRecords =
      directoryResult.status === "fulfilled"
        ? directoryResult.value.records.filter(
            (record) => record.source === "directory",
          )
        : [];
    const directoryMissingScopes =
      directoryResult.status === "fulfilled"
        ? directoryResult.value.missingScopes
        : [];
    const directoryError =
      directoryResult.status === "fulfilled"
        ? peopleResultError(
            directoryResult.value.failures,
            directoryMissingScopes,
          )
        : String(directoryResult.reason);

    const groups =
      groupsResult.status === "fulfilled" ? groupsResult.value.groups : [];
    const groupsError =
      groupsResult.status === "fulfilled"
        ? peopleResultError(
            groupsResult.value.failures,
            groupsResult.value.missingScopes,
          )
        : String(groupsResult.reason);
    // #406: categorias do Outlook (masterCategories) — best-effort; falha não
    // vira erro visível (cores são secundárias). Mantém as atuais se falhar.
    const categorias =
      categoriasResult.status === "fulfilled"
        ? new Map(categoriasResult.value.map((c) => [c.nome, c.cor]))
        : get().peopleCategorias;
    const errors = [
      organizationError,
      directoryError,
      groupsError,
    ].filter((error): error is string => Boolean(error));

    set({
      peopleM365Loading: false,
      peopleM365Loaded: true,
      peopleM365Error: errors.join(" · ") || null,
      peopleTenantOrganization: organization,
      peopleTenantOrganizationLoading: false,
      peopleTenantOrganizationLoaded: true,
      peopleTenantOrganizationError: organizationError,
      peopleTenantOrganizationMissingScopes: organizationMissingScopes,
      peopleDirectory: mergePeopleRecords(directoryRecords),
      peopleDirectoryLoading: false,
      peopleDirectoryLoaded: true,
      peopleDirectoryError: directoryError,
      peopleDirectoryMissingScopes: directoryMissingScopes,
      peopleCategorias: categorias,
      peopleGroups: groups,
      peopleGroupsLoading: false,
      peopleGroupsLoaded: true,
      peopleGroupsError: groupsError,
    });
  },
  resetPeopleSession: () => {
    resolveInFlight.clear();
    directoryEnrichInFlight.clear();
    const current = get();
    set({
      peopleSearchQuery: "",
      peopleContacts: [],
      peopleSelectedId: null,
      peopleLoading: false,
      peopleLoaded: false,
      peopleError: null,
      peopleMissingScopes: [],
      peopleNextLinks: [],
      peopleFetchingMore: false,
      peopleFilters: [],
      peopleRequestGeneration: current.peopleRequestGeneration + 1,
      peopleSessionGeneration: current.peopleSessionGeneration + 1,
      peopleDirectoryEnrichedEmails: [],
      peopleM365Generation: current.peopleM365Generation + 1,
      peopleM365Loading: false,
      peopleM365Loaded: false,
      peopleM365Error: null,
      peopleTenantOrganization: null,
      peopleTenantOrganizationLoading: false,
      peopleTenantOrganizationLoaded: false,
      peopleTenantOrganizationError: null,
      peopleTenantOrganizationMissingScopes: [],
      peopleDirectory: [],
      peopleDirectoryLoading: false,
      peopleDirectoryLoaded: false,
      peopleDirectoryError: null,
      peopleDirectoryMissingScopes: [],
      peopleGroups: [],
      peopleGroupsLoading: false,
      peopleGroupsLoaded: false,
      peopleGroupsError: null,
      peopleSelectedGroupId: null,
      peopleGroupMembersById: {},
      peopleGroupMembersLoadingId: null,
      peopleGroupMembersError: null,
    });
  },
  selectPeopleDirectory: (peopleSelectedId = null) => {
    get().setPeopleTab("directory");
    set({
      peopleSelectedId,
      peopleSelectedGroupId: null,
      peopleGroupMembersError: null,
    });
  },
  // #406: filtra a grid pela categoria escolhida no sidebar.
  selectPeopleCategory: (nome) => {
    get().setPeopleTab("category");
    set({
      peopleSelectedCategory: nome,
      peopleSelectedId: null,
      peopleSelectedGroupId: null,
    });
  },
  // #406: (re)carrega as categorias do Outlook (masterCategories). Best-effort.
  carregarCategoriasPeople: async () => {
    try {
      const cats = await client.crCategorias();
      set({ peopleCategorias: new Map(cats.map((c) => [c.nome, c.cor])) });
    } catch {
      // cores são secundárias; a seção degrada sem cor.
    }
  },
  loadPeopleGroups: async () => {
    const {
      peopleGroupsLoading,
      peopleGroupsLoaded,
      peopleM365Loading,
      peopleM365Generation,
      peopleSessionGeneration,
    } = get();
    if (peopleGroupsLoading || peopleGroupsLoaded || peopleM365Loading) return;
    set({ peopleGroupsLoading: true, peopleGroupsError: null });
    try {
      const result = await client.crPeopleGroups();
      if (
        get().peopleSessionGeneration !== peopleSessionGeneration ||
        get().peopleM365Generation !== peopleM365Generation
      ) {
        return;
      }
      set({
        peopleGroups: result.groups,
        peopleGroupsLoading: false,
        peopleGroupsLoaded: true,
        peopleGroupsError:
          [...result.failures, ...result.missingScopes].join(" · ") || null,
      });
    } catch (error) {
      if (
        get().peopleSessionGeneration !== peopleSessionGeneration ||
        get().peopleM365Generation !== peopleM365Generation
      ) {
        return;
      }
      set({
        peopleGroupsLoading: false,
        peopleGroupsLoaded: true,
        peopleGroupsError: String(error),
      });
    }
  },
  selectPeopleGroup: async (groupId) => {
    const sessionGeneration = get().peopleSessionGeneration;
    const m365Generation = get().peopleM365Generation;
    get().setPeopleTab("groups");
    get().selectPerson(null);
    set({
      peopleSelectedGroupId: groupId,
      peopleGroupMembersError: null,
    });
    if (Object.hasOwn(get().peopleGroupMembersById, groupId)) return;

    set({ peopleGroupMembersLoadingId: groupId });
    try {
      const result = await client.crPeopleGroupMembers(groupId);
      if (
        get().peopleSessionGeneration !== sessionGeneration ||
        get().peopleM365Generation !== m365Generation
      ) {
        return;
      }
      const members = mergePeopleGroupMembers(
        result.records,
        get().peopleContacts,
      );
      set((state) => ({
        peopleGroupMembersById: {
          ...state.peopleGroupMembersById,
          [groupId]: members,
        },
        peopleGroups: state.peopleGroups.map((group) =>
          group.id === groupId
            ? { ...group, memberCount: result.memberCount }
            : group,
        ),
        peopleGroupMembersLoadingId:
          state.peopleGroupMembersLoadingId === groupId
            ? null
            : state.peopleGroupMembersLoadingId,
      }));
    } catch (error) {
      if (
        get().peopleSessionGeneration !== sessionGeneration ||
        get().peopleM365Generation !== m365Generation
      ) {
        return;
      }
      set({
        peopleGroupMembersLoadingId: null,
        peopleGroupMembersError: String(error),
      });
    }
  },
  autoEnrichDirectoryContact: async (id, sameOrganization) => {
    const sessionGeneration = get().peopleSessionGeneration;
    const m365Generation = get().peopleM365Generation;
    const contact =
      get().peopleContacts.find((candidate) => candidate.id === id) ??
      get().peopleDirectory.find((candidate) => candidate.id === id);
    const email = contact?.emails[0]?.address.trim();
    const normalizedEmail = email?.toLowerCase() ?? "";
    if (
      !contact ||
      !sameOrganization ||
      !email ||
      get().peopleDirectoryEnrichedEmails.includes(normalizedEmail)
    ) {
      return;
    }

    let request = directoryEnrichInFlight.get(normalizedEmail);
    if (!request) {
      request = client.crPeopleEnrichPreview(
        contact.contactId ?? null,
        email,
        true,
      );
      directoryEnrichInFlight.set(normalizedEmail, request);
      const clearRequest = () => {
        if (directoryEnrichInFlight.get(normalizedEmail) === request) {
          directoryEnrichInFlight.delete(normalizedEmail);
        }
      };
      void request.then(clearRequest, clearRequest);
    }

    const result = await request;
    if (
      get().peopleSessionGeneration !== sessionGeneration ||
      get().peopleM365Generation !== m365Generation
    ) {
      return;
    }
    const fields = result.fields.filter((field) =>
      DIRECTORY_AUTO_ENRICH_FIELDS.has(field.key),
    );
    const successful = result.failures.length === 0;
    set((state) => {
      const applyFields = (contacts: PeopleContact[]) =>
        fields.length > 0
          ? contacts.map((candidate) =>
              candidate.id === id
                ? applyPeopleEnrichment(candidate, fields)
                : candidate,
            )
          : contacts;
      const originalStillExists =
        state.peopleContacts.some((candidate) => candidate.id === id) ||
        state.peopleDirectory.some((candidate) => candidate.id === id);
      return {
        peopleContacts: applyFields(state.peopleContacts),
        peopleDirectory: applyFields(state.peopleDirectory),
        peopleDirectoryEnrichedEmails:
          successful && originalStillExists
            ? Array.from(
                new Set([
                  ...state.peopleDirectoryEnrichedEmails,
                  normalizedEmail,
                ]),
              )
            : state.peopleDirectoryEnrichedEmails,
      };
    });

    if (fields.length === 0 && result.failures.length > 0) {
      throw new Error(result.failures.join(" · "));
    }
  },
  assignPeopleOrganization: async (organizationId, contactIds) => {
    const organization = get().organizations.find(
      (candidate) => candidate.id === organizationId,
    );
    if (!organization) throw new Error("Organization not found.");

    const requested = Array.from(new Set(contactIds))
      .map((id) => get().peopleContacts.find((contact) => contact.id === id))
      .filter((contact): contact is PeopleContact => Boolean(contact));
    const editable = requested.filter((contact) => Boolean(contact.contactId));
    const skipped = requested.length - editable.length;
    if (editable.length === 0) {
      return { assigned: 0, skipped, failed: 0 };
    }

    const previousCompanies = new Map(
      editable.map((contact) => [
        contact.id,
        {
          company: contact.company,
          companySource: contact.companySource,
        },
      ]),
    );
    const organizationSnapshot = get().organizations.find(
      (candidate) => candidate.id === organizationId,
    )!;
    const snapshotMemberIds = new Set(organizationSnapshot.memberIds);
    const snapshotExcludedIds = new Set(organizationSnapshot.excludedIds);
    const allContacts = get().peopleContacts;

    for (const contact of editable) {
      get().addContactToOrganization(organizationId, contact.id, allContacts);
    }
    set((state) => ({
      peopleContacts: state.peopleContacts.map((contact) =>
        previousCompanies.has(contact.id)
          ? {
              ...contact,
              company: organization.name,
              companySource: "contacts",
            }
          : contact,
      ),
    }));

    const writes = editable.filter(
      (contact) =>
        contact.company?.trim().toLocaleLowerCase() !==
        organization.name.trim().toLocaleLowerCase(),
    );
    if (writes.length === 0) {
      return { assigned: editable.length, skipped, failed: 0 };
    }

    const restore = (failedPeopleIds: Set<string>) => {
      set((state) => ({
        peopleContacts: state.peopleContacts.map((contact) => {
          if (!failedPeopleIds.has(contact.id)) return contact;
          const previous = previousCompanies.get(contact.id);
          return previous
            ? {
                ...contact,
                company: previous.company,
                companySource: previous.companySource,
              }
            : contact;
        }),
        organizations: state.organizations.map((candidate) => {
          if (candidate.id !== organizationId) return candidate;
          const memberIds = new Set(candidate.memberIds);
          const excludedIds = new Set(candidate.excludedIds);
          for (const id of failedPeopleIds) {
            if (snapshotMemberIds.has(id)) memberIds.add(id);
            else memberIds.delete(id);
            if (snapshotExcludedIds.has(id)) excludedIds.add(id);
            else excludedIds.delete(id);
          }
          return {
            ...candidate,
            memberIds: [...memberIds],
            excludedIds: [...excludedIds],
            updatedAt: Date.now(),
          };
        }),
      }));
    };

    try {
      const result = await client.crPeopleCompanyWrite(
        writes.map((contact) => contact.contactId!),
        organization.name,
      );
      const failedContactIds = new Set(result.failedContactIds);
      const failedPeopleIds = new Set(
        writes
          .filter(
            (contact) =>
              !result.writeAvailable ||
              failedContactIds.has(contact.contactId!),
          )
          .map((contact) => contact.id),
      );
      if (failedPeopleIds.size > 0) restore(failedPeopleIds);
      return {
        assigned: editable.length - failedPeopleIds.size,
        skipped,
        failed: failedPeopleIds.size,
      };
    } catch (error) {
      restore(new Set(writes.map((contact) => contact.id)));
      throw error;
    }
  },
  bulkEditPeopleDetails: async (contactIds, changes) => {
    const normalizedChanges = normalizeBulkDetailsChanges(changes);
    const stateAtStart = get();
    const contactsById = new Map<string, PeopleContact[]>();
    const indexContact = (contact: PeopleContact) => {
      const candidates = contactsById.get(contact.id);
      if (candidates) candidates.push(contact);
      else contactsById.set(contact.id, [contact]);
    };
    for (const contact of stateAtStart.peopleContacts) indexContact(contact);
    for (const members of Object.values(
      stateAtStart.peopleGroupMembersById,
    )) {
      for (const contact of members) {
        indexContact(contact);
      }
    }

    const requestedIds = Array.from(new Set(contactIds));
    const requestedContacts = requestedIds.map((id) => {
      const candidates = contactsById.get(id);
      return (
        candidates?.find((contact) => Boolean(contact.contactId?.trim())) ??
        candidates?.[0]
      );
    });
    const skipped = requestedContacts.filter(
      (contact) => !contact?.contactId?.trim(),
    ).length;
    const editableByContactId = new Map<string, PeopleContact>();
    for (const contact of requestedContacts) {
      const contactId = contact?.contactId?.trim();
      if (!contact || !contactId || editableByContactId.has(contactId)) {
        continue;
      }
      const canonical =
        stateAtStart.peopleContacts.find(
          (candidate) => candidate.contactId?.trim() === contactId,
        ) ?? contact;
      editableByContactId.set(contactId, canonical);
    }
    const unchangedContactIds = new Set(
      Array.from(editableByContactId)
        .filter(([, contact]) =>
          normalizedChanges.every(
            (change) =>
              bulkDetailsValue(contact, change.field) === change.value,
          ),
        )
        .map(([contactId]) => contactId),
    );
    const writes = Array.from(editableByContactId).filter(
      ([contactId]) => !unchangedContactIds.has(contactId),
    );

    if (editableByContactId.size === 0) {
      return {
        updated: 0,
        skipped,
        failed: 0,
        unchanged: 0,
      };
    }

    const targetContactIds = new Set(editableByContactId.keys());
    const writeContactIds = new Set(
      writes.map(([contactId]) => contactId),
    );
    const peopleSnapshots = new Map(
      stateAtStart.peopleContacts
        .filter((contact) =>
          writeContactIds.has(contact.contactId?.trim() ?? ""),
        )
        .map((contact) => [contact.id, bulkDetailsSnapshot(contact)]),
    );
    const groupSnapshots = new Map<
      string,
      Map<string, PeopleBulkDetailsSnapshot>
    >();
    for (const [groupId, members] of Object.entries(
      stateAtStart.peopleGroupMembersById,
    )) {
      const snapshots = new Map(
        members
          .filter((contact) =>
            writeContactIds.has(contact.contactId?.trim() ?? ""),
          )
          .map((contact) => [contact.id, bulkDetailsSnapshot(contact)]),
      );
      if (snapshots.size > 0) groupSnapshots.set(groupId, snapshots);
    }

    const updateContacts = (contacts: PeopleContact[]) =>
      contacts.map((contact) =>
        targetContactIds.has(contact.contactId?.trim() ?? "")
          ? applyBulkDetailsChanges(contact, normalizedChanges)
          : contact,
      );

    set((state) => ({
      peopleContacts: updateContacts(state.peopleContacts),
      peopleGroupMembersById: Object.fromEntries(
        Object.entries(state.peopleGroupMembersById).map(
          ([groupId, members]) => [groupId, updateContacts(members)],
        ),
      ),
    }));

    if (writes.length === 0) {
      return {
        updated: 0,
        skipped,
        failed: 0,
        unchanged: unchangedContactIds.size,
      };
    }

    const restoreContacts = (
      contacts: PeopleContact[],
      snapshots: Map<string, PeopleBulkDetailsSnapshot> | undefined,
      failedContactIds: Set<string>,
    ) =>
      snapshots
        ? contacts.map((contact) => {
            const contactId = contact.contactId?.trim();
            if (!contactId || !failedContactIds.has(contactId)) return contact;
            const snapshot = snapshots.get(contact.id);
            return snapshot ? { ...contact, ...snapshot } : contact;
          })
        : contacts;
    const restore = (failedContactIds: Set<string>) => {
      if (failedContactIds.size === 0) return;
      set((state) => ({
        peopleContacts: restoreContacts(
          state.peopleContacts,
          peopleSnapshots,
          failedContactIds,
        ),
        peopleGroupMembersById: Object.fromEntries(
          Object.entries(state.peopleGroupMembersById).map(
            ([groupId, members]) => [
              groupId,
              restoreContacts(
                members,
                groupSnapshots.get(groupId),
                failedContactIds,
              ),
            ],
          ),
        ),
      }));
    };

    try {
      const result = await client.crPeopleDetailsWrite(
        writes.map(([contactId]) => contactId),
        normalizedChanges,
      );
      const savedContactIds = new Set(result.savedContactIds);
      const reportedFailedContactIds = new Set(result.failedContactIds);
      const failedContactIds = new Set(
        writes
          .filter(
            ([contactId]) =>
              !result.writeAvailable ||
              reportedFailedContactIds.has(contactId) ||
              !savedContactIds.has(contactId),
          )
          .map(([contactId]) => contactId),
      );
      restore(failedContactIds);
      return {
        updated: writes.length - failedContactIds.size,
        skipped,
        failed: failedContactIds.size,
        unchanged: unchangedContactIds.size,
      };
    } catch (error) {
      restore(writeContactIds);
      throw error;
    }
  },
  updatePeopleContact: async (id, input) => {
    const current = get().peopleContacts.find((contact) => contact.id === id);
    if (!current?.contactId) {
      throw new Error(strPeople().pessoaNaoEditavel);
    }
    const snapshot: PeopleContact = {
      ...current,
      emails: current.emails.map((email) => ({ ...email })),
      phones: current.phones.map((phone) => ({ ...phone })),
      sources: [...current.sources],
      enrichedValues: current.enrichedValues
        ? [...current.enrichedValues]
        : undefined,
    };
    set((state) => ({
      peopleContacts: state.peopleContacts.map((contact) =>
        contact.id === id
          ? {
              ...contact,
              name: input.name,
              emails: input.emails.map((email) => ({
                ...email,
                source: email.source ?? "contacts",
              })),
              phones: input.phones.map((phone) => ({
                ...phone,
                source: phone.source ?? "contacts",
              })),
              company: input.company,
              companySource: input.company ? "contacts" : undefined,
            }
          : contact,
      ),
    }));
    try {
      await client.crPeopleContactUpdate(current.contactId, input);
    } catch (error) {
      set((state) => ({
        peopleContacts: state.peopleContacts.map((contact) =>
          contact.id === id ? snapshot : contact,
        ),
      }));
      throw error;
    }
  },
  setPeopleContactCategorias: async (id, categorias) => {
    const current = get().peopleContacts.find((contact) => contact.id === id);
    if (!current?.contactId) {
      throw new Error(strPeople().pessoaNaoEditavel);
    }
    const snapshot = [...current.categories];
    // Otimista: aplica na grid/detalhe já; reverte a lista antiga no erro.
    set((state) => ({
      peopleContacts: state.peopleContacts.map((contact) =>
        contact.id === id ? { ...contact, categories: categorias } : contact,
      ),
    }));
    try {
      await client.crPeopleContactCategories(current.contactId, categorias);
    } catch (error) {
      set((state) => ({
        peopleContacts: state.peopleContacts.map((contact) =>
          contact.id === id ? { ...contact, categories: snapshot } : contact,
        ),
      }));
      throw error;
    }
  },
  criarCategoriaPeople: async (nome, preset) => {
    const criada = await client.crCriarCategoria(nome, preset);
    // Insere no mapa nome→cor pra o seletor do detalhe mostrar na hora, sem
    // esperar um novo hydrate. Mantém a ordem de inserção (Map).
    set((state) => {
      const proximo = new Map(state.peopleCategorias);
      proximo.set(criada.nome, criada.cor);
      return { peopleCategorias: proximo };
    });
  },
  bulkSetPeopleCategorias: async (contactIds, add, remove) => {
    const ids = Array.from(new Set(contactIds));
    const byId = new Map(get().peopleContacts.map((c) => [c.id, c]));
    const removeSet = new Set(remove);
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let unchanged = 0;
    // Em série: PATCH parcial por contato (mesma rota do S3b). Poucos itens no
    // fluxo bulk; série evita rajada de 429 e mantém o rollback simples.
    for (const id of ids) {
      const contact = byId.get(id);
      const contactId = contact?.contactId?.trim();
      if (!contact || !contactId) {
        skipped += 1;
        continue;
      }
      const atuais = contact.categories ?? [];
      // Remove primeiro, depois adiciona (union) preservando a ordem atual.
      const proximas = atuais.filter((nome) => !removeSet.has(nome));
      for (const nome of add) {
        if (!proximas.includes(nome)) proximas.push(nome);
      }
      const igual =
        proximas.length === atuais.length &&
        proximas.every((nome, i) => nome === atuais[i]);
      if (igual) {
        unchanged += 1;
        continue;
      }
      const snapshot = [...atuais];
      set((state) => ({
        peopleContacts: state.peopleContacts.map((c) =>
          c.id === id ? { ...c, categories: proximas } : c,
        ),
      }));
      try {
        await client.crPeopleContactCategories(contactId, proximas);
        updated += 1;
      } catch {
        set((state) => ({
          peopleContacts: state.peopleContacts.map((c) =>
            c.id === id ? { ...c, categories: snapshot } : c,
          ),
        }));
        failed += 1;
      }
    }
    return { updated, skipped, failed, unchanged };
  },
  mergePeopleContacts: async (plan, onProgress) => {
    // Trava dupla execução (#379): reentrância enquanto uma mutação corre.
    if (get().peopleMergeRunning) {
      return {
        ok: false,
        masterUpdated: false,
        deleted: [],
        failedDeletes: [],
        error: strPeople().mergeJaRodando,
      };
    }
    const sessionGeneration = get().peopleSessionGeneration;
    // Unidades: 1 PATCH no master + M DELETEs + 1 refetch.
    const total = 1 + plan.absorbed.length + 1;
    let completed = 0;
    const report = (phase: PeopleMergeProgress["phase"]) =>
      onProgress?.({ phase, completed, total });

    set({ peopleMergeRunning: true });
    report("snapshot");
    try {
      // 1) PATCH no master PRIMEIRO (ordem segura do #376).
      report("master");
      try {
        await client.crPeopleContactUpdate(plan.master.contactId, plan.result);
      } catch (error) {
        // PATCH falhou/timeout ambíguo: ZERO delete; refetch antes de decidir
        // retry, sem tocar nos absorvidos.
        await get().loadPeople();
        set({ peopleMergeRunning: false });
        return {
          ok: false,
          masterUpdated: false,
          deleted: [],
          failedDeletes: [],
          error: String(error),
        };
      }
      completed += 1;
      // Aplica o resultado no master (otimista), igual ao updatePeopleContact.
      set((state) => ({
        peopleContacts: state.peopleContacts.map((contact) =>
          contact.id === plan.master.id
            ? {
                ...contact,
                name: plan.result.name,
                emails: plan.result.emails.map((email) => ({
                  ...email,
                  source: email.source ?? "contacts",
                })),
                phones: plan.result.phones.map((phone) => ({
                  ...phone,
                  source: phone.source ?? "contacts",
                })),
                company: plan.result.company,
                companySource: plan.result.company ? "contacts" : undefined,
              }
            : contact,
        ),
      }));

      // 2) Só APÓS o sucesso, DELETE dos absorvidos — status individual por item.
      report("absorbed");
      const deleted: string[] = [];
      const failedDeletes: Array<{ contactId: string; error: string }> = [];
      for (const absorbed of plan.absorbed) {
        try {
          await client.crPeopleContactDelete(absorbed.contactId);
          deleted.push(absorbed.contactId);
          // Remove do cache pra o refetch não ressuscitar via preservação de
          // cache (loadPeople reinjeta cacheados cujo email não resolve).
          set((state) => ({
            peopleContacts: state.peopleContacts.filter(
              (contact) => contact.id !== absorbed.id,
            ),
          }));
        } catch (error) {
          // DELETE parcial: mantém o master enriquecido; o absorvido que falhou
          // segue como duplicata. Sem rollback global cego.
          failedDeletes.push({ contactId: absorbed.contactId, error: String(error) });
        }
        completed += 1;
        report("absorbed");
      }

      // 3) Refetch/reconciliar o store.
      report("refetch");
      await get().loadPeople();
      completed += 1;
      report("done");

      // Sessão resetada no meio (ex.: logout): não fixa seleção/undo.
      if (get().peopleSessionGeneration !== sessionGeneration) {
        set({ peopleMergeRunning: false });
        return {
          ok: failedDeletes.length === 0,
          masterUpdated: true,
          deleted,
          failedDeletes,
        };
      }

      set((state) => ({
        peopleMergeRunning: false,
        // Snapshot do Undo no store (só os realmente deletados são recriáveis).
        peopleMergeUndo: { plan, deleted },
        // Sucesso: seleciona o master (se sobreviveu ao refetch).
        peopleSelectedId: state.peopleContacts.some((c) => c.id === plan.master.id)
          ? plan.master.id
          : state.peopleSelectedId,
      }));
      // Telemetria (#390): conclusão do merge (só resultado, sem PII).
      telAcaoConcluida("contatos_merge", failedDeletes.length === 0 ? "ok" : "erro");
      return {
        ok: failedDeletes.length === 0,
        masterUpdated: true,
        deleted,
        failedDeletes,
      };
    } catch (error) {
      set({ peopleMergeRunning: false });
      return {
        ok: false,
        masterUpdated: false,
        deleted: [],
        failedDeletes: [],
        error: String(error),
      };
    }
  },
  undoMergeContacts: async () => {
    const undo = get().peopleMergeUndo;
    if (!undo) {
      return {
        masterRestored: false,
        recreated: [],
        failed: [],
        error: strPeople().mergeNadaDesfazer,
      };
    }
    if (get().peopleMergeRunning) {
      return {
        masterRestored: false,
        recreated: [],
        failed: [],
        error: strPeople().mergeJaRodando,
      };
    }
    const { plan, deleted } = undo;
    const recreated: Array<{ oldId: string; newId: string }> = [];
    const failed: Array<{ contactId: string; error: string }> = [];
    let masterRestored = false;
    set({ peopleMergeRunning: true });
    try {
      // 1) Restaura o master ao estado anterior (PATCH) PRIMEIRO.
      try {
        await client.crPeopleContactUpdate(
          plan.master.contactId,
          plan.before.master,
        );
        masterRestored = true;
      } catch (error) {
        failed.push({ contactId: plan.master.contactId, error: String(error) });
      }
      // 2) Recria SÓ os absorvidos realmente deletados (novos ids; oldId→newId).
      for (const contactId of deleted) {
        const snap = plan.before.absorbed.find(
          (item) => item.contactId === contactId,
        );
        if (!snap) continue;
        try {
          const newId = await client.crPeopleContactCreate(snap.value);
          recreated.push({ oldId: contactId, newId });
        } catch (error) {
          failed.push({ contactId, error: String(error) });
        }
      }
      // 3) Refetch e encerra o Undo.
      await get().loadPeople();
      set({ peopleMergeRunning: false, peopleMergeUndo: null });
      return { masterRestored, recreated, failed };
    } catch (error) {
      set({ peopleMergeRunning: false });
      return { masterRestored, recreated, failed, error: String(error) };
    }
  },
  });
}

export const createPeopleSlice = criarPeopleSlice();
