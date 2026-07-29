import type { PeopleContact } from "./people";

export interface PeopleOrg {
  id: string;
  name: string;
  domains: string[];
  website?: string | null;
  notes?: string | null;
  logo?: string | null;
  memberIds: string[];
  excludedIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PeopleOrgInput {
  name: string;
  domains: string[];
  website?: string | null;
  notes?: string | null;
}

export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0] ?? "";
}

export function contactDomain(contact: PeopleContact): string | null {
  const email = contact.emails[0]?.address.trim().toLocaleLowerCase();
  const separator = email?.lastIndexOf("@") ?? -1;
  return separator > 0 ? email!.slice(separator + 1) : null;
}

export function organizationMembers(
  organization: PeopleOrg,
  contacts: PeopleContact[],
): PeopleContact[] {
  const domains = new Set(organization.domains.map(normalizeDomain));
  const explicit = new Set(organization.memberIds);
  const excluded = new Set(organization.excludedIds);
  return contacts.filter((contact) => {
    if (explicit.has(contact.id)) return true;
    const domain = contactDomain(contact);
    return Boolean(domain && domains.has(domain) && !excluded.has(contact.id));
  });
}

export function resolveOrganization(
  organizations: PeopleOrg[],
  domain: string | null | undefined,
): PeopleOrg | null {
  const normalized = normalizeDomain(domain ?? "");
  if (!normalized) return null;
  return (
    organizations.find((organization) =>
      organization.domains.some((candidate) => normalizeDomain(candidate) === normalized),
    ) ?? null
  );
}

export function suggestedOrganizationName(
  domain: string,
  contacts: PeopleContact[],
): string {
  const names = contacts
    .filter((contact) => contactDomain(contact) === normalizeDomain(domain))
    .map((contact) => contact.company?.trim())
    .filter((value): value is string => Boolean(value));
  if (names.length > 0) {
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  const label = normalizeDomain(domain).split(".")[0] ?? domain;
  return label ? label.charAt(0).toLocaleUpperCase() + label.slice(1) : "";
}
