import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalCacheBackend,
  type AppPersistido,
  type ConfigBackend,
  type ConfigSnapshot,
  type KeyValueStorage,
  type LocalCacheCodec,
} from "./config-backend.ts";
import {
  CHAVES_CONFIG_NUVEM,
  CloudConflictError,
  LayeredBackend,
  LocalStorageConfigPatchQueue,
  OneDriveJsonBackend,
  mergeCloudConfigDocuments,
  parseCloudConfigDocument,
  projetarConfigNuvem,
  type CloudConfigDocument,
  type VersionedCloudSnapshot,
  type VersionedConfigBackend,
} from "./onedrive-config-backend.ts";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const codec: LocalCacheCodec = {
  read(storage) {
    const raw = storage.getItem("zoom");
    return raw === null ? {} : { zoom: JSON.parse(raw) as number };
  },
  write(storage, patch) {
    if (patch.zoom !== undefined) {
      storage.setItem("zoom", JSON.stringify(patch.zoom));
    }
  },
  clear(storage) {
    storage.removeItem("zoom");
  },
};

test("LocalCacheBackend entrega snapshot síncrono e o mesmo estado no load", async () => {
  const storage = new MemoryStorage();
  storage.setItem("zoom", "1.25");
  const backend = new LocalCacheBackend(storage, codec);

  assert.deepEqual(backend.getSnapshot(), { zoom: 1.25 });
  assert.deepEqual(await backend.load(), { zoom: 1.25 });
});

test("LocalCacheBackend delega save e clear ao storage isolado", async () => {
  const storage = new MemoryStorage();
  storage.setItem("nao-relacionada", "preservada");
  const backend = new LocalCacheBackend(storage, codec);

  const save = backend.save({ zoom: 0.9 } as Partial<AppPersistido>);
  // O contrato público é assíncrono, mas o write-through local acontece já.
  assert.equal(storage.getItem("zoom"), "0.9");
  await save;
  assert.equal(storage.getItem("nao-relacionada"), "preservada");

  const clear = backend.clear();
  assert.equal(storage.getItem("zoom"), null);
  await clear;
  assert.equal(storage.getItem("nao-relacionada"), "preservada");
});

class MemoryBackend implements ConfigBackend, ConfigSnapshot {
  readonly saves: Array<Partial<AppPersistido>> = [];
  private state: Partial<AppPersistido>;

  constructor(state: Partial<AppPersistido>) {
    this.state = state;
  }

  getSnapshot(): Partial<AppPersistido> {
    return { ...this.state };
  }

  async load(): Promise<Partial<AppPersistido>> {
    return this.getSnapshot();
  }

  async save(patch: Partial<AppPersistido>): Promise<void> {
    this.state = { ...this.state, ...patch };
    this.saves.push({ ...patch });
  }

  async clear(): Promise<void> {
    this.state = {};
  }
}

class MemoryCloudBackend implements VersionedConfigBackend {
  readonly saves: Array<Partial<AppPersistido>> = [];
  failWrites = false;
  beforeNextSave: (() => void) | null = null;
  private document: CloudConfigDocument;
  private exists: boolean;
  private revision = 1;

  constructor(
    state: Partial<AppPersistido>,
    updatedAt: Record<string, number> = {},
    exists = Object.keys(state).length > 0,
  ) {
    this.document = {
      schemaVersion: 2,
      values: { ...state },
      updatedAt,
    };
    this.exists = exists;
  }

  async loadVersioned(): Promise<VersionedCloudSnapshot> {
    return {
      ...structuredClone(this.document),
      exists: this.exists,
      eTag: this.exists ? `v${this.revision}` : null,
      cTag: this.exists ? `c${this.revision}` : null,
    };
  }

  async saveVersioned(
    document: CloudConfigDocument,
    eTag: string | null,
  ): Promise<VersionedCloudSnapshot> {
    if (this.failWrites) throw new Error("offline");
    if (this.beforeNextSave !== null) {
      const hook = this.beforeNextSave;
      this.beforeNextSave = null;
      hook();
    }
    const expected = this.exists ? `v${this.revision}` : null;
    if (eTag !== expected) throw new CloudConflictError();
    this.document = structuredClone(document);
    this.exists = true;
    this.revision += 1;
    this.saves.push({ ...document.values });
    return this.loadVersioned();
  }

