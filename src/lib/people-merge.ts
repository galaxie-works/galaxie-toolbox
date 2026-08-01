import type { PeopleContact } from "./people";
import type { PeopleContactEdit, PeopleEmail, PeoplePhone } from "./types";

export type MergeExclusionReason = "read-only" | "duplicate-contact-id";

export interface MergeContactSnapshot {
  id: string;
  contactId: string;
  name: string;
  emails: PeopleEmail[];
  phones: PeoplePhone[];
  company: string | null;
}

export interface MergeExcludedContact {
  id: string;
  contactId: string | null;
  name: string;
  reason: MergeExclusionReason;
}

export interface MergeSelectionSnapshot {
  candidates: MergeContactSnapshot[];
  excluded: MergeExcludedContact[];
}

export type MergeScalarField = "name" | "company";

export interface MergeScalarCandidate {
  value: string | null;
  sourceContactIds: string[];
}

export interface MergeScalarDecision {
  field: MergeScalarField;
  candidates: MergeScalarCandidate[];
  suggestedContactId: string;
  chosenContactId: string | null;
  reviewed: boolean;
  conflict: boolean;
}

export interface MergeMultiOption<T> {
  key: string;
  value: T;
  sourceContactIds: string[];
  selected: boolean;
}

export interface MergeDraft {
  candidates: MergeContactSnapshot[];
  excluded: MergeExcludedContact[];
  masterContactId: string | null;
  scalars: Record<MergeScalarField, MergeScalarDecision> | null;
  emails: MergeMultiOption<PeopleEmail>[];
  phones: MergeMultiOption<PeoplePhone>[];
}

export type MergeValidationCode =
  | "not-enough-candidates"
  | "master-required"
  | "master-invalid"
  | "absorbed-required"
  | "scalar-choice-required"
  | "scalar-unreviewed"
  | "name-required"
  | "name-too-long"
  | "company-too-long"
  | "email-required"
  | "too-many-emails"
  | "email-invalid"
  | "email-label-too-long"
  | "too-many-phones"
  | "phone-invalid"
  | "phone-label-too-long";

export interface MergeValidationError {
  code: MergeValidationCode;
  field?: MergeScalarField | "emails" | "phones";
  key?: string;
}

export interface MergePlan {
  version: 1;
  master: {
    id: string;
    contactId: string;
  };
  absorbed: Array<{
    id: string;
    contactId: string;
  }>;
  before: {
    master: PeopleContactEdit;
    absorbed: Array<{
      contactId: string;
      value: PeopleContactEdit;
    }>;
  };
  result: PeopleContactEdit;
}

export class MergePlanValidationError extends Error {
  readonly errors: MergeValidationError[];

  constructor(errors: MergeValidationError[]) {
    super("The merge draft is not ready to build a plan.");
    this.name = "MergePlanValidationError";
    this.errors = errors;
  }
}

function cloneEmail(email: PeopleEmail): PeopleEmail {
  return { ...email };
}

function clonePhone(phone: PeoplePhone): PeoplePhone {
  return { ...phone };
}

function cloneSnapshot(contact: MergeContactSnapshot): MergeContactSnapshot {
  return {
    ...contact,
    emails: contact.emails.map(cloneEmail),
    phones: contact.phones.map(clonePhone),
  };
}

function snapshotToEdit(contact: MergeContactSnapshot): PeopleContactEdit {
  return {
    name: contact.name,
    emails: contact.emails.map(cloneEmail),
    phones: contact.phones.map(clonePhone),
    company: contact.company,
  };
}

