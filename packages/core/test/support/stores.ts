import type { KeyValueStore } from "../../src/ports/kv";
import type { PreferenceStorage } from "../../src/ports/preference-storage";

/**
 * The two storage ports as plain maps, with the map exposed so a test can assert
 * on what is durable rather than on what a spy was called with. Shared, because
 * the migration is tested here as a pure function and again in the native
 * package as part of its boot, and two copies of the same fake are two things
 * that can drift from the port they stand for.
 */

export type MemoryKeyValueStore = KeyValueStore & { readonly values: Map<string, string> };

export function memoryKeyValueStore(seed: Record<string, string> = {}): MemoryKeyValueStore {
  const values = new Map(Object.entries(seed));
  return {
    values,
    read: (key) => Promise.resolve(values.get(key) ?? null),
    write: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
  };
}

export type MemoryPreferenceStorage = PreferenceStorage & { readonly values: Map<string, string> };

export function memoryPreferenceStorage(): MemoryPreferenceStorage {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    clearNamespace: (prefix) => {
      for (const key of [...values.keys()]) if (key.startsWith(prefix)) values.delete(key);
    },
  };
}
