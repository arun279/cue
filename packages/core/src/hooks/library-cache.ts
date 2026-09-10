import type { QueryClient } from "@tanstack/react-query";
import { invalidateShowProgress } from "../data/query-invalidation";
import { queryKeys } from "../data/query-keys";
import type { EpisodeDetail } from "../data/trakt/episode-detail";
import type { LibraryEntry } from "../data/trakt/library";
import { type SeasonView, type ShowProgress, toEpisodeRef } from "../data/trakt/show-detail";
import type { UpNextData } from "../runtime/runtime";

/**
 * Optimistically replace one library entry in the shared SWR cache, holding the
 * find-by-showId + map + spread scaffolding in one place. Every optimistic library
 * flip (hidden, watchlist membership, mark-advance) runs through this rather than
 * re-inlining the same `entries.map(e => e.showId === id ? … : e)` block.
 */
export function patchLibraryEntry(
  qc: QueryClient,
  showId: number,
  update: (entry: LibraryEntry) => LibraryEntry,
): void {
  qc.setQueryData<UpNextData>(queryKeys.library(), (old) =>
    old === undefined
      ? old
      : { ...old, entries: old.entries.map((e) => (e.showId === showId ? update(e) : e)) },
  );
}

/**
 * Fold an authoritative `/shows/:id/progress/watched` read into the show's own
 * library entry, leaving every other field the aggregate assembled (title,
 * hidden and watchlist membership) untouched.
 */
function patchLibraryProgress(qc: QueryClient, showId: number, progress: ShowProgress): void {
  patchLibraryEntry(qc, showId, (entry) => ({
    ...entry,
    aired: progress.aired,
    completed: progress.completed,
    lastAired:
      progress.lastAired === null
        ? null
        : { season: progress.lastAired.season, number: progress.lastAired.number },
    nextEpisode: progress.nextEpisode === null ? null : toEpisodeRef(progress.nextEpisode),
    pendingAdvance: false,
  }));
}

/**
 * Reconcile one show after a local watched-progress write, whichever surface
 * issued it. The show's own detail reads are invalidated so they refetch on next
 * visit, and its single library entry is replaced from the scoped progress read:
 * that endpoint's per-user snapshot is the one the write just invalidated on
 * Trakt, and it is the only one a write on this show can have changed, so the Up
 * Next aggregate is never rebuilt for it. A read that fails leaves
 * `pendingAdvance` standing and the row advancing, which is the honest state
 * until a later read names the next episode.
 */
export function refreshShowProgress(
  qc: QueryClient,
  showId: number,
  load: () => Promise<ShowProgress>,
  episode?: { readonly season: number; readonly number: number } | "all",
): void {
  invalidateShowProgress(qc, showId, episode);
  void qc
    .fetchQuery({ queryKey: queryKeys.showProgress(showId), queryFn: load })
    .then((progress) => patchLibraryProgress(qc, showId, progress))
    .catch(() => {});
}

/** Optimistically flip a library entry's `hidden` (Stopped) flag in the shared SWR cache. */
export function patchLibraryHidden(qc: QueryClient, showId: number, hidden: boolean): void {
  patchLibraryEntry(qc, showId, (e) => ({ ...e, hidden }));
}

/** Whether the show currently sits in the hidden (Stopped) set, per the library cache. */
export function isLibraryHidden(qc: QueryClient, showId: number): boolean {
  const entries = qc.getQueryData<UpNextData>(queryKeys.library())?.entries;
  return entries?.find((e) => e.showId === showId)?.hidden ?? false;
}

/** Predicate over (season, episode, aired) selecting the episodes a patch flips. */
export type EpisodeMatch = (season: number, number: number, aired: boolean) => boolean;

function patchEpisodes(
  seasons: readonly SeasonView[],
  match: EpisodeMatch,
  watched: boolean,
): SeasonView[] {
  return seasons.map((season) => {
    let changed = false;
    const episodes = season.episodes.map((episode) => {
      if (match(season.number, episode.number, episode.aired) && episode.watched !== watched) {
        changed = true;
        return { ...episode, watched };
      }
      return episode;
    });
    if (!changed) return season;
    return { ...season, episodes, completedCount: episodes.filter((e) => e.watched).length };
  });
}

/**
 * Optimistically flip matching episodes in a show's cached season tree (the
 * show-detail accordion), recounting each touched season's completed count, so a
 * mark made on ANY surface ticks the season rows in the same frame. Shared by
 * the season controller and the queue-mark pipeline: the seasons cache lagging
 * behind a queue mark is a visible unwatched row, i.e. a double-mark invitation.
 */
export function patchShowSeasons(
  qc: QueryClient,
  showId: number,
  match: EpisodeMatch,
  watched: boolean,
): void {
  qc.setQueryData<readonly SeasonView[]>(queryKeys.showSeasons(showId), (old) =>
    old === undefined ? old : patchEpisodes(old, match, watched),
  );
}

/** Optimistically flip one episode's own detail read (the sheet renders from
 * it), so a per-episode action ticks the sheet and the season list together. */
export function patchEpisodeDetail(
  qc: QueryClient,
  showId: number,
  episode: { readonly season: number; readonly number: number },
  watched: boolean,
  watchedAt: string | null,
): void {
  qc.setQueryData<EpisodeDetail>(
    queryKeys.episode(showId, episode.season, episode.number),
    (old) => (old === undefined ? old : { ...old, watched, watchedAt }),
  );
}
