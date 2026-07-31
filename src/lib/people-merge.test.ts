import assert from "node:assert/strict";
import { test } from "node:test";

import type { PeopleContact } from "./people.ts";
import {
  buildMergePlan,
  chooseMergeMaster,
  chooseScalar,
  createMergeDraft,
  keepAllMaster,
  MergePlanValidationError,
  previewMergeResult,
  snapshotMergeSelection,
  toggleMergeEmail,
  toggleMergePhone,
  validateMergeDraft,
} from "./people-merge.ts";

function contact(
  id: string,
  contactId: string | null,
  overrides: Partial<PeopleContact> = {},
): PeopleContact {
  return {
    id,
    contactId,
    peopleId: null,
    name: id,
    emails: [{ address: `${id}@example.com`, label: "work" }],
    phones: [],
    company: null,
    organization: false,
    frequent: false,
    sources: contactId ? ["contacts"] : ["people"],
    ...overrides,
  };
}

test("selection snapshot is deep, excludes read-only and deduplicates contactId", () => {
  const first = contact("first", " contact-1 ");
  const duplicate = contact("duplicate", "contact-1");
  const readOnly = contact("readonly", null);
  const second = contact("second", "contact-2");

  const snapshot = snapshotMergeSelection([
    first,
    duplicate,
    readOnly,
    second,
  ]);
  first.emails[0].address = "changed@example.com";

  assert.deepEqual(
    snapshot.candidates.map((candidate) => candidate.contactId),
    ["contact-1", "contact-2"],
  );
  assert.equal(snapshot.candidates[0].emails[0].address, "first@example.com");
  assert.deepEqual(
    snapshot.excluded.map((candidate) => candidate.reason),
    ["duplicate-contact-id", "read-only"],
  );
});

test("master choice builds reviewed auto fields and unreviewed scalar conflicts", () => {
  const snapshot = snapshotMergeSelection([
    contact("alpha", "a", { company: null }),
    contact("beta", "b", { company: "Galaxie" }),
  ]);
  const draft = chooseMergeMaster(createMergeDraft(snapshot), "a");

  assert.equal(draft.scalars?.name.conflict, true);
  assert.equal(draft.scalars?.name.chosenContactId, "a");
  assert.equal(draft.scalars?.name.reviewed, false);
  assert.equal(draft.scalars?.company.conflict, false);
  assert.equal(draft.scalars?.company.chosenContactId, "b");
  assert.equal(draft.scalars?.company.reviewed, true);
  assert.ok(
    validateMergeDraft(draft).some(
      (error) => error.code === "scalar-unreviewed" && error.field === "name",
    ),
  );
});

test("scalar choice changes the live preview and marks the conflict reviewed", () => {
  const snapshot = snapshotMergeSelection([
    contact("alpha", "a", { company: "Alpha Inc" }),
    contact("beta", "b", { company: "Beta Ltd" }),
  ]);
  let draft = chooseMergeMaster(createMergeDraft(snapshot), "a");
  draft = chooseScalar(draft, "name", "b");
  draft = chooseScalar(draft, "company", "b");

  const preview = previewMergeResult(draft);
  assert.equal(preview.name, "beta");
  assert.equal(preview.company, "Beta Ltd");
  assert.equal(draft.scalars?.name.reviewed, true);
  assert.equal(draft.scalars?.company.reviewed, true);
});

test("email and phone union uses current normalization and preserves master order", () => {
  const snapshot = snapshotMergeSelection([
    contact("master", "m", {
      emails: [{ address: " User@Example.com ", label: "" }],
      phones: [{ number: "+55 11 9999", label: "mobile" }],
    }),
    contact("absorbed", "a", {
      emails: [
        { address: "user@example.com", label: "work" },
        { address: "other@example.com", label: "home" },
      ],
      phones: [
        { number: "+55119999", label: "mobile" },
        { number: "+55 (11) 9999", label: "work" },
      ],
    }),
  ]);
  const draft = chooseMergeMaster(createMergeDraft(snapshot), "m");

  assert.equal(draft.emails.length, 2);
  assert.equal(draft.emails[0].value.address, " User@Example.com ");
  assert.equal(draft.emails[0].value.label, "work");
  assert.deepEqual(draft.emails[0].sourceContactIds, ["m", "a"]);
  assert.equal(draft.phones.length, 2);
  assert.deepEqual(
    draft.phones.map((option) => option.key),
    ["+55119999", "+55(11)9999"],
  );
  assert.ok(draft.emails.every((option) => option.selected));
  assert.ok(draft.phones.every((option) => option.selected));
});