/** Captures the current bulk selection without retaining reactive/store objects. */
export function snapshotMergeSelection(
  selected: readonly PeopleContact[],
): MergeSelectionSnapshot {
  const candidates: MergeContactSnapshot[] = [];
  const excluded: MergeExcludedContact[] = [];
  const seenContactIds = new Set<string>();

  for (const contact of selected) {
    const contactId = contact.contactId?.trim() || null;
    if (!contactId) {
      excluded.push({
        id: contact.id,
        contactId: null,
        name: contact.name,
        reason: "read-only",
      });
      continue;
    }
    if (seenContactIds.has(contactId)) {
      excluded.push({
        id: contact.id,
        contactId,
        name: contact.name,
        reason: "duplicate-contact-id",
      });
      continue;
    }
    seenContactIds.add(contactId);
    candidates.push({
      id: contact.id,
      contactId,
      name: contact.name,
      emails: contact.emails.map(cloneEmail),
      phones: contact.phones.map(clonePhone),
      company: contact.company ?? null,
    });
  }

  return { candidates, excluded };
}

export function createMergeDraft(selection: MergeSelectionSnapshot): MergeDraft {
  return {
    candidates: selection.candidates.map(cloneSnapshot),
    excluded: selection.excluded.map((contact) => ({ ...contact })),
    masterContactId: null,
    scalars: null,
    emails: [],
    phones: [],
  };
}

function orderedCandidates(
  candidates: readonly MergeContactSnapshot[],
  masterContactId: string,
): MergeContactSnapshot[] {
  const master = candidates.find(
    (candidate) => candidate.contactId === masterContactId,
  );
  if (!master) throw new RangeError("Unknown merge master.");
  return [
    master,
    ...candidates.filter((candidate) => candidate.contactId !== masterContactId),
  ];
}

function scalarValue(
  candidate: MergeContactSnapshot,
  field: MergeScalarField,
): string | null {
  const value = field === "name" ? candidate.name : candidate.company;
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function scalarDecision(
  candidates: readonly MergeContactSnapshot[],
  masterContactId: string,
  field: MergeScalarField,
): MergeScalarDecision {
  const grouped = new Map<string, MergeScalarCandidate>();
  for (const candidate of candidates) {
    const value = scalarValue(candidate, field);
    if (value == null) continue;
    const key = value.toLocaleLowerCase();
    const existing = grouped.get(key);
    if (existing) existing.sourceContactIds.push(candidate.contactId);
    else grouped.set(key, { value, sourceContactIds: [candidate.contactId] });
  }

  const values = [...grouped.values()];
  if (values.length === 0) {
    values.push({
      value: field === "name" ? "" : null,
      sourceContactIds: [masterContactId],
    });
  }
  const masterValue = values.find((candidate) =>
    candidate.sourceContactIds.includes(masterContactId),
  );
  const suggestedContactId = masterValue
    ? masterContactId
    : values[0].sourceContactIds[0];
  const conflict = values.length > 1;

  return {
    field,
    candidates: values,
    suggestedContactId,
    chosenContactId: suggestedContactId,
    reviewed: !conflict,
    conflict,
  };
}

function emailKey(email: PeopleEmail): string {
  return email.address.trim().toLocaleLowerCase();
}

function phoneKey(phone: PeoplePhone): string {
  return phone.number.replace(/\s+/g, "");
}

function emailOptions(
  candidates: readonly MergeContactSnapshot[],
): MergeMultiOption<PeopleEmail>[] {
  const options: MergeMultiOption<PeopleEmail>[] = [];
  const byKey = new Map<string, MergeMultiOption<PeopleEmail>>();
  for (const candidate of candidates) {
    candidate.emails.forEach((email, index) => {
      const normalized = emailKey(email);
      const key = normalized || `invalid-email:${candidate.contactId}:${index}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.sourceContactIds.includes(candidate.contactId)) {
          existing.sourceContactIds.push(candidate.contactId);
        }
        if (!existing.value.label?.trim() && email.label?.trim()) {
          existing.value = { ...existing.value, label: email.label };
        }
        return;
      }
      const option = {
        key,
        value: cloneEmail(email),
        sourceContactIds: [candidate.contactId],
        selected: true,
      };
      byKey.set(key, option);
      options.push(option);
    });
  }
  return options;
}

function phoneOptions(
  candidates: readonly MergeContactSnapshot[],
): MergeMultiOption<PeoplePhone>[] {
  const options: MergeMultiOption<PeoplePhone>[] = [];
  const byKey = new Map<string, MergeMultiOption<PeoplePhone>>();
  for (const candidate of candidates) {
    candidate.phones.forEach((phone, index) => {
      const normalized = phoneKey(phone);
      const key = normalized || `invalid-phone:${candidate.contactId}:${index}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.sourceContactIds.includes(candidate.contactId)) {
          existing.sourceContactIds.push(candidate.contactId);
        }
        if (!existing.value.label.trim() && phone.label.trim()) {
          existing.value = { ...existing.value, label: phone.label };
        }
        return;
      }
      const option = {
        key,
        value: clonePhone(phone),
        sourceContactIds: [candidate.contactId],
        selected: true,
      };
      byKey.set(key, option);
      options.push(option);
    });
  }
  return options;
}

