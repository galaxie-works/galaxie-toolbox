import type { StateCreator } from "zustand";

import * as api from "@/lib/api";
import {
  applyPeopleEnrichment,
  mergePeopleRecords,
  type PeopleContact,
} from "@/lib/people";
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
  peopleRequestGeneration: number;

  loadPeople: () => Promise<void>;
  selectPerson: (id: string | null) => void;
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

  selectPerson: (peopleSelectedId) => set({ peopleSelectedId }),
  applyPeopleFields: (id, fields) =>
    set((state) => ({
      peopleContacts: state.peopleContacts.map((contact) =>
        contact.id === id ? applyPeopleEnrichment(contact, fields) : contact,
      ),
    })),
});
