import type { PreferenceStorage } from "../ports/preference-storage";
import { booleanPref } from "./pref-storage";

/** Which media a user tracks. Both ON by default; the app is never emptied of
 * both: a movies-only or TV-only user simply sheds the surfaces they don't use. */
export interface MediaVisibility {
  readonly showsEnabled: boolean;
  readonly moviesEnabled: boolean;
}

const showsPref = (storage: PreferenceStorage) => booleanPref(storage, "cue.shows-enabled", true);
const moviesPref = (storage: PreferenceStorage) => booleanPref(storage, "cue.movies-enabled", true);

/**
 * Both media are ON by default. Both-OFF is impossible by construction (the store
 * setter drops it and the Settings toggle for the last-enabled medium is locked),
 * so a both-off pair can only come from a corrupt store: it heals to both-on
 * rather than boot into an empty app.
 */
export function resolveMediaVisibility(
  showsEnabled: boolean,
  moviesEnabled: boolean,
): MediaVisibility {
  if (!showsEnabled && !moviesEnabled) return { showsEnabled: true, moviesEnabled: true };
  return { showsEnabled, moviesEnabled };
}

/** Absent (fresh device / reinstall) reads as ON. */
export function initialMediaVisibility(storage: PreferenceStorage): MediaVisibility {
  return resolveMediaVisibility(showsPref(storage).initial(), moviesPref(storage).initial());
}

export function persistMediaVisibility(
  storage: PreferenceStorage,
  { showsEnabled, moviesEnabled }: MediaVisibility,
): void {
  showsPref(storage).persist(showsEnabled);
  moviesPref(storage).persist(moviesEnabled);
}
