import {
  applyTheme,
  initialThemePreference,
  onSystemThemeChange,
  persistThemePreference,
  resolveTheme,
  type Theme,
  type ThemePreference,
} from "@ui/theme/theme";
import { create } from "zustand";

interface ThemeState {
  preference: ThemePreference;
  /** The resolved, stamped theme: what the status bar and pre-paint stamp read.
   * Under `system` it tracks the live OS scheme. */
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
}

/** Tiny cross-tree client state: the Settings theme control's single source. */
export const useThemeStore = create<ThemeState>((set, get) => {
  const preference = initialThemePreference();
  // App-lifetime subscription: while the preference is `system`, an OS scheme
  // flip re-stamps the document without a visit to Settings.
  onSystemThemeChange((theme) => {
    if (get().preference !== "system") return;
    applyTheme(theme);
    set({ theme });
  });
  return {
    preference,
    theme: resolveTheme(preference),
    setPreference: (next) => {
      const theme = resolveTheme(next);
      applyTheme(theme);
      persistThemePreference(next);
      set({ preference: next, theme });
    },
  };
});
