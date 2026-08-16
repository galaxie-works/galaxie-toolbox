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
import type { MergePlan } from "../lib/people-merge.ts";
import type { PeopleContact } from "../lib/people.ts";

/** Um contato mínimo, como se hidratado da nuvem (`/me/contacts`). */
const contatoCloud = (id: string): PeopleContact => ({
  id,
  name: id,
  emails: [{ address: `${id}@tenant-a.com` }],
  phones: [],
  organization: false,
  frequent: false,
  sources: ["contacts"],
  categories: [],
});

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
    groups: [
      {
        id: "group-2",
        name: "Engineering",
        description: "",
        mail: "engineering@galaxie.works",
        visibility: "Private",
      },
    ],
    missingScopes: [],
    failures: [],
  };
  const { state } = criarStore({
    crPeopleOrganization: async () => organization,
    crPeopleDirectory: async () => directory,
    crPeopleGroups: async () => groups,
  });
  state.peopleContacts = [];
  state.peopleGroups = [
    {
      id: "group-1",
      name: "Old group",
      description: "",
      mail: "",
      visibility: "",
    },
  ];
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
    groups: [
      {
        id: "old-group",
        name: "Old group",
        description: "",
        mail: "",
        visibility: "",
      },
    ],
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

// --- Merge execution (#379) -------------------------------------------------

/** MergePlan mínimo: master `m` + 2 absorvidos `a1`/`a2`. */
function planoDeMerge(): MergePlan {
  return {
    version: 1,
    master: { id: "contacts:m", contactId: "m" },
    absorbed: [
      { id: "contacts:a1", contactId: "a1" },
      { id: "contacts:a2", contactId: "a2" },
    ],
    before: {
      master: { name: "Master", emails: [{ address: "m@x.com" }], phones: [], company: null },
      absorbed: [
        { contactId: "a1", value: { name: "A1", emails: [{ address: "a1@x.com" }], phones: [], company: null } },
        { contactId: "a2", value: { name: "A2", emails: [{ address: "a2@x.com" }], phones: [], company: null } },
      ],
    },
    result: {
      name: "Master",
      emails: [{ address: "m@x.com" }, { address: "a1@x.com" }, { address: "a2@x.com" }],
      phones: [],
      company: null,
    },
  };
}

const listaSoMaster = async () => ({
  records: [contactRecord("m")],
  missingScopes: [],
  failures: [],
  nextLinks: [],
});

test("mergePeopleContacts patches master first, deletes absorbed and stores undo", async () => {
  const plan = planoDeMerge();
  const calls = { update: [] as { contactId: string }[], delete: [] as string[] };
  const { state } = criarStore({
    crPeopleContactUpdate: async (contactId) => {
      calls.update.push({ contactId });
    },
    crPeopleContactDelete: async (contactId) => {
      calls.delete.push(contactId);
    },
    crPeopleList: listaSoMaster,
  });

  const phases: string[] = [];
  const res = await state.mergePeopleContacts(plan, (p) => phases.push(p.phase));

  assert.equal(res.ok, true);
  assert.equal(res.masterUpdated, true);
  assert.deepEqual(res.deleted, ["a1", "a2"]);
  assert.equal(res.failedDeletes.length, 0);
  assert.deepEqual(calls.update, [{ contactId: "m" }]);
  assert.deepEqual(calls.delete, ["a1", "a2"]);
  assert.deepEqual(state.peopleMergeUndo, { plan, deleted: ["a1", "a2"] });
  assert.equal(state.peopleSelectedId, "contacts:m");
  assert.equal(state.peopleMergeRunning, false);
  assert.ok(phases.includes("master") && phases.includes("absorbed") && phases.includes("done"));
});

