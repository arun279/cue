import { Preferences } from "@capacitor/preferences";
import { del, get, set } from "idb-keyval";

/**
 * One string key-value abstraction with two interchangeable backends
 * Web persists to IndexedDB (idb-keyval) so a large cache
 * never blocks the main thread; native persists to Capacitor Preferences, the
 * one store the OS will not evict. Values round-trip byte-identical.
 */
export interface KeyValueStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function webKeyValueStore(): KeyValueStore {
  return {
    async read(key) {
      return (await get<string>(key)) ?? null;
    },
    write: (key, value) => set(key, value),
    remove: (key) => del(key),
  };
}

function nativeKeyValueStore(): KeyValueStore {
  return {
    async read(key) {
      const { value } = await Preferences.get({ key });
      return value;
    },
    write: (key, value) => Preferences.set({ key, value }),
    remove: (key) => Preferences.remove({ key }),
  };
}

export function createKeyValueStore(native: boolean): KeyValueStore {
  return native ? nativeKeyValueStore() : webKeyValueStore();
}
