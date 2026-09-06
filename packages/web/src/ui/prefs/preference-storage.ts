import type { PreferenceStorage } from "@cue/core/ports/preference-storage";

/**
 * `PreferenceStorage` over `localStorage`, which throws outright in some privacy
 * modes. The port does not throw, so the degradation is absorbed here: a
 * preference that cannot be read resolves to its principled default, and one
 * that cannot be written is simply forgotten next visit.
 *
 * It lives beside the preferences rather than in `src/platform` because it is
 * read at module scope, before anything React could inject, and because
 * `localStorage` is a browser global rather than a native bridge: nothing in
 * `src/ui` needs a Capacitor mock to run it.
 */
export const preferenceStorage: PreferenceStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // A restricted-storage failure just forgets the choice next visit: non-fatal.
    }
  },
  clearNamespace(prefix) {
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(prefix) === true) localStorage.removeItem(key);
      }
    } catch {
      // Nothing was stored to begin with, so nothing is left behind.
    }
  },
};

/**
 * What sign-out drops. On the web the namespaces are physically separate:
 * `localStorage` holds only preferences, while the op log, the freshness
 * baseline and the persisted query cache live in IndexedDB, so clearing `cue.`
 * here cannot reach them.
 */
export const clearLocalPreferences = (): void => preferenceStorage.clearNamespace("cue.");
