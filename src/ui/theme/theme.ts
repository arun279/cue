export type Theme = "light" | "dark";

const STORAGE_KEY = "cue.theme";

function readStoredTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

function systemTheme(): Theme {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Stored choice wins; otherwise honor the OS `prefers-color-scheme`. */
export function initialTheme(): Theme {
  return readStoredTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset["theme"] = theme;
}

export function persistTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}
