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
  /**
   * #700 2b (App público): a org é CLIENTE contratada? Flag/allowlist setada pelo
   * service admin (Wagner) — sem integração de pagamento nesta fase. É a FONTE
   * ÚNICA da qual o gating público (JIT absorção, "Work exige ser cliente") deriva.
   * Sincroniza pela mesma projeção do config-nuvem (#560). Ausente = não-contratada.
   */
  contratada?: boolean;
  /**
   * #700 2b: domínios com POSSE provada (domain-claim, slice 2a). A absorção é
   * gateada em domínio VERIFICADO, nunca pelo sufixo cru do e-mail.
   */
  dominiosVerificados?: string[];
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

/**
 * #700 2b: o domínio pertence a uma org CLIENTE contratada? DERIVA da fonte única
 * (a flag `contratada` do config, setada pelo admin) E exige que o domínio esteja
 * VERIFICADO (domain-claim) na org — nunca pelo sufixo cru. É o gate do público:
 * a absorção JIT e o "Work account exige ser cliente" (#781) consultam isto.
 */
export function orgContratadaDoDominio(
  orgs: PeopleOrg[],
  dominio: string,
): PeopleOrg | null {
  const alvo = normalizeDomain(dominio);
  if (!alvo) return null;
  return (
    orgs.find(
      (o) =>
        o.contratada === true &&
        (o.dominiosVerificados ?? []).some((d) => normalizeDomain(d) === alvo),
    ) ?? null
  );
}

/** Atalho booleano do [`orgContratadaDoDominio`]. */
export function dominioEhCliente(orgs: PeopleOrg[], dominio: string): boolean {
  return orgContratadaDoDominio(orgs, dominio) !== null;
}

function normalizeOrganizationName(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
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
