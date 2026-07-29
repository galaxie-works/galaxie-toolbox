import type { StateCreator } from "zustand";

import * as api from "@/lib/api";
import {
  applyPeopleEnrichment,
  mergePeopleRecords,
  resolvePerson,
  type PeopleContact,
} from "@/lib/people";
import type { Filter } from "@/components/reui/filters";
import type { PeopleEnrichField } from "@/lib/types";
import type { AppStore } from "./index";

/** Cache único e exclusivamente de sessão do módulo People (#166). */
export interface PeopleSlice {
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

  loadPeople: () => Promise<void>;
  loadMorePeople: () => Promise<void>;
  selectPerson: (id: string | null) => void;
  setPeopleFilters: (filters: Filter<string>[]) => void;
  setPeopleView: (view: "table" | "cards") => void;
  setPeopleColumnVisibility: (visibility: Record<string, boolean>) => void;
  applyPeopleFields: (id: string, fields: PeopleEnrichField[]) => void;
}

export const createPeopleSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  PeopleSlice
> = (set, get) => ({
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
    company: true,
    title: true,
    email: true,
    phone: true,
    source: true,
    actions: true,
  },
  peopleRequestGeneration: 0,

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

  selectPerson: (peopleSelectedId) => set({ peopleSelectedId }),
  setPeopleFilters: (peopleFilters) => set({ peopleFilters }),
  setPeopleView: (peopleView) => set({ peopleView }),
  setPeopleColumnVisibility: (peopleColumnVisibility) =>
    set({ peopleColumnVisibility }),
  applyPeopleFields: (id, fields) =>
    set((state) => ({
      peopleContacts: state.peopleContacts.map((contact) =>
        contact.id === id ? applyPeopleEnrichment(contact, fields) : contact,
      ),
    })),
});
