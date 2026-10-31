import type { QueryClient } from "@tanstack/react-query";
import { invalidateShowProgress } from "../data/query-invalidation";
import { queryKeys } from "../data/query-keys";
import type { EpisodeDetail } from "../domain/episode-detail";
import type { LibraryEntry } from "../domain/model/library";
import {
  type EpisodeMatch,
  patchEpisodes,
  type SeasonView,
  type ShowProgress,
  toEpisodeRef,
} from "../domain/show-detail";
import type { UpNextData } from "../runtime/runtime";
import { forgetOwnMark, isBehindOwnMark, keepOwnMark, type OwnMark } from "../stores/own-marks";

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
    lastWatchedAt: progress.lastWatchedAt,
    plays: null,
    left: progress.left,
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
  ownMark?: OwnMark,
): void {
  if (ownMark === undefined) forgetOwnMark(showId);
  else keepOwnMark(showId, ownMark);
  invalidateShowProgress(qc, showId, episode);
  void qc
    .fetchQuery({ queryKey: queryKeys.showProgress(showId), queryFn: load })
    .then((progress) => {
      if (!isBehindOwnMark(showId, progress.completed)) patchLibraryProgress(qc, showId, progress);
    })
    .catch(() => {});
}

export function patchLibraryHidden(qc: QueryClient, showId: number, hidden: boolean): void {
  patchLibraryEntry(qc, showId, (e) => ({ ...e, hidden }));
}

export function isLibraryHidden(qc: QueryClient, showId: number): boolean {
  const entries = qc.getQueryData<UpNextData>(queryKeys.library())?.entries;
  return entries?.find((e) => e.showId === showId)?.hidden ?? false;
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