export function chooseMergeMaster(
  draft: MergeDraft,
  contactId: string,
): MergeDraft {
  const ordered = orderedCandidates(draft.candidates, contactId);
  return {
    ...draft,
    masterContactId: contactId,
    scalars: {
      name: scalarDecision(ordered, contactId, "name"),
      company: scalarDecision(ordered, contactId, "company"),
    },
    emails: emailOptions(ordered),
    phones: phoneOptions(ordered),
  };
}

export function chooseScalar(
  draft: MergeDraft,
  field: MergeScalarField,
  contactId: string,
): MergeDraft {
  if (!draft.scalars) throw new RangeError("Choose a merge master first.");
  const decision = draft.scalars[field];
  if (
    !decision.candidates.some((candidate) =>
      candidate.sourceContactIds.includes(contactId),
    )
  ) {
    throw new RangeError("Unknown scalar candidate.");
  }
  return {
    ...draft,
    scalars: {
      ...draft.scalars,
      [field]: {
        ...decision,
        chosenContactId: contactId,
        reviewed: true,
      },
    },
  };
}

/** Explicitly confirms master scalars and reselects the complete union. */
export function keepAllMaster(draft: MergeDraft): MergeDraft {
  const masterContactId = draft.masterContactId;
  if (!masterContactId || !draft.scalars) {
    throw new RangeError("Choose a merge master first.");
  }
  const confirmMaster = (decision: MergeScalarDecision) => {
    const masterIsCandidate = decision.candidates.some((candidate) =>
      candidate.sourceContactIds.includes(masterContactId),
    );
    return {
      ...decision,
      chosenContactId: masterIsCandidate
        ? masterContactId
        : decision.chosenContactId,
      reviewed: true,
    };
  };
  return {
    ...draft,
    scalars: {
      name: confirmMaster(draft.scalars.name),
      company: confirmMaster(draft.scalars.company),
    },
    emails: draft.emails.map((option) => ({ ...option, selected: true })),
    phones: draft.phones.map((option) => ({ ...option, selected: true })),
  };
}

function toggleOption<T>(
  options: readonly MergeMultiOption<T>[],
  key: string,
  selected: boolean,
): MergeMultiOption<T>[] {
  if (!options.some((option) => option.key === key)) {
    throw new RangeError("Unknown merge value.");
  }
  return options.map((option) =>
    option.key === key ? { ...option, selected } : option,
  );
}

export function toggleMergeEmail(
  draft: MergeDraft,
  key: string,
  selected: boolean,
): MergeDraft {
  return { ...draft, emails: toggleOption(draft.emails, key, selected) };
}

export function toggleMergePhone(
  draft: MergeDraft,
  key: string,
  selected: boolean,
): MergeDraft {
  return { ...draft, phones: toggleOption(draft.phones, key, selected) };
}

function resolvedScalar(
  decision: MergeScalarDecision | undefined,
): string | null {
  if (!decision?.chosenContactId) return null;
  return (
    decision.candidates.find((candidate) =>
      candidate.sourceContactIds.includes(decision.chosenContactId!),
    )?.value ?? null
  );
}

