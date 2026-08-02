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

function normalizeOrganizationName(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

/** #278 S4: um domínio externo derivado dos contatos + quantos contatos tem. */
export interface DominioExterno {
  dominio: string;
  total: number;
}

/**
 * #278 S4 (opção b): domínios EXTERNOS derivados dos contatos — "Other
 * organizations" é a visão por domínio, sem estado local persistido. Exclui o
 * domínio do próprio usuário e contatos sem email. Ordena por contagem (desc) e
 * depois alfabeticamente.
 */
export function dominiosExternos(
  contacts: PeopleContact[],
  userDomain: string,
): DominioExterno[] {
  const alvo = normalizeDomain(userDomain);
  const counts = new Map<string, number>();
  for (const contact of contacts) {
    const bruto = contactDomain(contact);
    if (!bruto) continue;
    const dominio = normalizeDomain(bruto);
    if (!dominio || dominio === alvo) continue;
    counts.set(dominio, (counts.get(dominio) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([dominio, total]) => ({ dominio, total }))
    .sort((a, b) => b.total - a.total || a.dominio.localeCompare(b.dominio));
}

/**
 * Resolve a entidade app-owned de um contato. O `companyName` explícito do
 * Outlook é a fonte de verdade; domínio só entra como fallback (#288).
 */
export function resolveContactOrganization(
  organizations: PeopleOrg[],
  contact: PeopleContact,
): PeopleOrg | null {
  const company = normalizeOrganizationName(contact.company);
  if (company) {
    return (
      organizations.find(
        (organization) => normalizeOrganizationName(organization.name) === company,
      ) ?? null
    );
  }
  return resolveOrganization(organizations, contactDomain(contact));
}

/** Label unificado Company ↔ Organization exibido e filtrado pelo People. */
export function contactOrganizationLabel(
  organizations: PeopleOrg[],
  contact: PeopleContact,
): string | null {
  const company = contact.company?.trim();
  if (company) return company;
  return resolveOrganization(organizations, contactDomain(contact))?.name ?? null;
}

export function organizationMembers(
  organization: PeopleOrg,
  contacts: PeopleContact[],
): PeopleContact[] {
  const domains = new Set(organization.domains.map(normalizeDomain));
  const explicit = new Set(organization.memberIds);
  const excluded = new Set(organization.excludedIds);
  const organizationName = normalizeOrganizationName(organization.name);
  return contacts.filter((contact) => {
    const company = normalizeOrganizationName(contact.company);
    if (company) return company === organizationName;
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
