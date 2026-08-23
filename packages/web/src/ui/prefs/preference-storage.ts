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
};
