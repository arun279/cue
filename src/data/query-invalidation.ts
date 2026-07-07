import type { InvalidationTarget } from "@domain/sync-activities";
import { queryKeys } from "./query-keys";

/** A composite TanStack query key (a readonly tuple prefix). */
export type InvalidationKey = readonly unknown[];

/**
 * Which cached queries a single `/sync/last_activities` target actually feeds.
 * Only the surfaces this app renders are listed — a target with no cached query
 * (episode watchlist, favorites, movie hidden) maps to nothing, so a change there
 * costs zero refetches. `userStats` rides every watch/progress change because the
 * Profile totals move with them (a previously-missing mapping).
 *
 * Deliberately absent: `showHeader`/`showSeasons`/`episode` and the calendar.
 * Those carry Trakt content (airdates, newly-announced episodes) that doesn't
 * always bump user activity, so they refresh on a time-based content staleTime
 * rather than being gated on this diff (amendments a + b).
 */
function keysForTarget(target: InvalidationTarget): readonly InvalidationKey[] {
  switch (target) {
    case "watched/shows":
    case "progress/watched":
      return [queryKeys.library(), queryKeys.userStats()];
    case "watched/movies":
    case "movie-progress":
      return [queryKeys.movieLibrary(), queryKeys.userStats()];
    case "watchlist/shows":
      return [queryKeys.library(), queryKeys.watchlist("shows")];
    case "watchlist/movies":
      return [queryKeys.movieLibrary(), queryKeys.watchlist("movies")];
    case "ratings/shows":
      return [queryKeys.ratings("shows")];
    case "ratings/movies":
      return [queryKeys.ratings("movies")];
    case "ratings/episodes":
      return [queryKeys.ratings("episodes")];
    case "hidden/progress_watched":
    case "recompute:buckets":
    case "recompute:to-watch":
      return [queryKeys.library()];
    case "recompute:following":
      return [queryKeys.library(), queryKeys.movieLibrary()];
    default:
      // watchlist/episodes, favorites/shows, favorites/movies, hidden/movies:
      // no rendered surface, so nothing to refetch.
      return [];
  }
}

/**
 * Fold a diffed target set to the exact, de-duplicated composite keys to
 * invalidate. Keys are compared by JSON identity so `library` + `userStats`
 * appearing from several targets collapse to one invalidation each.
 */
export function invalidationKeys(targets: readonly InvalidationTarget[]): InvalidationKey[] {
  const seen = new Map<string, InvalidationKey>();
  for (const target of targets) {
    for (const key of keysForTarget(target)) {
      seen.set(JSON.stringify(key), key);
    }
  }
  return [...seen.values()];
}
