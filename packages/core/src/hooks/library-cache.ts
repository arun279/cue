import type { QueryClient } from "@tanstack/react-query";
import { invalidateShowProgress } from "../data/query-invalidation";
import { queryKeys } from "../data/query-keys";
import type { EpisodeDetail } from "../data/trakt/episode-detail";
import type { LibraryEntry } from "../data/trakt/library";
import { type SeasonView, type ShowProgress, toEpisodeRef } from "../data/trakt/show-detail";
import type { UpNextData } from "../runtime/runtime";

export function ensureLibraryEntry(qc: QueryClient, entry: LibraryEntry): void {
  qc.setQueryData<UpNextData>(queryKeys.library(), (old) =>
    old?.entries.some((item) => item.showId === entry.showId)
      ? old
      : { ...old, entries: [...(old?.entries ?? []), entry] },
  );
}

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

export function patchLibraryHidden(qc: QueryClient, showId: number, hidden: boolean): void {
  patchLibraryEntry(qc, showId, (e) => ({ ...e, hidden }));
}

export function isLibraryHidden(qc: QueryClient, showId: number): boolean {
  const entries = qc.getQueryData<UpNextData>(queryKeys.library())?.entries;
  return entries?.find((e) => e.showId === showId)?.hidden ?? false;
}

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
