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
  LayeredBackend,
  OneDriveJsonBackend,
  projetarConfigNuvem,
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
  const writes: string[] = [];
  const absent = new OneDriveJsonBackend({
    read: async () => null,
    write: async (content) => void writes.push(content),
  });
  assert.deepEqual(await absent.load(), {});
  await absent.save({ zoom: 1.1, organizations: [] });
  // #560: orgs agora fazem parte do toolbox.json (antes eram stripadas na escrita).
  assert.deepEqual(JSON.parse(writes[0]), { zoom: 1.1, organizations: [] });

  const invalid = new OneDriveJsonBackend({
    read: async () => "[]",
    write: async () => undefined,
  });
  await assert.rejects(invalid.load(), /não contém um objeto/);
});

test("LayeredBackend semeia nuvem vazia a partir do cache normalizado", async () => {
  const local = new MemoryBackend({});
  const cloud = new MemoryBackend({});
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
  const cloud = new MemoryBackend({ zoom: 1.5 });
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
  const cloudTenantB = new MemoryBackend({
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
  const cloud = new MemoryBackend({});
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
  const cloud = new MemoryBackend({});
  const layered = new LayeredBackend(local, cloud, { debounceMs: 60_000 });

  layered.activate();
  await layered.save({ zoom: 1.4 });
  layered.deactivate();
  await layered.flush();
  assert.equal(cloud.saves.length, 0);
});
