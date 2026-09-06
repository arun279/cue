import { Preferences } from "@capacitor/preferences";
import type { KeyValueStore } from "@cue/core/ports/kv";
import { del, get, set } from "idb-keyval";

/**
 * The two interchangeable backends behind `KeyValueStore`. Web persists to
 * IndexedDB (idb-keyval) so a large cache never blocks the main thread; native
 * persists to Capacitor Preferences, the one store the OS will not evict.
 */
function webKeyValueStore(): KeyValueStore {
  return {
    async read(key) {
      return (await get<string>(key)) ?? null;
    },
    write: (key, value) => set(key, value),
    remove: (key) => del(key),
  };
}

// TODO(ios-keychain): the token rides here alongside the cache, and on iOS
// Capacitor Preferences is UserDefaults, which the OS always puts in a device
// backup with no opt-out. Android is handled in the manifest; iOS needs the
// token split onto a Keychain-backed store with a ThisDeviceOnly accessibility
// class, plus a migration off UserDefaults and a purge on reinstall (Keychain
// items outlive an uninstall). PRIVACY.md documents the gap until then.
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
