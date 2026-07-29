import type {
  PeopleEmail,
  PeoplePhone,
  PeopleRecord,
  PeopleSource,
} from "./types";

/** Contato canônico compartilhado pela lista, detalhe e futuros resolvers. */
export interface PeopleContact {
  id: string;
  name: string;
  emails: PeopleEmail[];
  phones: PeoplePhone[];
  jobTitle?: string | null;
  company?: string | null;
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
  return {
    id: `${record.source}:${record.id}`,
    name: record.name || record.emails[0]?.address || "Unknown",
    emails: uniqueEmails(record.emails),
    phones: uniquePhones(record.phones),
    jobTitle: record.jobTitle,
    company: record.company,
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
      existing.jobTitle ||= contact.jobTitle;
      existing.company ||= contact.company;
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
    existing.jobTitle ||= person.jobTitle;
    existing.company ||= person.company;
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
