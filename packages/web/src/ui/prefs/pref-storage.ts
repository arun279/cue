/**
 * The two shapes every device-local preference takes, so the read/write pair and
 * its restricted-storage fallback are written once rather than per preference.
 * `localStorage` throws outright in some privacy modes, and a preference that
 * cannot be remembered must still resolve to its principled default.
 */

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A restricted-storage failure just forgets the choice next visit: non-fatal.
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

interface Pref<T> {
  initial(): T;
  persist(value: T): void;
}

/** A stored "1"/"0" flag; an absent key reads as `fallback`. */
export function booleanPref(key: string, fallback: boolean): Pref<boolean> {
  return {
    initial: () => {
      const stored = read(key);
      return stored === null ? fallback : stored === "1";
    },
    persist: (value) => write(key, value ? "1" : "0"),
  };
}

/** A stored member of `options`; anything else (absent, stale, corrupt) reads as
 * `fallback`. Numbers store as their decimal text, so an option list can be
 * either words or figures. */
export function choicePref<T extends string | number>(
  key: string,
  options: readonly T[],
  fallback: T,
): Pref<T> {
  return {
    initial: () => options.find((option) => String(option) === read(key)) ?? fallback,
    persist: (value) => write(key, String(value)),
  };
}
