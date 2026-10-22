import type { QueryClient } from "@tanstack/react-query";
import type { InvalidationTarget } from "../domain/sync-activities";
import { queryKeys } from "./query-keys";

export type InvalidationKey = readonly unknown[];

const library = queryKeys.library();
const movieLibrary = queryKeys.movieLibrary();
const history = queryKeys.historyPrefix();
const TARGET_KEYS: Readonly<Record<InvalidationTarget, readonly InvalidationKey[]>> = {
  "watched/shows": [library, history],
  "progress/watched": [library, history],
  "watched/movies": [movieLibrary, history],
  "movie-progress": [movieLibrary, history],
  "watchlist/shows": [library, queryKeys.watchlist("shows")],
  "watchlist/movies": [movieLibrary, queryKeys.watchlist("movies")],
  "watchlist/episodes": [],
  "collection/shows": [library],
  "collection/movies": [movieLibrary],
  "hidden/progress_watched": [library],
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

export function invalidationKeys(targets: readonly InvalidationTarget[]): InvalidationKey[] {
  const seen = new Map<string, InvalidationKey>();
  for (const target of targets) {
    for (const key of TARGET_KEYS[target]) {
      seen.set(JSON.stringify(key), key);
    }
  }
  return [...seen.values()];
}