test("multi-value toggles are immutable and keep option order", () => {
  const snapshot = snapshotMergeSelection([
    contact("alpha", "a"),
    contact("beta", "b"),
  ]);
  const original = chooseMergeMaster(createMergeDraft(snapshot), "a");
  const withoutEmail = toggleMergeEmail(
    original,
    original.emails[1].key,
    false,
  );
  const withoutPhone = toggleMergePhone(
    {
      ...withoutEmail,
      phones: [
        {
          key: "123",
          value: { number: "123", label: "work" },
          sourceContactIds: ["a"],
          selected: true,
        },
      ],
    },
    "123",
    false,
  );

  assert.equal(original.emails[1].selected, true);
  assert.equal(withoutEmail.emails[1].selected, false);
  assert.deepEqual(
    withoutEmail.emails.map((option) => option.key),
    original.emails.map((option) => option.key),
  );
  assert.equal(withoutPhone.phones[0].selected, false);
});

test("keepAllMaster confirms master scalar defaults and reselects the union", () => {
  const snapshot = snapshotMergeSelection([
    contact("alpha", "a", { company: "A" }),
    contact("beta", "b", { company: "B" }),
  ]);
  let draft = chooseMergeMaster(createMergeDraft(snapshot), "a");
  draft = toggleMergeEmail(draft, draft.emails[1].key, false);
  draft = keepAllMaster(draft);

  assert.equal(draft.scalars?.name.chosenContactId, "a");
  assert.equal(draft.scalars?.company.chosenContactId, "a");
  assert.equal(draft.scalars?.name.reviewed, true);
  assert.equal(draft.scalars?.company.reviewed, true);
  assert.ok(draft.emails.every((option) => option.selected));
});

test("validation requires two candidates, a master and at least one email", () => {
  const single = createMergeDraft(
    snapshotMergeSelection([contact("alpha", "a")]),
  );
  assert.deepEqual(
    validateMergeDraft(single).map((error) => error.code),
    ["not-enough-candidates", "master-required", "name-required", "email-required"],
  );

  const snapshot = snapshotMergeSelection([
    contact("alpha", "a"),
    contact("beta", "b"),
  ]);
  let draft = keepAllMaster(
    chooseMergeMaster(createMergeDraft(snapshot), "a"),
  );
  for (const email of draft.emails) {
    draft = toggleMergeEmail(draft, email.key, false);
  }
  assert.ok(
    validateMergeDraft(draft).some((error) => error.code === "email-required"),
  );
});

test("buildMergePlan is serializable, deterministic and limited to MVP fields", () => {
  const snapshot = snapshotMergeSelection([
    contact("alpha", "a", {
      company: "A",
      jobTitle: "CEO",
      photo: "data:image/png;base64,alpha",
    }),
    contact("beta", "b", {
      company: "B",
      department: "R&D",
    }),
  ]);
  const draft = keepAllMaster(
    chooseMergeMaster(createMergeDraft(snapshot), "a"),
  );
  const plan = buildMergePlan(draft);
  const serialized = JSON.parse(JSON.stringify(plan));

  assert.deepEqual(serialized, plan);
  assert.deepEqual(plan.master, { id: "alpha", contactId: "a" });
  assert.deepEqual(plan.absorbed, [{ id: "beta", contactId: "b" }]);
  assert.deepEqual(Object.keys(plan.result).sort(), [
    "company",
    "emails",
    "name",
    "phones",
  ]);
  assert.equal("jobTitle" in plan.result, false);
  assert.equal("photo" in plan.result, false);
  assert.equal(plan.before.master.name, "alpha");
  assert.equal(plan.before.absorbed[0].value.name, "beta");
});

test("buildMergePlan rejects an unreviewed scalar conflict", () => {
  const draft = chooseMergeMaster(
    createMergeDraft(
      snapshotMergeSelection([
        contact("alpha", "a"),
        contact("beta", "b"),
      ]),
    ),
    "a",
  );

  assert.throws(
    () => buildMergePlan(draft),
    (error) =>
      error instanceof MergePlanValidationError &&
      error.errors.some((item) => item.code === "scalar-unreviewed"),
  );
});
