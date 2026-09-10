import type { PreferenceStorage } from "../ports/preference-storage";

/**
 * The two shapes every device-local preference takes, so the read/write pair is
 * written once rather than per preference. The storage is injected: the same
 * definitions run over `localStorage` and over a device's key-value store, and
 * a test can hand them a plain map.
 */
export interface Pref<T> {
  initial(): T;
  persist(value: T): void;
}

/** A stored "1"/"0" flag; an absent key reads as `fallback`. */
export function booleanPref(
  storage: PreferenceStorage,
  key: string,
  fallback: boolean,
): Pref<boolean> {
  return {
    initial: () => {
      const stored = storage.getItem(key);
      return stored === null ? fallback : stored === "1";
    },
    persist: (value) => storage.setItem(key, value ? "1" : "0"),
  };
}

/** A stored member of `options`; anything else (absent, stale, corrupt) reads as
 * `fallback`. Numbers store as their decimal text, so an option list can be
 * either words or figures. */
export function choicePref<T extends string | number>(
  storage: PreferenceStorage,
  key: string,
  options: readonly T[],
  fallback: T,
): Pref<T> {
  return {
    initial: () => options.find((option) => String(option) === storage.getItem(key)) ?? fallback,
    persist: (value) => storage.setItem(key, String(value)),
  };
}
