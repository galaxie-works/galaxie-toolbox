import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  PeopleDirectoryResult,
  PeopleGroupsResult,
  PeopleOrganizationResult,
  PeopleRecord,
} from "../lib/types.ts";
import {
  criarPeopleSlice,
  type PeopleSlice,
} from "./people-slice.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}

const directoryRecord = (id: string): PeopleRecord => ({
  id,
  source: "directory",
  name: id,
  emails: [{ address: `${id}@example.com` }],
  phones: [],
  organization: true,
});

const contactRecord = (id: string): PeopleRecord => ({
  ...directoryRecord(id),
  source: "contacts",
  organization: false,
});

function criarStore(
  overrides: Parameters<typeof criarPeopleSlice>[0] = {},
) {
  let selectedTab = "contacts";
  const state = {
    setPeopleTab: (tab: string) => {
      selectedTab = tab;
    },
  } as unknown as PeopleSlice;
  const set = (
    update:
      | Partial<PeopleSlice>
      | ((current: PeopleSlice) => Partial<PeopleSlice>),
  ) => {
    Object.assign(
      state,
      typeof update === "function" ? update(state) : update,
    );
  };
  Object.assign(
    state,
    criarPeopleSlice(overrides)(
      set as never,
      (() => state) as never,
      {} as never,
    ),
  );
  return { state, selectedTab: () => selectedTab };
}

test("M365 hydration replaces isolated snapshots and invalidates member cache on force", async () => {
  const organization: PeopleOrganizationResult = {
    organization: { id: "tenant-1", name: "Galaxie" },
    missingScopes: [],
    failures: [],
  };
  const directory: PeopleDirectoryResult = {
    records: [directoryRecord("directory-1"), contactRecord("contact-1")],
    missingScopes: [],
    failures: [],
  };
  const groups: PeopleGroupsResult = {
    groups: [{ id: "group-2", name: "Engineering" }],
    missingScopes: [],
    failures: [],
  };
  const { state } = criarStore({
    crPeopleOrganization: async () => organization,
    crPeopleDirectory: async () => directory,
    crPeopleGroups: async () => groups,
  });
  state.peopleContacts = [];
  state.peopleGroups = [{ id: "group-1", name: "Old group" }];
  state.peopleGroupMembersById = {
    "group-1": [],
  };

  await state.hydratePeopleM365({ force: true });

  assert.deepEqual(state.peopleTenantOrganization, organization.organization);
  assert.deepEqual(
    state.peopleDirectory.map((person) => person.id),
    ["directory:directory-1"],
  );
  assert.deepEqual(state.peopleContacts, []);
  assert.deepEqual(state.peopleGroups, groups.groups);
  assert.deepEqual(state.peopleGroupMembersById, {});
  assert.equal(state.peopleM365Loaded, true);
});

test("forced hydration invalidates directory enrichment before replacing its snapshot", async () => {
  let enrichCalls = 0;
  const { state } = criarStore({
    crPeopleOrganization: async () => ({
      organization: { id: "tenant-1", name: "Galaxie" },
      missingScopes: [],
      failures: [],
    }),
    crPeopleDirectory: async () => ({
      records: [directoryRecord("user-1")],
      missingScopes: [],
      failures: [],
    }),
    crPeopleGroups: async () => ({
      groups: [],
      missingScopes: [],
      failures: [],
    }),
    crPeopleEnrichPreview: async () => {
      enrichCalls += 1;
      return {
        fields: [
          {
            key: "department",
            value: "R&D",
            source: "directory",
          },
        ],
        failures: [],
        writeAvailable: false,
      };
    },
  });

  await state.hydratePeopleM365({ force: true });
  await state.autoEnrichDirectoryContact("directory:user-1", true);
  assert.equal(state.peopleDirectory[0]?.department, "R&D");

  await state.hydratePeopleM365({ force: true });
  assert.equal(state.peopleDirectory[0]?.department, undefined);
  await state.autoEnrichDirectoryContact("directory:user-1", true);

  assert.equal(state.peopleDirectory[0]?.department, "R&D");
  assert.equal(enrichCalls, 2);
});

test("reset invalidates an in-flight M365 hydration and preserves display preferences", async () => {
  const organization = deferred<PeopleOrganizationResult>();
  const directory = deferred<PeopleDirectoryResult>();
  const groups = deferred<PeopleGroupsResult>();
  const { state } = criarStore({
    crPeopleOrganization: () => organization.promise,
    crPeopleDirectory: () => directory.promise,
    crPeopleGroups: () => groups.promise,
  });
  state.peopleView = "cards";
  state.peopleColumnVisibility = { name: true, email: false };

  const hydration = state.hydratePeopleM365({ force: true });
  state.resetPeopleSession();
  organization.resolve({
    organization: { id: "old-tenant", name: "Old tenant" },
    missingScopes: [],
    failures: [],
  });
  directory.resolve({
    records: [directoryRecord("old-user")],
    missingScopes: [],
    failures: [],
  });
  groups.resolve({
    groups: [{ id: "old-group", name: "Old group" }],
    missingScopes: [],
    failures: [],
  });
  await hydration;

  assert.equal(state.peopleTenantOrganization, null);
  assert.deepEqual(state.peopleDirectory, []);
  assert.deepEqual(state.peopleGroups, []);
  assert.equal(state.peopleM365Loaded, false);
  assert.equal(state.peopleView, "cards");
  assert.deepEqual(state.peopleColumnVisibility, {
    name: true,
    email: false,
  });
});

test("directory selection switches the view without mixing its snapshot into contacts", () => {
  const store = criarStore();
  store.state.peopleContacts = [];
  store.state.peopleDirectory = [];

  store.state.selectPeopleDirectory("directory-1");

  assert.equal(store.selectedTab(), "directory");
  assert.equal(store.state.peopleSelectedId, "directory-1");
  assert.deepEqual(store.state.peopleContacts, []);
});
