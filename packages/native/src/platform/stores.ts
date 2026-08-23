import type { KeyValueStore } from "@cue/core/ports/kv";
import type { PreferenceStorage } from "@cue/core/ports/preference-storage";
import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";

/**
 * The token, and nothing else.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` maps to
 * `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, which is what closes the iOS
 * half of the standing storage caveat: the item never enters an iCloud or
 * iTunes backup, where Capacitor Preferences (UserDefaults) always did. Keys are
 * restricted to alphanumerics, `.`, `-` and `_`, so the app's dotted names pass
 * through unchanged.
 *
 * The Keychain must not become the store for anything else. It is not a bulk
 * store, and its survival across an uninstall on iOS is precisely the property a
 * cached op log must not have, which is what the reinstall purge in `boot.ts` is
 * for.
 */
const SECURE: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStore: KeyValueStore = {
  read: (key) => SecureStore.getItemAsync(key, SECURE),
  write: (key, value) => SecureStore.setItemAsync(key, value, SECURE),
  remove: (key) => SecureStore.deleteItemAsync(key, SECURE),
};

/**
 * Everything durable that is not the token: the op log, the freshness baseline,
 * the persisted query cache, the preferences and the install marker.
 *
 * `expo-sqlite/kv-store` rather than AsyncStorage or MMKV. Expo ships it and
 * documents it as a drop-in replacement for AsyncStorage, whose current major
 * does not work on this SDK; MMKV is a third-party native module its own
 * maintainer marks unsupported in Expo Go, and it buys speed a query cache
 * throttled at one write per second does not need. What it uniquely gives is
 * genuinely synchronous reads, which is what `PreferenceStorage` below is for.
 */
export const bulkStore: KeyValueStore = {
  read: (key) => Storage.getItem(key),
  write: (key, value) => Storage.setItem(key, value),
  remove: (key) => Storage.removeItem(key),
};

/**
 * Preferences are read at module scope, before the first render, so the theme is
 * applied without a flash. `getItemSync` and `setItemSync` are backed by
 * `db.getFirstSync` and `db.runSync` rather than by a promise wrapped around an
 * async call, which is the specific reason this store wins the port.
 *
 * The `pref.` prefix is load-bearing. On the web the namespaces are physically
 * separate, preferences in `localStorage` and the durable state in IndexedDB;
 * here they share one database, and every durable key is `cue.`-prefixed, so a
 * `cue.` clear at sign-out would take the write queue, the freshness baseline
 * and the install marker with the preferences. Losing the install marker is the
 * worst of those: the next launch would look like a fresh install to the
 * reinstall purge, which would then clear the token.
 */
const PREFIX = "pref.";

export const preferenceStorage: PreferenceStorage = {
  getItem: (key) => Storage.getItemSync(PREFIX + key),
  setItem: (key, value) => {
    Storage.setItemSync(PREFIX + key, value);
  },
  clearNamespace: (prefix) => {
    for (const key of Storage.getAllKeysSync()) {
      if (key.startsWith(PREFIX + prefix)) Storage.removeItemSync(key);
    }
  },
};

/** What sign-out drops: this device's preferences, and nothing account-agnostic
 * that lives beside them. */
export const clearLocalPreferences = (): void => {
  preferenceStorage.clearNamespace("cue.");
};
