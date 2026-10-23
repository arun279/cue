import type { KeyValueStore } from "@cue/core/ports/kv";
import type { PreferenceStorage } from "@cue/core/ports/preference-storage";
import { createPrefsStore, type PrefsStore } from "@cue/core/prefs/prefs-store";
import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";

// WHEN_UNLOCKED_THIS_DEVICE_ONLY items never migrate to a new device through a backup.
const SECURE: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStore: KeyValueStore = {
  read: (key) => SecureStore.getItemAsync(key, SECURE),
  write: (key, value) => SecureStore.setItemAsync(key, value, SECURE),
  remove: (key) => SecureStore.deleteItemAsync(key, SECURE),
};

// Overlapping async calls on one expo-sqlite handle can reject on Android:
// https://github.com/expo/expo/issues/50855
let lastCall: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(call: () => Promise<T>): Promise<T> => {
  const result = lastCall.then(call);
  lastCall = result.catch(() => undefined);
  return result;
};

export const bulkStorage = {
  getItem: (key: string) => oneAtATime(() => Storage.getItem(key)),
  setItem: (key: string, value: string) => oneAtATime(() => Storage.setItem(key, value)),
  removeItem: (key: string) => oneAtATime(() => Storage.removeItem(key)),
};

export const bulkStore: KeyValueStore = {
  read: bulkStorage.getItem,
  write: bulkStorage.setItem,
  remove: bulkStorage.removeItem,
};

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

export const clearLocalPreferences = (store: PrefsStore): void => {
  preferenceStorage.clearNamespace("cue.");
  store.setState(createPrefsStore(preferenceStorage).getState());
};
