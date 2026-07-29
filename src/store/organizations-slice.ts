import type { StateCreator } from "zustand";

import {
  contactDomain,
  normalizeDomain,
  type PeopleOrg,
  type PeopleOrgInput,
} from "@/lib/organizations";
import type { PeopleContact } from "@/lib/people";
import type { AppStore } from "./index";

function uniqueDomains(domains: string[]): string[] {
  return Array.from(new Set(domains.map(normalizeDomain).filter(Boolean)));
}

export interface OrganizationsSlice {
  organizations: PeopleOrg[];
  organizationSelectedId: string | null;

  selectOrganization: (id: string | null) => void;
  createOrganization: (input: PeopleOrgInput) => PeopleOrg;
  updateOrganization: (id: string, input: PeopleOrgInput) => void;
  assignOrganizationContacts: (
    id: string,
    selectedIds: string[],
    contacts: PeopleContact[],
  ) => void;
  addContactToOrganization: (
    id: string,
    contactId: string,
    contacts: PeopleContact[],
  ) => void;
  removeContactFromOrganization: (
    id: string,
    contactId: string,
    contacts: PeopleContact[],
  ) => void;
}

export const createOrganizationsSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  OrganizationsSlice
> = (set) => ({
  organizations: [],
  organizationSelectedId: null,

  selectOrganization: (organizationSelectedId) => set({ organizationSelectedId }),
  createOrganization: (input) => {
    const domains = uniqueDomains(input.domains);
    const now = Date.now();
    const id = `org:${domains[0] || crypto.randomUUID()}`;
    const organization: PeopleOrg = {
      id,
      name: input.name.trim(),
      domains,
      website: input.website?.trim() || null,
      notes: input.notes?.trim() || null,
      logo: null,
      memberIds: [],
      excludedIds: [],
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({
      organizations: [
        ...state.organizations.filter((candidate) => candidate.id !== id),
        organization,
      ],
      organizationSelectedId: id,
    }));
    return organization;
  },
  updateOrganization: (id, input) =>
    set((state) => ({
      organizations: state.organizations.map((organization) =>
        organization.id === id
          ? {
              ...organization,
              name: input.name.trim(),
              domains: uniqueDomains(input.domains),
              website: input.website?.trim() || null,
              notes: input.notes?.trim() || null,
              updatedAt: Date.now(),
            }
          : organization,
      ),
    })),
  assignOrganizationContacts: (id, selectedIds, contacts) =>
    set((state) => ({
      organizations: state.organizations.map((organization) => {
        if (organization.id !== id) return organization;
        const selected = new Set(selectedIds);
        const domains = new Set(organization.domains.map(normalizeDomain));
        const memberIds = contacts
          .filter((contact) => {
            const domain = contactDomain(contact);
            return selected.has(contact.id) && (!domain || !domains.has(domain));
          })
          .map((contact) => contact.id);
        const excludedIds = contacts
          .filter((contact) => {
            const domain = contactDomain(contact);
            return Boolean(domain && domains.has(domain) && !selected.has(contact.id));
          })
          .map((contact) => contact.id);
        return { ...organization, memberIds, excludedIds, updatedAt: Date.now() };
      }),
    })),
  addContactToOrganization: (id, contactId, contacts) =>
    set((state) => ({
      organizations: state.organizations.map((organization) => {
        if (organization.id !== id) return organization;
        const contact = contacts.find((candidate) => candidate.id === contactId);
        const domain = contact ? contactDomain(contact) : null;
        const derived = Boolean(
          domain && organization.domains.some((candidate) => normalizeDomain(candidate) === domain),
        );
        return {
          ...organization,
          memberIds: derived
            ? organization.memberIds.filter((candidate) => candidate !== contactId)
            : Array.from(new Set([...organization.memberIds, contactId])),
          excludedIds: organization.excludedIds.filter(
            (candidate) => candidate !== contactId,
          ),
          updatedAt: Date.now(),
        };
      }),
    })),
  removeContactFromOrganization: (id, contactId, contacts) =>
    set((state) => ({
      organizations: state.organizations.map((organization) => {
        if (organization.id !== id) return organization;
        const contact = contacts.find((candidate) => candidate.id === contactId);
        const domain = contact ? contactDomain(contact) : null;
        const derived = Boolean(
          domain && organization.domains.some((candidate) => normalizeDomain(candidate) === domain),
        );
        return {
          ...organization,
          memberIds: organization.memberIds.filter(
            (candidate) => candidate !== contactId,
          ),
          excludedIds: derived
            ? Array.from(new Set([...organization.excludedIds, contactId]))
            : organization.excludedIds,
          updatedAt: Date.now(),
        };
      }),
    })),
});
