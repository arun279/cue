/** What the user chose in Settings ▸ Appearance; `system` follows the OS. */
export type ThemePreference = "system" | "dark" | "light";
/** What actually gets stamped on the document: a preference, resolved. */
export type Theme = "dark" | "light";

const STORAGE_KEY = "cue.theme";
const DARK_SCHEME = "(prefers-color-scheme: dark)";

/**
 * New users follow the OS (`system`); a stored choice always wins. A stored
 * plain "dark"/"light" (from the era when those were the only states) reads
 * back unchanged: it was an explicit choice then and stays one.
 */
export function initialThemePreference(): ThemePreference {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

/** `system` resolves against the OS scheme at call time; where the media query
 * is unavailable, dark: the screening room is the hero theme. */
export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== "system") return preference;
  return (globalThis.matchMedia?.(DARK_SCHEME).matches ?? true) ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset["theme"] = theme;
}

export function persistThemePreference(preference: ThemePreference): void {
  localStorage.setItem(STORAGE_KEY, preference);
}

/** Live OS-scheme changes, for re-stamping while the preference is `system`. */
export function onSystemThemeChange(listener: (theme: Theme) => void): () => void {
  const media = globalThis.matchMedia?.(DARK_SCHEME);
  if (media === undefined) return () => {};
  const handler = (event: MediaQueryListEvent): void => {
    listener(event.matches ? "dark" : "light");
  };
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}
