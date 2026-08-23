/**
 * Device-local preferences, and the one port that is synchronous by design.
 *
 * `KeyValueStore` is async because IndexedDB and Capacitor Preferences are.
 * Preferences cannot be: the prefs store reads every value at import time and
 * the theme is applied before the first render specifically so there is no light
 * or dark flash. An await before first paint would put that flash back on both
 * targets. Every backend this needs can answer synchronously, `localStorage` on
 * the web and `expo-sqlite/kv-store`'s `getItemSync` on a device.
 *
 * Neither method throws. `localStorage` does, outright, in some privacy modes,
 * so the degradation lives in the implementation: a preference that cannot be
 * remembered still resolves to its principled default.
 */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /** Drop every key under a prefix. Sign-out calls it with the app's own, which
   * on a device is a prefix of its own rather than the one the bulk store uses:
   * the two share a database there, and a `cue.` clear would take the durable
   * write queue and the install marker with the preferences. */
  clearNamespace(prefix: string): void;
}
