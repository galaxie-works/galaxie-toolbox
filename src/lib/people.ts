import type {
  PeopleEmail,
  PeopleEnrichField,
  PeopleEnrichSource,
  PeoplePhone,
  PeopleRecord,
} from "./types";
// #464 (S2): fallback de nome sem hook (lib pura) — resolve no idioma atual.
import { DICIONARIOS } from "./strings.ts";
import { idiomaAtual } from "./idioma.tsx";

/** Contato canônico compartilhado pela lista, detalhe e futuros resolvers. */
export interface PeopleContact {
  id: string;
  contactId?: string | null;
  peopleId?: string | null;
  name: string;
  emails: PeopleEmail[];
  phones: PeoplePhone[];
  jobTitle?: string | null;
  jobTitleSource?: PeopleEnrichSource;
  company?: string | null;
  companySource?: PeopleEnrichSource;
  department?: string | null;
  departmentSource?: PeopleEnrichSource;
  officeLocation?: string | null;
  officeLocationSource?: PeopleEnrichSource;
  manager?: string | null;
  managerSource?: PeopleEnrichSource;
  photo?: string | null;
  photoSource?: PeopleEnrichSource;
  /** Campos já confirmados nesta sessão, para não reapresentar o mesmo diff. */
  enrichedValues?: string[];
  organization: boolean;
  frequent: boolean;
  peopleRank?: number | null;
  sources: PeopleEnrichSource[];
  /** Categorias do Outlook (#406). Só contatos (`contacts`) têm; outros = []. */
  categories: string[];
}

