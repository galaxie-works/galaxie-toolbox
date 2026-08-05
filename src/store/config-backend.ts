import type { AgendaPersistido } from "./agenda-slice";
import type { BridgePersistido } from "./bridge-slice";
import type { FiltersPersistido } from "./filters-slice";
import type { ListPersistido } from "./list-slice";
import type { MailboxPersistido } from "./mailbox-slice";
import type { OrganizationsPersistido } from "./organizations-slice";
import type { PersonalizationPersistido } from "./personalization-slice";
import type { SettingsUiPersistido } from "./settings-ui-slice";
import type { UiPersistido } from "./ui-slice";

/** Estado durável do app, compartilhado pelos backends de configuração. */
export type AppPersistido = UiPersistido &
  ListPersistido &
  FiltersPersistido &
  MailboxPersistido &
  SettingsUiPersistido &
  PersonalizationPersistido &
  BridgePersistido &
  AgendaPersistido &
  OrganizationsPersistido;

/** Seam assíncrono para persistência e reconciliação da configuração. */
export interface ConfigBackend {
  load(): Promise<Partial<AppPersistido>>;
  save(patch: Partial<AppPersistido>): Promise<void>;
  clear(): Promise<void>;
}

/** Leitura síncrona exigida pelo boot do Zustand, sem flash de hidratação. */
export interface ConfigSnapshot {
  getSnapshot(): Partial<AppPersistido>;
}

/** Subconjunto do Web Storage necessário pelo adapter local. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Mapeamento 1:1 entre AppPersistido e as chaves legadas do localStorage. */
export interface LocalCacheCodec {
  read(storage: KeyValueStorage): Partial<AppPersistido>;
  write(storage: KeyValueStorage, patch: Partial<AppPersistido>): void;
  clear(storage: KeyValueStorage): void;
}

/**
 * Backend local usado como snapshot síncrono no boot e como ConfigBackend
 * assíncrono nas reconciliações. O codec preserva chaves e migrações legadas.
 */
export class LocalCacheBackend implements ConfigBackend, ConfigSnapshot {
  private readonly storage: KeyValueStorage;
  private readonly codec: LocalCacheCodec;

  constructor(
    storage: KeyValueStorage,
    codec: LocalCacheCodec,
  ) {
    this.storage = storage;
    this.codec = codec;
  }

  getSnapshot(): Partial<AppPersistido> {
    return this.codec.read(this.storage);
  }

  async load(): Promise<Partial<AppPersistido>> {
    return this.getSnapshot();
  }

  async save(patch: Partial<AppPersistido>): Promise<void> {
    this.codec.write(this.storage, patch);
  }

  async clear(): Promise<void> {
    this.codec.clear(this.storage);
  }
}
