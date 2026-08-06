import * as api from "../lib/api.ts";

import type {
  AppPersistido,
  ConfigBackend,
  ConfigSnapshot,
  KeyValueStorage,
} from "./config-backend";

/**
 * Grupo A do épico #556 + `organizations` (#560, S3 — o último dado 100% local
 * migrado pra nuvem). Estado de sessão/cache visual seguem deliberadamente fora.
 * `organizations` é tenant-scoped por construção: o toolbox.json vive na OneDrive
 * do usuário atual (Graph delegado), então trocar de tenant carrega as orgs do
 * tenant novo. O `logo` (data-URI) é sempre stripado antes de subir (ver projeção).
 */
export const CHAVES_CONFIG_NUVEM = [
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
] as const satisfies readonly (keyof AppPersistido)[];

export type ChaveConfigNuvem = (typeof CHAVES_CONFIG_NUVEM)[number];
type UpdatedAtConfigNuvem = Partial<Record<ChaveConfigNuvem, number>>;

export interface CloudConfigDocument {
  schemaVersion: 2;
  values: Partial<AppPersistido>;
  updatedAt: UpdatedAtConfigNuvem;
}

export interface VersionedCloudSnapshot extends CloudConfigDocument {
  exists: boolean;
  eTag: string | null;
  cTag: string | null;
}

export function projetarConfigNuvem(
  state: Partial<AppPersistido>,
): Partial<AppPersistido> {
  const cloud: Partial<AppPersistido> = {};
  for (const key of CHAVES_CONFIG_NUVEM) {
    if (state[key] === undefined) continue;
    // #560: o `logo` das orgs é um data-URI pesado (favicon do domínio) e é
    // re-hidratado localmente; nunca sobe pro toolbox.json. Só a definição da org
    // (nome/domains/website/notes/memberIds/excludedIds/updatedAt) é a verdade.
    if (key === "organizations") {
      cloud.organizations = (state.organizations ?? []).map((org) => ({
        ...org,
        logo: null,
      }));
      continue;
    }
    Object.assign(cloud, { [key]: state[key] });
  }
  return cloud;
}

function emptyDocument(): CloudConfigDocument {
  return { schemaVersion: 2, values: {}, updatedAt: {} };
}

