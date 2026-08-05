import type { StateCreator } from "zustand";

import { fetchFavicon } from "@/lib/api";
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

const organizationLogoRequests = new Map<string, Promise<string | null>>();
const organizationLogos = new Map<string, string>();
const organizationLogoRetryAt = new Map<string, number>();
const ORGANIZATION_LOGO_RETRY_DELAY_MS = 60_000;

function fetchOrganizationLogo(source: string): Promise<string | null> {
  const key = source.toLowerCase();
  const cached = organizationLogos.get(key);
  if (cached) return Promise.resolve(cached);
  const retryAt = organizationLogoRetryAt.get(key) ?? 0;
  if (retryAt > Date.now()) return Promise.resolve(null);
  organizationLogoRetryAt.delete(key);
  const pending = organizationLogoRequests.get(key);
  if (pending) return pending;
  const request = fetchFavicon(source)
    .then((logo) => {
      if (logo) {
        organizationLogos.set(key, logo);
        organizationLogoRetryAt.delete(key);
      } else {
        organizationLogoRetryAt.set(
          key,
          Date.now() + ORGANIZATION_LOGO_RETRY_DELAY_MS,
        );
      }
      return logo;
    })
    .finally(() => {
      organizationLogoRequests.delete(key);
    });
  organizationLogoRequests.set(key, request);
  return request;
}

function organizationLogoSources(organization: PeopleOrg): string[] {
  const sources = [
    organization.website?.trim(),
    ...organization.domains.map((domain) => domain.trim()),
  ]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => {
      if (/^https?:\/\//i.test(candidate)) {
        try {
          return new URL(candidate).origin;
        } catch {
          return null;
        }
      }
      const domain = normalizeDomain(candidate);
      return domain ? `https://${domain}` : null;
    })
    .filter((candidate): candidate is string => Boolean(candidate));
  return Array.from(new Map(sources.map((source) => [source.toLowerCase(), source])).values());
}

function organizationLogoSourcesKey(organization: PeopleOrg): string {
  return organizationLogoSources(organization)
    .map((source) => source.toLowerCase())
    .join("\n");
}

/** Chave legada da persistência das organizações (app-owned, #205 → persistido). */
export const ORGANIZATIONS_KEYS = {
  organizations: "people.organizations",
} as const;

/** O que a slice de organizações persiste: as definições criadas pelo usuário. */
export interface OrganizationsPersistido {
  organizations: PeopleOrg[];
}

export interface OrganizationsSlice {
  organizations: PeopleOrg[];
  organizationSelectedId: string | null;

  selectOrganization: (id: string | null) => void;
  loadOrganizationLogo: (id: string) => Promise<void>;
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

  // #555: limpa as organizações e os caches de logo ao trocar de conta.
  resetSessaoOrganizations: () => void;
}

export const createOrganizationsSlice: StateCreator<
  AppStore,
  [["zustand/persist", unknown]],
  [],
  OrganizationsSlice
> = (set, get) => ({
  organizations: [],
  organizationSelectedId: null,

  selectOrganization: (organizationSelectedId) => set({ organizationSelectedId }),
  loadOrganizationLogo: async (id) => {
    const organization = get().organizations.find((candidate) => candidate.id === id);
    if (!organization) return;
    const sources = organizationLogoSources(organization);
    const sourcesKey = organizationLogoSourcesKey(organization);
    if (sources.length === 0 || organization.logo) return;
    for (const source of sources) {
      const logo = await fetchOrganizationLogo(source);
      if (!logo) continue;
      set((state) => ({
        organizations: state.organizations.map((candidate) =>
          candidate.id === id &&
          organizationLogoSourcesKey(candidate) === sourcesKey
            ? { ...candidate, logo }
            : candidate,
        ),
      }));
      return;
    }
  },
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
    void get().loadOrganizationLogo(id);
    return organization;
  },
  updateOrganization: (id, input) => {
    const previous = get().organizations.find((organization) => organization.id === id);
    const previousSourcesKey = previous
      ? organizationLogoSourcesKey(previous)
      : "";
    const domains = uniqueDomains(input.domains);
    const website = input.website?.trim() || null;
    set((state) => ({
      organizations: state.organizations.map((organization) =>
        organization.id === id
          ? {
              ...organization,
              name: input.name.trim(),
              domains,
              website,
              notes: input.notes?.trim() || null,
              logo:
                previousSourcesKey ===
                organizationLogoSourcesKey({
                  ...organization,
                  domains,
                  website,
                })
                  ? organization.logo
                  : null,
              updatedAt: Date.now(),
            }
          : organization,
      ),
    }));
    void get().loadOrganizationLogo(id);
  },
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

  // #555: organizações limpam na troca de conta (decisão de produto). Também
  // esvazia os caches de módulo de logo pra não vazar favicon entre contas.
  resetSessaoOrganizations: () => {
    organizationLogoRequests.clear();
    organizationLogos.clear();
    organizationLogoRetryAt.clear();
    set({ organizationSelectedId: null, organizations: [] });
  },
});