  mutateRemote(patch: Partial<AppPersistido>, updatedAt: Record<string, number>): void {
    this.document = {
      schemaVersion: 2,
      values: { ...this.document.values, ...patch },
      updatedAt: { ...this.document.updatedAt, ...updatedAt },
    };
    this.exists = true;
    this.revision += 1;
  }
}

test("projeção cloud cobre grupo A + organizations (#560) e exclui cache/sessão", () => {
  const projected = projetarConfigNuvem({
    zoom: 1.2,
    idioma: "en",
    atomsPrefs: {
      ordem: ["agenda", "email", "todos", "speeddial"],
      ocultos: ["speeddial"],
      densidade: "compacta",
    },
    pularConfirmacaoConexao: true,
    gruposColapsados: { inbox: ["today"] },
    selectedSettingsItem: "bridge",
    organizations: [],
  });

  assert.deepEqual(projected, {
    zoom: 1.2,
    idioma: "en",
    atomsPrefs: {
      ordem: ["agenda", "email", "todos", "speeddial"],
      ocultos: ["speeddial"],
      densidade: "compacta",
    },
    pularConfirmacaoConexao: true,
    // #560: orgs agora entram na projeção cloud (antes excluídas); cache/sessão
    // (gruposColapsados, selectedSettingsItem) seguem fora.
    organizations: [],
  });
});

test("#560: a projeção cloud das orgs strippa o logo (data-URI nunca sobe)", () => {
  const projected = projetarConfigNuvem({
    organizations: [
      {
        id: "org-1",
        name: "VOAZ",
        domains: ["voaz.builders"],
        website: "",
        notes: "",
        memberIds: ["c-1", "c-2"],
        excludedIds: [],
        updatedAt: 1_700_000_000_000,
        logo: "data:image/png;base64,PESADO===",
      },
    ] as AppPersistido["organizations"],
  });

  // A definição da org é preservada; só o logo vira null (re-hidratado local).
  assert.deepEqual(projected.organizations, [
    {
      id: "org-1",
      name: "VOAZ",
      domains: ["voaz.builders"],
      website: "",
      notes: "",
      memberIds: ["c-1", "c-2"],
      excludedIds: [],
      updatedAt: 1_700_000_000_000,
      logo: null,
    },
  ]);
});

test("matriz do grupo A + organizations (#560) fica explícita e completa", () => {
  assert.deepEqual(CHAVES_CONFIG_NUVEM, [
    "zoom",
    "sidebarAberta",
    "marcarLidoModo",
    "marcarLidoAtraso",
    "peopleTab",
    "ordenar",
    "ordemDesc",
    "filtros",
    "agruparConversas",
    "caixasCompartilhadas",
    "notificacoes",
    "fundoAnimado",
    "modoTema",
    "temaVisual",
    "altoContraste",
    "assinaturas",
    "assinaturaPadraoId",
    "templates",
    "undoSendDelayMs",
    "syncIntervalMinutes",
    "agendaView",
    "agendaCalendariosSelecionados",
    "organizations",
    "idioma",
    "atomsPrefs",
    "pularConfirmacaoConexao",
  ]);
});

test("OneDriveJsonBackend trata arquivo ausente e rejeita JSON não objeto", async () => {
  const writes: Array<{ content: string; eTag: string | null }> = [];
  const absent = new OneDriveJsonBackend({
    read: async () => ({ content: null, eTag: null, cTag: null }),
    write: async (content, eTag) => {
      writes.push({ content, eTag });
      return { eTag: "v1", cTag: "c1" };
    },
  });
  assert.deepEqual(await absent.load(), {});
  await absent.save({ zoom: 1.1, organizations: [] });
  // #560: orgs agora fazem parte do toolbox.json (antes eram stripadas na escrita).
  const written = JSON.parse(writes[0].content) as CloudConfigDocument;
  assert.deepEqual(written.values, { zoom: 1.1, organizations: [] });
  assert.equal(writes[0].eTag, null);

  const invalid = new OneDriveJsonBackend({
    read: async () => ({ content: "[]", eTag: "v1", cTag: "c1" }),
    write: async () => ({ eTag: "v2", cTag: "c2" }),
  });
  await assert.rejects(invalid.load(), /não contém um objeto/);
});

