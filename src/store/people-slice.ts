import type { StateCreator } from "zustand";

import * as api from "@/lib/api";
import {
  applyPeopleEnrichment,
  mergePeopleGroupMembers,
  mergePeopleRecords,
  resolvePerson,
  type PeopleContact,
} from "@/lib/people";
import type { Filter } from "@/components/reui/filters";
import type {
  PeopleContactEdit,
  PeopleEnrichFieldKey,
  PeopleEnrichPreview,
  PeopleGroup,
  Pessoa,
} from "@/lib/types";
import type { AppStore } from "./index";

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
  peopleDirectoryEnrichedEmails: string[];
  peopleGroups: PeopleGroup[];
  peopleGroupsLoading: boolean;
  peopleGroupsLoaded: boolean;
  peopleGroupsError: string | null;
  peopleSelectedGroupId: string | null;
  peopleGroupMembersById: Record<string, PeopleContact[]>;
  peopleGroupMembersLoadingId: string | null;
  peopleGroupMembersError: string | null;

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
  loadPeopleGroups: () => Promise<void>;
  selectPeopleGroup: (groupId: string) => Promise<void>;
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
  updatePeopleContact: (id: string, input: PeopleContactEdit) => Promise<void>;
}

export const createPeopleSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  PeopleSlice
> = (set, get) => ({
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
  peopleDirectoryEnrichedEmails: [],
  peopleGroups: [],
  peopleGroupsLoading: false,
  peopleGroupsLoaded: false,
  peopleGroupsError: null,
  peopleSelectedGroupId: null,
  peopleGroupMembersById: {},
  peopleGroupMembersLoadingId: null,
  peopleGroupMembersError: null,

  loadPeople: async () => {
    const generation = get().peopleRequestGeneration + 1;
    set({
      peopleLoading: true,
      peopleError: null,
      peopleRequestGeneration: generation,
    });
    try {
      const result = await api.crPeopleList();
      if (get().peopleRequestGeneration !== generation) return;
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
      if (get().peopleRequestGeneration !== generation) return;
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
    set({ peopleFetchingMore: true });
    try {
      const result = await api.crPeopleList(peopleNextLinks);
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

    const request = (async () => {
      let person =
        fallback?.origem && fallback.email.trim().toLocaleLowerCase() === normalized
          ? fallback
          : undefined;
      if (!person) {
        const suggestions = await api.crPessoas(email);
        person = suggestions.find(
          (candidate) =>
            candidate.email.trim().toLocaleLowerCase() === normalized,
        );
      }
      if (!person) return null;

      const current = resolvePerson(get().peopleContacts, normalized);
      if (current) return current;

      const contact = personFromSuggestion(person);
      set((state) => ({
        peopleContacts: [...state.peopleContacts, contact],
      }));
      return contact;
    })()
      .catch(() => null)
      .finally(() => resolveInFlight.delete(normalized));

    resolveInFlight.set(normalized, request);
    return request;
  },

  selectPerson: (peopleSelectedId) => set({ peopleSelectedId }),
  setPeopleFilters: (peopleFilters) => set({ peopleFilters }),
  setPeopleView: (peopleView) => set({ peopleView }),
  setPeopleColumnVisibility: (peopleColumnVisibility) =>
    set({ peopleColumnVisibility }),
  setPeopleSearchQuery: (peopleSearchQuery) => set({ peopleSearchQuery }),
  loadPeopleGroups: async () => {
    const { peopleGroupsLoading, peopleGroupsLoaded } = get();
    if (peopleGroupsLoading || peopleGroupsLoaded) return;
    set({ peopleGroupsLoading: true, peopleGroupsError: null });
    try {
      const result = await api.crPeopleGroups();
      set({
        peopleGroups: result.groups,
        peopleGroupsLoading: false,
        peopleGroupsLoaded: true,
        peopleGroupsError:
          [...result.failures, ...result.missingScopes].join(" · ") || null,
      });
    } catch (error) {
      set({
        peopleGroupsLoading: false,
        peopleGroupsLoaded: true,
        peopleGroupsError: String(error),
      });
    }
  },
  selectPeopleGroup: async (groupId) => {
    get().setPeopleTab("groups");
    get().selectPerson(null);
    set({
      peopleSelectedGroupId: groupId,
      peopleGroupMembersError: null,
    });
    if (Object.hasOwn(get().peopleGroupMembersById, groupId)) return;

    set({ peopleGroupMembersLoadingId: groupId });
    try {
      const result = await api.crPeopleGroupMembers(groupId);
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
      set({
        peopleGroupMembersLoadingId: null,
        peopleGroupMembersError: String(error),
      });
    }
  },
  autoEnrichDirectoryContact: async (id, sameOrganization) => {
    const contact = get().peopleContacts.find((candidate) => candidate.id === id);
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
      request = api
        .crPeopleEnrichPreview(contact.contactId ?? null, email, true)
        .finally(() => directoryEnrichInFlight.delete(normalizedEmail));
      directoryEnrichInFlight.set(normalizedEmail, request);
    }

    const result = await request;
    const fields = result.fields.filter((field) =>
      DIRECTORY_AUTO_ENRICH_FIELDS.has(field.key),
    );
    const successful = result.failures.length === 0;
    set((state) => {
      const originalStillExists = state.peopleContacts.some(
        (candidate) => candidate.id === id,
      );
      return {
        peopleContacts:
          fields.length > 0
            ? state.peopleContacts.map((candidate) =>
                candidate.id === id
                  ? applyPeopleEnrichment(candidate, fields)
                  : candidate,
              )
            : state.peopleContacts,
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
      const result = await api.crPeopleCompanyWrite(
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
  updatePeopleContact: async (id, input) => {
    const current = get().peopleContacts.find((contact) => contact.id === id);
    if (!current?.contactId) {
      throw new Error("This person is not an editable Microsoft contact.");
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
      await api.crPeopleContactUpdate(current.contactId, input);
    } catch (error) {
      set((state) => ({
        peopleContacts: state.peopleContacts.map((contact) =>
          contact.id === id ? snapshot : contact,
        ),
      }));
      throw error;
    }
  },
});
