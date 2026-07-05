import { applyTheme, initialTheme, persistTheme, type Theme } from "@ui/theme/theme";
import { create } from "zustand";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

/** Tiny cross-tree client state — the toggle's single source. */
export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    persistTheme(theme);
    set({ theme });
  },
  toggle: () => {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },
}));