export function previewMergeResult(draft: MergeDraft): PeopleContactEdit {
  return {
    name: resolvedScalar(draft.scalars?.name)?.trim() ?? "",
    company: resolvedScalar(draft.scalars?.company)?.trim() || null,
    emails: draft.emails
      .filter((option) => option.selected)
      .map((option) => ({
        ...cloneEmail(option.value),
        address: option.value.address.trim(),
      })),
    phones: draft.phones
      .filter((option) => option.selected)
      .map((option) => ({
        ...clonePhone(option.value),
        number: option.value.number.trim(),
      })),
  };
}

export function validateMergeDraft(draft: MergeDraft): MergeValidationError[] {
  const errors: MergeValidationError[] = [];
  if (draft.candidates.length < 2) {
    errors.push({ code: "not-enough-candidates" });
  }
  if (!draft.masterContactId) {
    errors.push({ code: "master-required" });
  } else if (
    !draft.candidates.some(
      (candidate) => candidate.contactId === draft.masterContactId,
    )
  ) {
    errors.push({ code: "master-invalid" });
  }
  if (
    draft.masterContactId &&
    draft.candidates.filter(
      (candidate) => candidate.contactId !== draft.masterContactId,
    ).length === 0
  ) {
    errors.push({ code: "absorbed-required" });
  }

  if (draft.scalars) {
    for (const field of ["name", "company"] as const) {
      const decision = draft.scalars[field];
      if (!decision.chosenContactId) {
        errors.push({ code: "scalar-choice-required", field });
      }
      if (decision.conflict && !decision.reviewed) {
        errors.push({ code: "scalar-unreviewed", field });
      }
    }
  }

  const result = previewMergeResult(draft);
  if (!result.name) errors.push({ code: "name-required", field: "name" });
  else if (result.name.length > 256) {
    errors.push({ code: "name-too-long", field: "name" });
  }
  if ((result.company?.length ?? 0) > 256) {
    errors.push({ code: "company-too-long", field: "company" });
  }

  if (result.emails.length === 0) {
    errors.push({ code: "email-required", field: "emails" });
  }
  if (result.emails.length > 50) {
    errors.push({ code: "too-many-emails", field: "emails" });
  }
  result.emails.forEach((email, index) => {
    const key = draft.emails.filter((option) => option.selected)[index]?.key;
    if (
      email.address.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.address)
    ) {
      errors.push({ code: "email-invalid", field: "emails", key });
    }
    if ((email.label?.length ?? 0) > 128) {
      errors.push({ code: "email-label-too-long", field: "emails", key });
    }
  });

  if (result.phones.length > 50) {
    errors.push({ code: "too-many-phones", field: "phones" });
  }
  result.phones.forEach((phone, index) => {
    const key = draft.phones.filter((option) => option.selected)[index]?.key;
    if (!phone.number || phone.number.length > 64) {
      errors.push({ code: "phone-invalid", field: "phones", key });
    }
    if (phone.label.length > 128) {
      errors.push({ code: "phone-label-too-long", field: "phones", key });
    }
  });

  return errors;
}

export function buildMergePlan(draft: MergeDraft): MergePlan {
  const errors = validateMergeDraft(draft);
  if (errors.length > 0) throw new MergePlanValidationError(errors);

  const master = draft.candidates.find(
    (candidate) => candidate.contactId === draft.masterContactId,
  )!;
  const absorbed = draft.candidates.filter(
    (candidate) => candidate.contactId !== master.contactId,
  );
  return {
    version: 1,
    master: { id: master.id, contactId: master.contactId },
    absorbed: absorbed.map((contact) => ({
      id: contact.id,
      contactId: contact.contactId,
    })),
    before: {
      master: snapshotToEdit(master),
      absorbed: absorbed.map((contact) => ({
        contactId: contact.contactId,
        value: snapshotToEdit(contact),
      })),
    },
    result: previewMergeResult(draft),
  };
}
