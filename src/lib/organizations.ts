import type { PeopleContact } from "./people";
import type { AppUser, OrgStatus } from "./types";

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

/**
 * Domínio efetivo de um login: o `domain` do token (só work) tem prioridade;
 * senão deriva do sufixo do e-mail. Normalizado (case/scheme/www-insensível).
 */
function dominioDoLogin(
  user: Pick<AppUser, "email"> & { domain?: string | null },
): string {
  if (user.domain) return normalizeDomain(user.domain);
  const email = user.email?.trim().toLocaleLowerCase() ?? "";
  const arroba = email.lastIndexOf("@");
  return arroba > 0 ? normalizeDomain(email.slice(arroba + 1)) : "";
}

/**
 * #700 2b (parte 2): deriva o `OrgStatus` CANÔNICO (#698/PS5) de um login já
 * autenticado a partir do REGISTRO DE ORGS — a fonte única (`contratada` +
 * `dominiosVerificados`, slices 2a/2b-parte1). É o "deriva do registro de orgs"
 * que o api.ts:156 promete: o Rust/PS0 entrega provider + accountKind do token; a
 * refinação contracted/uncontracted/none (que precisa da flag do config, TS-side)
 * mora aqui e alimenta o roteamento dos 3 estados no App.tsx.
 *
 * - **work** de org CONTRATADA+VERIFICADA → `contracted` (tier org).
 * - **work** de empresa não-cliente → `uncontracted` (onboarding lead-gen #698).
 * - **personal** cujo domínio bate numa org contratada+verificada → `contracted`
 *   (ABSORÇÃO JIT: quem logou pessoal mas é do domínio do cliente entra no tier org).
 * - **personal** sem match → `none` (só "minhas coisas").
 *
 * Gateado em domínio VERIFICADO (nunca sufixo cru) e na flag do admin — sem isso,
 * qualquer um com e-mail `@cliente.com` se auto-promoveria a org.
 */
export function resolverOrgStatus(
  user: Pick<AppUser, "email" | "accountKind"> & { domain?: string | null },
  orgs: PeopleOrg[],
): OrgStatus {
  const cliente = dominioEhCliente(orgs, dominioDoLogin(user));
  if (user.accountKind === "work") {
    return cliente ? "contracted" : "uncontracted";
  }
  return cliente ? "contracted" : "none";
}

/**
 * #700 2b (parte 2): a org na qual uma conta PESSOAL é absorvida (JIT), ou `null`.
 * Só conta `personal` é absorvida — a `work` já É a org (é gateada pelo #781, não
 * absorvida). É o alvo que o passo de migração de config pessoal→org (seam #555)
 * consome para saber PARA ONDE mover o estado do usuário.
 */
export function orgAbsorvente(
  user: Pick<AppUser, "email" | "accountKind"> & { domain?: string | null },
  orgs: PeopleOrg[],
): PeopleOrg | null {
  if (user.accountKind !== "personal") return null;
  return orgContratadaDoDominio(orgs, dominioDoLogin(user));
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