test("mergePeopleContacts does zero deletes when the master PATCH fails", async () => {
  const plan = planoDeMerge();
  const deletes: string[] = [];
  const { state } = criarStore({
    crPeopleContactUpdate: async () => {
      throw new Error("patch boom");
    },
    crPeopleContactDelete: async (id) => {
      deletes.push(id);
    },
    crPeopleList: async () => ({ records: [], missingScopes: [], failures: [], nextLinks: [] }),
  });

  const res = await state.mergePeopleContacts(plan);

  assert.equal(res.ok, false);
  assert.equal(res.masterUpdated, false);
  assert.deepEqual(res.deleted, []);
  assert.deepEqual(deletes, []);
  assert.equal(state.peopleMergeUndo, null);
  assert.equal(state.peopleMergeRunning, false);
  assert.match(String(res.error), /patch boom/);
});

test("mergePeopleContacts keeps the master and reports partial delete failures", async () => {
  const plan = planoDeMerge();
  const { state } = criarStore({
    crPeopleContactUpdate: async () => {},
    crPeopleContactDelete: async (id) => {
      if (id === "a2") throw new Error("delete boom");
    },
    crPeopleList: listaSoMaster,
  });

  const res = await state.mergePeopleContacts(plan);

  assert.equal(res.masterUpdated, true);
  assert.equal(res.ok, false);
  assert.deepEqual(res.deleted, ["a1"]);
  assert.equal(res.failedDeletes.length, 1);
  assert.equal(res.failedDeletes[0]?.contactId, "a2");
  // Sem rollback global cego: undo guarda só o que foi deletado de fato.
  assert.deepEqual(state.peopleMergeUndo, { plan, deleted: ["a1"] });
});

test("undoMergeContacts restores master first and recreates only deleted absorbed", async () => {
  const plan = planoDeMerge();
  const updates: { contactId: string; name: string }[] = [];
  const creates: string[] = [];
  const { state } = criarStore({
    crPeopleContactUpdate: async (contactId, input) => {
      updates.push({ contactId, name: input.name });
    },
    crPeopleContactDelete: async () => {},
    crPeopleContactCreate: async (input) => {
      creates.push(input.name);
      return `new-${creates.length}`;
    },
    crPeopleList: listaSoMaster,
  });

  await state.mergePeopleContacts(plan);
  const res = await state.undoMergeContacts();

  assert.equal(res.masterRestored, true);
  assert.deepEqual(res.recreated.map((r) => r.oldId), ["a1", "a2"]);
  assert.equal(res.failed.length, 0);
  assert.equal(state.peopleMergeUndo, null);
  // O último PATCH restaura o master ao estado anterior (before.master).
  const ultimo = updates[updates.length - 1];
  assert.equal(ultimo?.contactId, "m");
  assert.equal(ultimo?.name, "Master");
  assert.deepEqual(creates, ["A1", "A2"]);
});

const peopleContact = (
  id: string,
  categories: string[] = [],
): PeopleContact => ({
  id,
  contactId: `graph-${id}`,
  name: id,
  emails: [],
  phones: [],
  organization: false,
  frequent: false,
  sources: ["contacts"],
  categories,
});

test("#278 S3b assign categorias é otimista e reverte no erro", async () => {
  let calls = 0;
  const { state } = criarStore({
    crPeopleContactCategories: async () => {
      calls += 1;
      if (calls === 2) throw new Error("graph 500");
    },
  });
  state.peopleContacts = [peopleContact("c1")];

  // Sucesso: aplica na hora (otimista) e persiste.
  await state.setPeopleContactCategorias("c1", ["Crítico"]);
  assert.deepEqual(state.peopleContacts[0].categories, ["Crítico"]);

  // Erro: reverte pro estado anterior e propaga.
  await assert.rejects(
    state.setPeopleContactCategorias("c1", ["Azul", "Crítico"]),
  );
  assert.deepEqual(state.peopleContacts[0].categories, ["Crítico"]);
  assert.equal(calls, 2);
});

