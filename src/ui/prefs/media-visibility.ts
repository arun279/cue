/** Which media a user tracks. Both ON by default; the app is never emptied of
 * both — a movies-only or TV-only user simply sheds the surfaces they don't use. */
export interface MediaVisibility {
  readonly showsEnabled: boolean;
  readonly moviesEnabled: boolean;
}

const SHOWS_KEY = "cue.shows-enabled";
const MOVIES_KEY = "cue.movies-enabled";

/**
 * Both media are ON by default. Both-OFF is impossible by construction (the store
 * setter drops it and the Settings toggle for the last-enabled medium is locked),
 * so a both-off pair can only come from a corrupt store — it heals to both-on
 * rather than boot into an empty app.
 */
export function resolveMediaVisibility(
  showsEnabled: boolean,
  moviesEnabled: boolean,
): MediaVisibility {
  if (!showsEnabled && !moviesEnabled) return { showsEnabled: true, moviesEnabled: true };
  return { showsEnabled, moviesEnabled };
}

/** Absent (fresh device / reinstall) reads as ON; only an explicit "0" disables. */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

export function initialMediaVisibility(): MediaVisibility {
  return resolveMediaVisibility(readFlag(SHOWS_KEY), readFlag(MOVIES_KEY));
}

export function persistMediaVisibility({ showsEnabled, moviesEnabled }: MediaVisibility): void {
  try {
    localStorage.setItem(SHOWS_KEY, showsEnabled ? "1" : "0");
    localStorage.setItem(MOVIES_KEY, moviesEnabled ? "1" : "0");
  } catch {
    // A restricted-storage failure just forgets the choice next visit — non-fatal.
  }
}
