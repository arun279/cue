import type { PreferenceStorage } from "../ports/preference-storage";
import { booleanPref } from "./pref-storage";

export interface MediaVisibility {
  readonly showsEnabled: boolean;
  readonly moviesEnabled: boolean;
}

const showsPref = (storage: PreferenceStorage) => booleanPref(storage, "cue.shows-enabled", true);
const moviesPref = (storage: PreferenceStorage) => booleanPref(storage, "cue.movies-enabled", true);

export function resolveMediaVisibility(
  showsEnabled: boolean,
  moviesEnabled: boolean,
): MediaVisibility {
  if (!showsEnabled && !moviesEnabled) return { showsEnabled: true, moviesEnabled: true };
  return { showsEnabled, moviesEnabled };
}

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
