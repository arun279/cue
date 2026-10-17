import type { PreferenceStorage } from "../ports/preference-storage";

export interface Pref<T> {
  initial(): T;
  persist(value: T): void;
}

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