function cloneDocument(document: CloudConfigDocument): CloudConfigDocument {
  return {
    schemaVersion: 2,
    values: { ...document.values },
    updatedAt: { ...document.updatedAt },
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasValue(
  values: Partial<AppPersistido>,
  key: ChaveConfigNuvem,
): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function normalizeDocument(value: unknown): CloudConfigDocument {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("toolbox.json não contém um objeto de configuração");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion === 2 &&
    record.values !== null &&
    !Array.isArray(record.values) &&
    typeof record.values === "object"
  ) {
    const values = projetarConfigNuvem(record.values as Partial<AppPersistido>);
    const rawUpdatedAt = record.updatedAt;
    const updatedAt: UpdatedAtConfigNuvem = {};
    if (
      rawUpdatedAt !== null &&
      !Array.isArray(rawUpdatedAt) &&
      typeof rawUpdatedAt === "object"
    ) {
      for (const key of CHAVES_CONFIG_NUVEM) {
        const timestamp = (rawUpdatedAt as Record<string, unknown>)[key];
        if (hasValue(values, key) && typeof timestamp === "number" && Number.isFinite(timestamp)) {
          updatedAt[key] = timestamp;
        }
      }
    }
    return { schemaVersion: 2, values, updatedAt };
  }

  // Compatibilidade S1: o arquivo antigo era o objeto de preferências puro.
  return {
    schemaVersion: 2,
    values: projetarConfigNuvem(value as Partial<AppPersistido>),
    updatedAt: {},
  };
}

export function parseCloudConfigDocument(content: string | null): CloudConfigDocument {
  if (content === null || content.trim() === "") return emptyDocument();
  return normalizeDocument(JSON.parse(content) as unknown);
}

/** Merge por chave: patch com timestamp maior vence sem apagar outras chaves. */
export function mergeCloudConfigDocuments(
  remote: CloudConfigDocument,
  localSeed: Partial<AppPersistido>,
  queued: CloudConfigDocument,
  now: () => number = Date.now,
): CloudConfigDocument {
  const values: Partial<AppPersistido> = {};
  const updatedAt: UpdatedAtConfigNuvem = {};
  const seed = projetarConfigNuvem(localSeed);

  for (const key of CHAVES_CONFIG_NUVEM) {
    const remoteHas = hasValue(remote.values, key);
    const queuedHas = hasValue(queued.values, key);
    const remoteTimestamp = remote.updatedAt[key] ?? 0;
    const queuedTimestamp = queued.updatedAt[key] ?? 0;

    if (queuedHas && (!remoteHas || queuedTimestamp >= remoteTimestamp)) {
      Object.assign(values, { [key]: queued.values[key] });
      updatedAt[key] = queuedTimestamp;
    } else if (remoteHas) {
      Object.assign(values, { [key]: remote.values[key] });
      updatedAt[key] = remoteTimestamp;
    } else if (hasValue(seed, key)) {
      Object.assign(values, { [key]: seed[key] });
      updatedAt[key] = now();
    }
  }
  return { schemaVersion: 2, values, updatedAt };
}

interface OneDriveSettingsPort {
  read(): Promise<api.OneDriveSettingsReadResult>;
  write(
    content: string,
    eTag: string | null,
  ): Promise<api.OneDriveSettingsWriteResult>;
}

const apiPort: OneDriveSettingsPort = {
  read: api.onedriveSettingsRead,
  write: api.onedriveSettingsWrite,
};

export class CloudConflictError extends Error {
  constructor() {
    super("A configuração mudou em outra máquina");
    this.name = "CloudConflictError";
  }
}

function isConflict(error: unknown): boolean {
  return error instanceof CloudConflictError ||
    String(error).includes("onedrive-settings-conflict");
}

export interface VersionedConfigBackend {
  loadVersioned(): Promise<VersionedCloudSnapshot>;
  saveVersioned(
    document: CloudConfigDocument,
    eTag: string | null,
  ): Promise<VersionedCloudSnapshot>;
}

/** Arquivo privado do usuário no OneDrive; nunca cria link compartilhável. */
export class OneDriveJsonBackend implements ConfigBackend, VersionedConfigBackend {
  private readonly port: OneDriveSettingsPort;

  constructor(port: OneDriveSettingsPort = apiPort) {
    this.port = port;
  }

  async loadVersioned(): Promise<VersionedCloudSnapshot> {
    const result = await this.port.read();
    return {
      ...parseCloudConfigDocument(result.content),
      exists: result.content !== null,
      eTag: result.eTag,
      cTag: result.cTag,
    };
  }

  async saveVersioned(
    document: CloudConfigDocument,
    eTag: string | null,
  ): Promise<VersionedCloudSnapshot> {
    try {
      const result = await this.port.write(JSON.stringify(document), eTag);
      return {
        ...cloneDocument(document),
        exists: true,
        eTag: result.eTag,
        cTag: result.cTag,
      };
    } catch (error) {
      if (isConflict(error)) throw new CloudConflictError();
      throw error;
    }
  }

  async load(): Promise<Partial<AppPersistido>> {
    return (await this.loadVersioned()).values;
  }

  async save(patch: Partial<AppPersistido>): Promise<void> {
    const remote = await this.loadVersioned();
    const values = { ...remote.values, ...projetarConfigNuvem(patch) };
    const updatedAt = { ...remote.updatedAt };
    const timestamp = Date.now();
    for (const key of CHAVES_CONFIG_NUVEM) {
      if (hasValue(patch, key)) updatedAt[key] = timestamp;
    }
    await this.saveVersioned({ schemaVersion: 2, values, updatedAt }, remote.eTag);
  }

  async clear(): Promise<void> {
    const remote = await this.loadVersioned();
    await this.saveVersioned(emptyDocument(), remote.eTag);
  }
}

export interface ConfigPatchQueue {
  scope(owner: string): void;
  load(): CloudConfigDocument;
  save(document: CloudConfigDocument): void;
  clear(): void;
}

class MemoryPatchQueue implements ConfigPatchQueue {
  private document = emptyDocument();

  scope(): void {}
  load(): CloudConfigDocument { return cloneDocument(this.document); }
  save(document: CloudConfigDocument): void { this.document = cloneDocument(document); }
  clear(): void { this.document = emptyDocument(); }
}

interface StoredPatchQueue extends CloudConfigDocument {
  owner: string;
}

/** Fila durável e account-scoped para sobreviver a offline + restart. */
export class LocalStorageConfigPatchQueue implements ConfigPatchQueue {
  private owner = "";
  private readonly storage: KeyValueStorage;
  private readonly key: string;

  constructor(
    storage: KeyValueStorage,
    key = "galaxie-toolbox.config-patch-queue.v1",
  ) {
    this.storage = storage;
    this.key = key;
  }

  scope(owner: string): void {
    const normalized = owner.trim().toLowerCase();
    const stored = this.readStored();
    if (stored !== null && stored.owner !== normalized) this.clear();
    this.owner = normalized;
  }

  load(): CloudConfigDocument {
    const stored = this.readStored();
    if (stored === null || stored.owner !== this.owner) return emptyDocument();
    return normalizeDocument(stored);
  }

  save(document: CloudConfigDocument): void {
    if (Object.keys(document.values).length === 0) {
      this.clear();
      return;
    }
    try {
      this.storage.setItem(this.key, JSON.stringify({ ...document, owner: this.owner }));
    } catch {
      // Cache local indisponível: o estado atual ainda fica no backend legado.
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch {
      // Best-effort.
    }
  }

  private readStored(): StoredPatchQueue | null {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") return null;
      const record = parsed as Record<string, unknown>;
      if (typeof record.owner !== "string") return null;
      return parsed as StoredPatchQueue;
    } catch {
      return null;
    }
  }
}

type LocalConfigBackend = ConfigBackend & ConfigSnapshot;

interface OnlineTarget {
  addEventListener(type: "online", listener: () => void): void;
  removeEventListener(type: "online", listener: () => void): void;
}

export interface LayeredBackendOptions {
  debounceMs?: number;
  onCloudError?: (error: unknown) => void;
  onReconciled?: (state: Partial<AppPersistido>) => void;
  baseline?: () => Partial<AppPersistido>;
  queue?: ConfigPatchQueue;
  now?: () => number;
  onlineTarget?: OnlineTarget | null;
}

/** Cache síncrono + fila offline + reconciliação otimista por campo. */
export class LayeredBackend implements ConfigBackend, ConfigSnapshot {
  private active = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private synchronizing: Promise<Partial<AppPersistido>> | null = null;
  private suppressQueue = false;
  private generation = 0;
  private readonly debounceMs: number;
  private readonly onCloudError: (error: unknown) => void;
  private readonly onReconciled?: (state: Partial<AppPersistido>) => void;
  private readonly baseline: () => Partial<AppPersistido>;
  private readonly now: () => number;
  private readonly queue: ConfigPatchQueue;
  private readonly onlineTarget: OnlineTarget | null;
  private readonly local: LocalConfigBackend;
  private readonly cloud: VersionedConfigBackend;
  private readonly onlineListener = () => {
    void this.synchronize().catch(this.onCloudError);
  };

  constructor(
    local: LocalConfigBackend,
    cloud: VersionedConfigBackend,
    options: LayeredBackendOptions = {},
  ) {
    this.local = local;
    this.cloud = cloud;
    this.debounceMs = options.debounceMs ?? 750;
    this.onCloudError = options.onCloudError ?? (() => undefined);
    this.onReconciled = options.onReconciled;
    this.baseline = options.baseline ?? (() => ({}));
    this.queue = options.queue ?? new MemoryPatchQueue();
    this.now = options.now ?? Date.now;
    this.onlineTarget = options.onlineTarget === undefined
      ? (typeof window === "undefined" ? null : window)
      : options.onlineTarget;
  }

  getSnapshot(): Partial<AppPersistido> {
    return this.local.getSnapshot();
  }

  activate(owner = ""): void {
    this.deactivate();
    this.queue.scope(owner);
    this.active = true;
    this.onlineTarget?.addEventListener("online", this.onlineListener);
    this.rescheduleSyncInterval();
  }

  deactivate(): void {
    this.active = false;
    this.generation += 1;
    this.synchronizing = null;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    if (this.syncTimer !== null) clearInterval(this.syncTimer);
    this.debounceTimer = null;
    this.syncTimer = null;
    this.onlineTarget?.removeEventListener("online", this.onlineListener);
  }

  async load(): Promise<Partial<AppPersistido>> {
    return this.synchronize();
  }

  async save(patch: Partial<AppPersistido>): Promise<void> {
    const before = projetarConfigNuvem(this.local.getSnapshot());
    const suppressed = this.suppressQueue;
    await this.local.save(patch);
    if (!this.active || suppressed) return;

    const after = {
      ...projetarConfigNuvem(this.baseline()),
      ...projetarConfigNuvem(this.local.getSnapshot()),
    };
    const queued = this.queue.load();
    const timestamp = this.now();
    let changed = false;
    for (const key of CHAVES_CONFIG_NUVEM) {
      if (hasValue(after, key) && !sameValue(before[key], after[key])) {
        Object.assign(queued.values, { [key]: after[key] });
        queued.updatedAt[key] = timestamp;
        changed = true;
      }
    }
    if (!changed) return;

    this.queue.save(queued);
    this.rescheduleSyncInterval();
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.synchronize().catch(this.onCloudError);
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    await this.synchronize();
  }

  /** Limpar o cache nunca apaga a autoridade cloud do usuário. */
  async clear(): Promise<void> {
    this.deactivate();
    this.queue.clear();
    await this.local.clear();
  }

  private synchronize(): Promise<Partial<AppPersistido>> {
    if (!this.active) return Promise.resolve(this.local.getSnapshot());
    if (this.synchronizing !== null) return this.synchronizing;
    const generation = this.generation;
    const running = this.performSynchronize(generation).finally(() => {
      if (this.synchronizing === running) this.synchronizing = null;
    });
    this.synchronizing = running;
    return running;
  }

  private async performSynchronize(generation: number): Promise<Partial<AppPersistido>> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remote = await this.cloud.loadVersioned();
      if (!this.active || this.generation !== generation) return this.local.getSnapshot();
      const queued = this.queue.load();
      const localSeed = {
        ...projetarConfigNuvem(this.baseline()),
        ...projetarConfigNuvem(this.local.getSnapshot()),
      };
      const merged = mergeCloudConfigDocuments(remote, localSeed, queued, this.now);
      await this.applyLocal(merged.values);
      if (!this.active || this.generation !== generation) return this.local.getSnapshot();

      const hasQueued = Object.keys(queued.values).length > 0;
      const normalizedRemote: CloudConfigDocument = {
        schemaVersion: 2,
        values: remote.values,
        updatedAt: remote.updatedAt,
      };
      if (remote.exists && !hasQueued && sameValue(normalizedRemote, merged)) {
        return merged.values;
      }

      try {
        const saved = await this.cloud.saveVersioned(merged, remote.eTag);
        if (!this.active || this.generation !== generation) return this.local.getSnapshot();
        this.acknowledge(queued);
        const remaining = this.queue.load();
        const current = mergeCloudConfigDocuments(
          saved,
          this.local.getSnapshot(),
          remaining,
          this.now,
        );
        await this.applyLocal(current.values);
        return current.values;
      } catch (error) {
        if (error instanceof CloudConflictError && attempt < 2) continue;
        throw error;
      }
    }
    throw new CloudConflictError();
  }

  private acknowledge(sent: CloudConfigDocument): void {
    const current = this.queue.load();
    for (const key of CHAVES_CONFIG_NUVEM) {
      if (
        hasValue(sent.values, key) &&
        current.updatedAt[key] === sent.updatedAt[key] &&
        sameValue(current.values[key], sent.values[key])
      ) {
        delete current.values[key];
        delete current.updatedAt[key];
      }
    }
    this.queue.save(current);
  }

  private async applyLocal(state: Partial<AppPersistido>): Promise<void> {
    this.suppressQueue = true;
    try {
      await this.local.save(state);
      this.onReconciled?.(state);
    } finally {
      this.suppressQueue = false;
    }
  }

  private rescheduleSyncInterval(): void {
    if (this.syncTimer !== null) clearInterval(this.syncTimer);
    this.syncTimer = null;
    if (!this.active || this.onlineTarget === null) return;
    const raw = this.baseline().syncIntervalMinutes;
    const minutes = typeof raw === "number" && Number.isFinite(raw)
      ? Math.max(1, raw)
      : 15;
    this.syncTimer = setInterval(() => {
      void this.synchronize().catch(this.onCloudError);
    }, minutes * 60 * 1000);
  }
}
