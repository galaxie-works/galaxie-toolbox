import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalCacheBackend,
  type AppPersistido,
  type KeyValueStorage,
  type LocalCacheCodec,
} from "./config-backend.ts";

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
