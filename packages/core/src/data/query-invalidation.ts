import type { QueryClient } from "@tanstack/react-query";
import type { InvalidationTarget } from "../domain/sync-activities";
import { queryKeys } from "./query-keys";
import type { LibraryEntry } from "./trakt/library";

export type InvalidationKey = readonly unknown[];

const library = queryKeys.library();
const movieLibrary = queryKeys.movieLibrary();
const history = queryKeys.historyPrefix();
// Each of these merges the user's per-episode watched state into the show's own data. A watched
// change refreshes them per show when the library reloads; a hidden change, which can hide a
// single season, refreshes them all.
const showTrees = [
  queryKeys.showSection("progress"),
  queryKeys.showSection("seasons"),
  queryKeys.showSection("episode"),
];
const TARGET_KEYS: Readonly<Record<InvalidationTarget, readonly InvalidationKey[]>> = {
  "watched/shows": [library, history],
  "progress/watched": [library, history],
  "watched/movies": [movieLibrary, history],
  "movie-progress": [movieLibrary, history],
  "watchlist/shows": [library],
  "watchlist/movies": [movieLibrary, queryKeys.movieWatchlist()],
  "watchlist/episodes": [],
  "collection/shows": [library],
  "collection/movies": [movieLibrary],
  "hidden/progress_watched": [library, ...showTrees],
  "hidden/dropped": [library],
  "hidden/movies": [],
  "favorites/shows": [],
  "favorites/movies": [],
  "recompute:buckets": [library],
  "recompute:to-watch": [library],
  "recompute:following": [library, movieLibrary],
};

export function showProgressKeys(
  showId: number,
  episode?: { readonly season: number; readonly number: number } | "all",
): InvalidationKey[] {
  const keys: InvalidationKey[] = [queryKeys.showProgress(showId), queryKeys.showSeasons(showId)];
  if (episode === "all") keys.push(queryKeys.episodePrefix(showId));
  else if (episode !== undefined)
    keys.push(queryKeys.episode(showId, episode.season, episode.number));
  return keys;
}

export function invalidateShowProgress(
  qc: QueryClient,
  showId: number,
  episode?: { readonly season: number; readonly number: number } | "all",
): void {
  for (const queryKey of showProgressKeys(showId, episode)) {
    void qc.invalidateQueries({ queryKey });
  }
}

// Trakt keeps play times to the minute, so a mark this device applied already matches the reload.
const watchedState = ({ completed, lastWatchedAt }: LibraryEntry): string =>
  `${completed}@${lastWatchedAt === null ? "" : Math.floor(Date.parse(lastWatchedAt) / 60_000)}`;

/** Refreshes the watched state of every show the reloaded library disagrees with the cache on. */
export function invalidateChangedShows(
  qc: QueryClient,
  cached: readonly LibraryEntry[] | undefined,
  reloaded: readonly LibraryEntry[],
): void {
  if (cached === undefined) return;
  const before = new Map(cached.map((entry) => [entry.showId, watchedState(entry)]));
  const after = new Map(reloaded.map((entry) => [entry.showId, watchedState(entry)]));
  for (const showId of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(showId) !== after.get(showId)) invalidateShowProgress(qc, showId, "all");
  }
}

export function invalidationKeys(targets: readonly InvalidationTarget[]): InvalidationKey[] {
  const seen = new Map<string, InvalidationKey>();
  for (const target of targets) {
    for (const key of TARGET_KEYS[target]) {
      seen.set(JSON.stringify(key), key);
    }
  }
  return [...seen.values()];
}
