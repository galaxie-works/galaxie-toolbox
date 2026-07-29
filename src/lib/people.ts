import type {
  PeopleEmail,
  PeopleEnrichField,
  PeopleEnrichSource,
  PeoplePhone,
  PeopleRecord,
  PeopleSource,
} from "./types";

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
  sources: PeopleSource[];
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
    name: record.name || record.emails[0]?.address || "Unknown",
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
  };
}

/**
 * Une Contacts + People por e-mail. Campos explícitos de Contacts vencem;
 * People apenas preenche lacunas e acrescenta sinais de relacionamento.
 */
export function mergePeopleRecords(records: PeopleRecord[]): PeopleContact[] {
  const contacts: PeopleContact[] = [];
  const people = records
    .filter((record) => record.source === "people")
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
    if (!existing.sources.includes("people")) existing.sources.push("people");
    for (const email of existing.emails) byEmail.set(keyEmail(email.address), existing);
  }

  return contacts.sort((a, b) => {
    const aRank = a.peopleRank ?? Number.POSITIVE_INFINITY;
    const bRank = b.peopleRank ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
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
  };

  for (const field of fields) {
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