function keyEmail(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function uniqueEmails(values: PeopleEmail[]): PeopleEmail[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyEmail(value.address);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniquePhones(values: PeoplePhone[]): PeoplePhone[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.number.replace(/\s+/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fromRecord(record: PeopleRecord): PeopleContact {
  const source = record.source;
  return {
    id: `${record.source}:${record.id}`,
    contactId: source === "contacts" ? record.id : null,
    peopleId: source === "people" ? record.id : null,
    name:
      record.name ||
      record.emails[0]?.address ||
      DICIONARIOS[idiomaAtual()].controlRoom.peopleSemNome,
    emails: uniqueEmails(
      record.emails.map((email) => ({ ...email, source: email.source ?? source })),
    ),
    phones: uniquePhones(
      record.phones.map((phone) => ({ ...phone, source: phone.source ?? source })),
    ),
    jobTitle: record.jobTitle,
    jobTitleSource: record.jobTitle ? source : undefined,
    company: record.company,
    companySource: record.company ? source : undefined,
    department: record.department,
    departmentSource: record.department ? source : undefined,
    officeLocation: record.officeLocation,
    officeLocationSource: record.officeLocation ? source : undefined,
    manager: record.manager,
    managerSource: record.manager ? source : undefined,
    organization: record.organization,
    frequent:
      record.source === "people" &&
      record.peopleRank != null &&
      record.peopleRank < 10,
    peopleRank: record.peopleRank,
    sources: [record.source],
    categories: record.categories ?? [],
  };
}

/**
 * Une Contacts + People por e-mail. Campos explícitos de Contacts vencem;
 * People apenas preenche lacunas e acrescenta sinais de relacionamento.
 */
export function mergePeopleRecords(records: PeopleRecord[]): PeopleContact[] {
  const contacts: PeopleContact[] = [];
  const people = records
    .filter((record) => record.source !== "contacts")
    .map(fromRecord);
  const byEmail = new Map<string, PeopleContact>();

  for (const contact of records
    .filter((record) => record.source === "contacts")
    .map(fromRecord)) {
    const existing = contact.emails
      .map((email) => byEmail.get(keyEmail(email.address)))
      .find(Boolean);
    if (existing) {
      existing.emails = uniqueEmails([...existing.emails, ...contact.emails]);
      existing.phones = uniquePhones([...existing.phones, ...contact.phones]);
      existing.name ||= contact.name;
      if (!existing.jobTitle && contact.jobTitle) {
        existing.jobTitle = contact.jobTitle;
        existing.jobTitleSource = contact.jobTitleSource;
      }
      if (!existing.company && contact.company) {
        existing.company = contact.company;
        existing.companySource = contact.companySource;
      }
      if (!existing.department && contact.department) {
        existing.department = contact.department;
        existing.departmentSource = contact.departmentSource;
      }
      if (!existing.officeLocation && contact.officeLocation) {
        existing.officeLocation = contact.officeLocation;
        existing.officeLocationSource = contact.officeLocationSource;
      }
      if (!existing.manager && contact.manager) {
        existing.manager = contact.manager;
        existing.managerSource = contact.managerSource;
      }
      // #406: une as categorias do Outlook (só contatos as têm).
      if (contact.categories.length) {
        existing.categories = Array.from(
          new Set([...existing.categories, ...contact.categories]),
        );
      }
      for (const email of existing.emails) byEmail.set(keyEmail(email.address), existing);
      continue;
    }
    contacts.push(contact);
    for (const email of contact.emails) byEmail.set(keyEmail(email.address), contact);
  }

  for (const person of people) {
    const existing = person.emails
      .map((email) => byEmail.get(keyEmail(email.address)))
      .find(Boolean);
    if (!existing) {
      contacts.push(person);
      for (const email of person.emails) byEmail.set(keyEmail(email.address), person);
      continue;
    }

    existing.emails = uniqueEmails([...existing.emails, ...person.emails]);
    existing.phones = uniquePhones([...existing.phones, ...person.phones]);
    existing.peopleId ||= person.peopleId;
    if (!existing.jobTitle && person.jobTitle) {
      existing.jobTitle = person.jobTitle;
      existing.jobTitleSource = person.jobTitleSource;
    }
    if (!existing.company && person.company) {
      existing.company = person.company;
      existing.companySource = person.companySource;
    }
    existing.organization ||= person.organization;
    existing.frequent ||= person.frequent;
    existing.peopleRank =
      existing.peopleRank == null
        ? person.peopleRank
        : person.peopleRank == null
          ? existing.peopleRank
          : Math.min(existing.peopleRank, person.peopleRank);
    for (const source of person.sources) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
    }
    for (const email of existing.emails) byEmail.set(keyEmail(email.address), existing);
  }

  return contacts.sort((a, b) => {
    const aRank = a.peopleRank ?? Number.POSITIVE_INFINITY;
    const bRank = b.peopleRank ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/**
 * Mantém a completude dos membros do diretório e reaproveita os dados mais ricos
 * de Contacts/People quando o mesmo endereço já existe no cache da sessão.
 */
export function mergePeopleGroupMembers(
  records: PeopleRecord[],
  cached: PeopleContact[],
): PeopleContact[] {
  return mergePeopleRecords(records).map((member) => {
    const existing = member.emails
      .map((email) => resolvePerson(cached, email.address))
      .find(Boolean);
    if (!existing) return member;

    return {
      ...member,
      ...existing,
      id: member.id,
      emails: uniqueEmails([...existing.emails, ...member.emails]),
      phones: uniquePhones([...existing.phones, ...member.phones]),
      jobTitle: existing.jobTitle || member.jobTitle,
      jobTitleSource: existing.jobTitle
        ? existing.jobTitleSource
        : member.jobTitleSource,
      company: existing.company || member.company,
      companySource: existing.company
        ? existing.companySource
        : member.companySource,
      department: existing.department || member.department,
      departmentSource: existing.department
        ? existing.departmentSource
        : member.departmentSource,
      officeLocation: existing.officeLocation || member.officeLocation,
      officeLocationSource: existing.officeLocation
        ? existing.officeLocationSource
        : member.officeLocationSource,
      organization: true,
      frequent: existing.frequent,
      sources: Array.from(new Set([...existing.sources, ...member.sources])),
    };
  });
}

/** Resolver único por e-mail para o futuro hover-card e integrações do compose. */
export function resolvePerson(
  contacts: PeopleContact[],
  email: string,
): PeopleContact | undefined {
  const key = keyEmail(email);
  return contacts.find((contact) =>
    contact.emails.some((item) => keyEmail(item.address) === key),
  );
}

/** Aplica localmente apenas os campos confirmados no preview do Enrich. */
export function applyPeopleEnrichment(
  contact: PeopleContact,
  fields: PeopleEnrichField[],
): PeopleContact {
  const enrichedValues = [...(contact.enrichedValues ?? [])];
  const next: PeopleContact = {
    ...contact,
    emails: [...contact.emails],
    phones: [...contact.phones],
    enrichedValues,
    sources: [...contact.sources],
  };

  for (const field of fields) {
    if (!next.sources.includes(field.source)) next.sources.push(field.source);
    const identity = peopleEnrichFieldIdentity(field);
    if (!enrichedValues.includes(identity)) {
      enrichedValues.push(identity);
    }
    switch (field.key) {
      case "email":
        next.emails = uniqueEmails([
          ...next.emails,
          {
            address: field.value,
            label: field.label,
            source: field.source,
          },
        ]);
        break;
      case "photo":
        next.photo = field.value;
        next.photoSource = field.source;
        break;
      case "businessPhone":
      case "mobilePhone":
        next.phones = uniquePhones([
          ...next.phones,
          {
            number: field.value,
            label: field.key === "mobilePhone" ? "mobile" : field.label || "work",
            source: field.source,
          },
        ]);
        break;
      case "jobTitle":
        next.jobTitle = field.value;
        next.jobTitleSource = field.source;
        break;
      case "companyName":
        next.company = field.value;
        next.companySource = field.source;
        break;
      case "department":
        next.department = field.value;
        next.departmentSource = field.source;
        break;
      case "officeLocation":
        next.officeLocation = field.value;
        next.officeLocationSource = field.source;
        break;
      case "manager":
        next.manager = field.value;
        next.managerSource = field.source;
        break;
    }
  }

  return next;
}

export function peopleEnrichFieldIdentity(field: PeopleEnrichField): string {
  if (field.key === "photo") return `photo:${field.source}`;
  return `${field.key}:${field.value.trim().toLocaleLowerCase()}`;
}
