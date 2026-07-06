export type Theme = "light" | "dark";

const STORAGE_KEY = "cue.theme";

function readStoredTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

/**
 * Cue opens in the dark screening room by design: dark is
 * the default and the hero, the way you actually watch TV. A stored choice from
 * the Settings ▸ Appearance toggle always wins, so user control is preserved.
 */
export function initialTheme(): Theme {
  return readStoredTheme() ?? "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset["theme"] = theme;
}

export function persistTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}