test("LayeredBackend semeia nuvem vazia a partir do cache normalizado", async () => {
  const local = new MemoryBackend({});
  const cloud = new MemoryCloudBackend({});
  const layered = new LayeredBackend(local, cloud, {
    baseline: () => ({ zoom: 1.25, sidebarAberta: false, templates: [] }),
  });

  layered.activate();
  assert.deepEqual(await layered.load(), {
    zoom: 1.25,
    sidebarAberta: false,
    templates: [],
  });
  assert.deepEqual(cloud.saves.at(-1), {
    zoom: 1.25,
    sidebarAberta: false,
    templates: [],
  });
  layered.deactivate();
});

test("LayeredBackend usa nuvem como autoridade e completa schema antigo", async () => {
  const local = new MemoryBackend({ zoom: 1, sidebarAberta: true });
  const cloud = new MemoryCloudBackend({ zoom: 1.5 });
  const layered = new LayeredBackend(local, cloud);

  layered.activate();
  assert.deepEqual(await layered.load(), { zoom: 1.5, sidebarAberta: true });
  assert.deepEqual(local.getSnapshot(), { zoom: 1.5, sidebarAberta: true });
  assert.deepEqual(cloud.saves.at(-1), { zoom: 1.5, sidebarAberta: true });
  layered.deactivate();
});

test("#560: troca de tenant — load traz as orgs do tenant novo, sem vazar o anterior", async () => {
  // O owner-change (prepararConfiguracaoNuvem) purga CHAVES_CONFIG_NUVEM_LOCAL —
  // que agora inclui as orgs — ANTES do load; aqui o cache local já entra vazio.
  const local = new MemoryBackend({});
  // A OneDrive do tenant NOVO (Graph delegado = usuário atual) só tem as orgs dele.
  // Cloud usa o backend versionado (S2 #559: LayeredBackend consome loadVersioned).
  const cloudTenantB = new MemoryCloudBackend({
    organizations: [
      {
        id: "b-1",
        name: "Tenant B Org",
        domains: [],
        website: "",
        notes: "",
        memberIds: [],
        excludedIds: [],
        updatedAt: 1,
        logo: null,
      },
    ] as AppPersistido["organizations"],
  });
  const layered = new LayeredBackend(local, cloudTenantB);

  layered.activate();
  const loaded = await layered.load();
  // Só as orgs do tenant B; nenhuma herança do tenant anterior.
  assert.deepEqual(
    loaded.organizations?.map((org) => org.id),
    ["b-1"],
  );
  layered.deactivate();
});

test("LayeredBackend grava local na hora e envia só o último snapshot", async () => {
  const local = new MemoryBackend({ zoom: 1 });
  const cloud = new MemoryCloudBackend({});
  const layered = new LayeredBackend(local, cloud, { debounceMs: 60_000 });

  layered.activate();
  await layered.save({ zoom: 1.1 });
  await layered.save({ zoom: 1.2 });
  assert.equal(local.getSnapshot().zoom, 1.2);
  assert.equal(cloud.saves.length, 0);
  await layered.flush();
  assert.deepEqual(cloud.saves, [{ zoom: 1.2 }]);
  layered.deactivate();
});

test("LayeredBackend cancela escrita pendente quando a conta muda", async () => {
  const local = new MemoryBackend({ zoom: 1 });
  const cloud = new MemoryCloudBackend({});
  const layered = new LayeredBackend(local, cloud, { debounceMs: 60_000 });

  layered.activate();
  await layered.save({ zoom: 1.4 });
  layered.deactivate();
  await layered.flush();
  assert.equal(cloud.saves.length, 0);
});

test("documento S1 é migrado e merge LWW preserva campos independentes", () => {
  const legacy = parseCloudConfigDocument('{"zoom":1,"idioma":"pt-BR"}');
  const merged = mergeCloudConfigDocuments(
    legacy,
    { sidebarAberta: true },
    {
      schemaVersion: 2,
      values: { zoom: 1.4, modoTema: "dark" },
      updatedAt: { zoom: 200, modoTema: 200 },
    },
    () => 300,
  );

  assert.deepEqual(merged.values, {
    zoom: 1.4,
    sidebarAberta: true,
    modoTema: "dark",
    idioma: "pt-BR",
  });
  assert.deepEqual(merged.updatedAt, {
    zoom: 200,
    sidebarAberta: 300,
    modoTema: 200,
    idioma: 0,
  });
});

