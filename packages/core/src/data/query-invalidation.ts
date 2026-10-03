import type { QueryClient } from "@tanstack/react-query";
import type { InvalidationTarget } from "../domain/sync-activities";
import { queryKeys } from "./query-keys";

export type InvalidationKey = readonly unknown[];

function keysForTarget(target: InvalidationTarget): readonly InvalidationKey[] {
  switch (target) {
    case "watched/shows":
    case "progress/watched":
      return [queryKeys.library(), queryKeys.userStats(), queryKeys.historyPrefix()];
    case "watched/movies":
    case "movie-progress":
      return [queryKeys.movieLibrary(), queryKeys.userStats(), queryKeys.historyPrefix()];
    case "watchlist/shows":
      return [queryKeys.library(), queryKeys.watchlist("shows")];
    case "watchlist/movies":
      return [queryKeys.movieLibrary(), queryKeys.watchlist("movies")];
    case "hidden/progress_watched":
    case "recompute:buckets":
    case "recompute:to-watch":
      return [queryKeys.library()];
    case "recompute:following":
      return [queryKeys.library(), queryKeys.movieLibrary()];
    default:
      return [];
  }
}

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
    for (const key of keysForTarget(target)) {
      seen.set(JSON.stringify(key), key);
    }
  }
  return [...seen.values()];
}
