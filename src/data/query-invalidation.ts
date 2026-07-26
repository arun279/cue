import type { InvalidationTarget } from "@domain/sync-activities";
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

/** A composite TanStack query key (a readonly tuple prefix). */
export type InvalidationKey = readonly unknown[];

/**
 * Which cached queries a single `/sync/last_activities` target actually feeds.
 * Only the surfaces this app renders are listed: a target with no cached query
 * (episode watchlist, favorites, movie hidden) maps to nothing, so a change there
 * costs zero refetches. `userStats` AND the Diary's `history` ride every
 * watch/progress change because the Profile totals and the watch log both move
 * with them: so a mark made on any surface shows up in the Diary on the next poll.
 *
 * Deliberately absent: `showHeader`/`showSeasons`/`episode` and the calendar.
 * Those carry Trakt content (airdates, newly-announced episodes) that doesn't
 * always bump user activity, so they refresh on a time-based content staleTime
 * rather than being gated on this diff. `userSettings` is absent too: identity
 * changes about never and moves no activity stamp, so the read stays cached
 * until sign-out clears it.
 */
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
      // watchlist/episodes, favorites/shows, favorites/movies, hidden/movies:
      // no rendered surface, so nothing to refetch.
      return [];
  }
}

/**
 * The cached queries a local watched-progress mark on show X must refresh,
 * whichever surface issued it: the Up Next `library` aggregate, the lazy row
 * progress read, PLUS the show's own detail reads: its header (overall `X/Y` +
 * next-up) and its season tree
 * (per-season counts + per-episode ticks): and, when the mark targets one known
 * episode, that episode's detail read.
 *
 * These per-show keys are deliberately ABSENT from `keysForTarget` above: the
 * last-activities gate maps a *remote* diff, and it stores the app's own write
 * timestamp, so on reload remote == stored and a local mark never re-syncs them.
 * A mark surface that invalidates only `library` therefore leaves the show-detail
 * persisted cache reading pre-mark progress until an unrelated remote change (or
 * the content window lapsing). Invalidating them at the mark seam marks the
 * (usually inactive) show-detail queries stale so they refetch on next mount,
 * and, because the invalidated flag is persisted, after a full reload too.
 *
 * `episode` scopes the episode-detail invalidation: a single `{season,number}`
 * coordinate targets exactly that episode's detail read; `"all"` invalidates the
 * whole-show episode prefix (`["show","episode",showId]`, which TanStack
 * prefix-matches across every cached episode of the show) for a bulk/range mark
 * that touched an unknown set of episodes; omitting it leaves episode reads alone.
 */
export function showProgressKeys(
  showId: number,
  episode?: { readonly season: number; readonly number: number } | "all",
): InvalidationKey[] {
  const keys: InvalidationKey[] = [
    queryKeys.library(),
    queryKeys.showProgress(showId),
    queryKeys.showHeader(showId),
    queryKeys.showSeasons(showId),
  ];
  if (episode === "all") keys.push(queryKeys.episodePrefix(showId));
  else if (episode !== undefined)
    keys.push(queryKeys.episode(showId, episode.season, episode.number));
  return keys;
}

/**
 * Invalidate every cached query a local watched-progress mark on `showId` must
 * refresh: the {@link showProgressKeys} fan-out, applied. Every mark surface (Up
 * Next, calendar, season, episode toggle, diary) shares this instead of
 * re-inlining the `for … invalidateQueries` loop, so how progress revalidates is
 * changed in one place. `episode` scopes the episode-detail invalidation exactly
 * as `showProgressKeys` documents.
 */
export function invalidateShowProgress(
  qc: QueryClient,
  showId: number,
  episode?: { readonly season: number; readonly number: number } | "all",
): void {
  for (const queryKey of showProgressKeys(showId, episode)) {
    void qc.invalidateQueries({ queryKey });
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