test("mesmo campo usa o maior updatedAt como last-write-wins", () => {
  const remote = {
    schemaVersion: 2 as const,
    values: { zoom: 1.6 },
    updatedAt: { zoom: 400 },
  };
  const olderLocal = mergeCloudConfigDocuments(
    remote,
    {},
    { schemaVersion: 2, values: { zoom: 1.2 }, updatedAt: { zoom: 300 } },
  );
  const newerLocal = mergeCloudConfigDocuments(
    remote,
    {},
    { schemaVersion: 2, values: { zoom: 1.8 }, updatedAt: { zoom: 500 } },
  );

  assert.equal(olderLocal.values.zoom, 1.6);
  assert.equal(newerLocal.values.zoom, 1.8);
});

test("412 recarrega e refaz merge por campo sem perda silenciosa", async () => {
  const local = new MemoryBackend({ zoom: 1, idioma: "pt-BR" });
  const cloud = new MemoryCloudBackend(
    { zoom: 1, idioma: "pt-BR" },
    { zoom: 100, idioma: 100 },
  );
  const layered = new LayeredBackend(local, cloud, {
    debounceMs: 60_000,
    now: () => 300,
  });
  layered.activate("alice@example.com");
  await layered.save({ zoom: 1.5 });
  cloud.beforeNextSave = () => {
    cloud.mutateRemote({ idioma: "en" }, { idioma: 250 });
  };

  await layered.flush();
  const saved = await cloud.loadVersioned();
  assert.deepEqual(saved.values, { zoom: 1.5, idioma: "en" });
  assert.deepEqual(saved.updatedAt, { zoom: 300, idioma: 250 });
  layered.deactivate();
});

test("412 no mesmo campo mantém a edição com updatedAt mais recente", async () => {
  const local = new MemoryBackend({ zoom: 1 });
  const cloud = new MemoryCloudBackend({ zoom: 1 }, { zoom: 100 });
  const layered = new LayeredBackend(local, cloud, {
    debounceMs: 60_000,
    now: () => 300,
  });
  layered.activate("alice@example.com");
  await layered.save({ zoom: 1.5 });
  cloud.beforeNextSave = () => {
    cloud.mutateRemote({ zoom: 1.8 }, { zoom: 400 });
  };

  await layered.flush();
  const saved = await cloud.loadVersioned();
  assert.equal(saved.values.zoom, 1.8);
  assert.equal(saved.updatedAt.zoom, 400);
  layered.deactivate();
});

test("fila offline sobrevive ao restart e é isolada por conta", async () => {
  const storage = new MemoryStorage();
  const local = new MemoryBackend({ zoom: 1 });
  const offlineCloud = new MemoryCloudBackend({ zoom: 1 }, { zoom: 100 });
  offlineCloud.failWrites = true;
  const firstQueue = new LocalStorageConfigPatchQueue(storage);
  const first = new LayeredBackend(local, offlineCloud, {
    debounceMs: 60_000,
    now: () => 200,
    queue: firstQueue,
  });
  first.activate("alice@example.com");
  await first.save({ zoom: 1.25 });
  await assert.rejects(first.flush(), /offline/);
  first.deactivate();

  const onlineCloud = new MemoryCloudBackend({ zoom: 1 }, { zoom: 100 });
  const secondQueue = new LocalStorageConfigPatchQueue(storage);
  const second = new LayeredBackend(local, onlineCloud, {
    debounceMs: 60_000,
    now: () => 300,
    queue: secondQueue,
  });
  second.activate("alice@example.com");
  await second.flush();
  assert.equal((await onlineCloud.loadVersioned()).values.zoom, 1.25);
  second.deactivate();

  const otherAccount = new LocalStorageConfigPatchQueue(storage);
  otherAccount.scope("bob@example.com");
  assert.deepEqual(otherAccount.load().values, {});
});

test("evento online drena a fila sem esperar o debounce", async () => {
  let onlineListener: (() => void) | null = null;
  const onlineTarget = {
    addEventListener(_type: "online", listener: () => void) {
      onlineListener = listener;
    },
    removeEventListener() {
      onlineListener = null;
    },
  };
  const local = new MemoryBackend({ zoom: 1 });
  const cloud = new MemoryCloudBackend({ zoom: 1 }, { zoom: 100 });
  const layered = new LayeredBackend(local, cloud, {
    debounceMs: 60_000,
    now: () => 200,
    onlineTarget,
  });
  layered.activate("alice@example.com");
  await layered.save({ zoom: 1.3 });
  assert.equal(cloud.saves.length, 0);

  assert.ok(onlineListener);
  onlineListener();
  for (let attempt = 0; attempt < 10 && cloud.saves.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(cloud.saves.at(-1)?.zoom, 1.3);
  layered.deactivate();
});
