import { booleanPref } from "./pref-storage";

/** Which media a user tracks. Both ON by default; the app is never emptied of
 * both: a movies-only or TV-only user simply sheds the surfaces they don't use. */
export interface MediaVisibility {
  readonly showsEnabled: boolean;
  readonly moviesEnabled: boolean;
}

const showsPref = booleanPref("cue.shows-enabled", true);
const moviesPref = booleanPref("cue.movies-enabled", true);

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
export function initialMediaVisibility(): MediaVisibility {
  return resolveMediaVisibility(showsPref.initial(), moviesPref.initial());
}

export function persistMediaVisibility({ showsEnabled, moviesEnabled }: MediaVisibility): void {
  showsPref.persist(showsEnabled);
  moviesPref.persist(moviesEnabled);
}