test("#278 S3b assign recusa contato não-editável (sem contactId)", async () => {
  let chamou = false;
  const { state } = criarStore({
    crPeopleContactCategories: async () => {
      chamou = true;
    },
  });
  const semContactId = { ...peopleContact("d1"), contactId: null };
  state.peopleContacts = [semContactId];

  await assert.rejects(state.setPeopleContactCategorias("d1", ["X"]));
  assert.equal(chamou, false, "não pode chamar o Graph pra item do diretório");
});

test("#278 S3b criarCategoriaPeople insere no mapa nome→cor", async () => {
  const { state } = criarStore({
    crCriarCategoria: async (nome: string) => ({ nome, cor: "#123456" }),
  });
  state.peopleCategorias = new Map();

  await state.criarCategoriaPeople("Fornecedores", "preset0");
  assert.equal(state.peopleCategorias.get("Fornecedores"), "#123456");
});

test("#278 S3c bulk categorias: add/remove, pula não-editável e conta unchanged", async () => {
  const patches: Array<{ id: string; cats: string[] }> = [];
  const { state } = criarStore({
    crPeopleContactCategories: async (contactId: string, categorias: string[]) => {
      patches.push({ id: contactId, cats: categorias });
    },
  });
  state.peopleContacts = [
    peopleContact("c1", ["Antiga"]),
    peopleContact("c2", ["Crítico"]),
    { ...peopleContact("d1"), contactId: null }, // diretório: pula
  ];

  const res = await state.bulkSetPeopleCategorias(
    ["c1", "c2", "d1"],
    ["Crítico"], // add
    ["Antiga"], // remove
  );

  // c1: -Antiga +Crítico → muda. c2: já tem Crítico e não tem Antiga → unchanged.
  assert.equal(res.updated, 1);
  assert.equal(res.unchanged, 1);
  assert.equal(res.skipped, 1);
  assert.equal(res.failed, 0);
  assert.deepEqual(patches, [{ id: "graph-c1", cats: ["Crítico"] }]);
  const c1 = state.peopleContacts.find((c) => c.id === "c1");
  assert.deepEqual(c1?.categories, ["Crítico"]);
});

test("#278 S3c bulk categorias: reverte só o item que falha e conta failed", async () => {
  const { state } = criarStore({
    crPeopleContactCategories: async (contactId: string) => {
      if (contactId === "graph-c2") throw new Error("graph 500");
    },
  });
  state.peopleContacts = [
    peopleContact("c1", []),
    peopleContact("c2", []),
  ];

  const res = await state.bulkSetPeopleCategorias(["c1", "c2"], ["Nova"], []);

  assert.equal(res.updated, 1);
  assert.equal(res.failed, 1);
  const c1 = state.peopleContacts.find((c) => c.id === "c1");
  const c2 = state.peopleContacts.find((c) => c.id === "c2");
  assert.deepEqual(c1?.categories, ["Nova"], "c1 persiste");
  assert.deepEqual(c2?.categories, [], "c2 reverte no erro");
});

// #561: contatos e categorias são adapters de NUVEM tenant-scoped. A troca de
// tenant (resetPeopleSession, #555) tem que zerar o cache — nunca servir dado
// stale de outra conta (o login re-hidrata do tenant novo).
test("#561 adapters de nuvem: resetPeopleSession zera contatos e categorias", () => {
  const { state } = criarStore();
  state.peopleContacts = [contatoCloud("a-1"), contatoCloud("a-2")];
  state.peopleCategorias = new Map([
    ["Cliente", "#ff0000"],
    ["Interno", "#00ff00"],
  ]);
  state.peopleSelectedCategory = "Cliente";

  state.resetPeopleSession();

  assert.deepEqual(state.peopleContacts, [], "contatos do tenant anterior somem");
  assert.equal(state.peopleCategorias.size, 0, "categorias do tenant anterior somem");
  assert.equal(state.peopleSelectedCategory, null, "filtro de categoria reseta");
});
