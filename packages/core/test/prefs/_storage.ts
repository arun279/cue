import type { PreferenceStorage } from "../../src/ports/preference-storage";

/** A `PreferenceStorage` over a plain map, so a preference's semantics can be
 * pinned without a browser or a device. */
export function fakeStorage(seed: Record<string, string> = {}): PreferenceStorage {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}
