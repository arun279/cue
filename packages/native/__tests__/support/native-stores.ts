/**
 * In-memory stand-ins for the two native backends, at the module boundary the
 * adapters call.
 *
 * jest-expo mocks the native modules but not functionally: `expo-sqlite`'s
 * `NativeDatabase` is not a constructor under it, and `expo-secure-store`'s
 * getter answers nothing it was given. So what runs here is the shape of the
 * calls each adapter makes and the key mapping it applies, which is the same
 * bargain the web lane already strikes for the Capacitor store. The backends
 * themselves are proved on a simulator, where the SQLite file and the Keychain
 * are real.
 */

export interface MemoryStorage {
  readonly values: Map<string, string>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
  removeItemSync(key: string): boolean;
  getAllKeysSync(): string[];
}

function createMemoryStorage(): MemoryStorage {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => Promise.resolve(values.get(key) ?? null),
    setItem: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    getItemSync: (key) => values.get(key) ?? null,
    setItemSync: (key, value) => {
      values.set(key, value);
    },
    removeItemSync: (key) => values.delete(key),
    getAllKeysSync: () => [...values.keys()],
  };
}

/** The bulk store's backing: the op log, the freshness baseline, the persisted
 * query cache, the preferences and the install marker. */
export const bulkBacking = createMemoryStorage();

/** The Keychain's backing: the token, and nothing else. */
export const secureBacking = new Map<string, string>();

export const secureStoreModule = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "whenUnlockedThisDeviceOnly",
  getItemAsync: (key: string): Promise<string | null> =>
    Promise.resolve(secureBacking.get(key) ?? null),
  setItemAsync: (key: string, value: string): Promise<void> => {
    secureBacking.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string): Promise<void> => {
    secureBacking.delete(key);
    return Promise.resolve();
  },
};

/** What the Capacitor build left behind, as the local module would read it. */
export const legacyBacking = new Map<string, string>();

/** The local module's whole JavaScript surface: the seven silent verbs and the
 * legacy reader over the map above. */
export const cueNativeModule = {
  CueHaptics: {
    success: () => {},
    failure: () => {},
    warning: () => {},
    thresholdActivate: () => {},
    thresholdDeactivate: () => {},
    selection: () => {},
    contextClick: () => {},
    prepare: () => {},
  },
  CueLegacyPreferences: {
    read: (key: string): Promise<string | null> => Promise.resolve(legacyBacking.get(key) ?? null),
    remove: (key: string): Promise<void> => {
      legacyBacking.delete(key);
      return Promise.resolve();
    },
  },
};
