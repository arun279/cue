import type { QueryClient } from "@tanstack/react-query";
import { invalidateShowProgress } from "../data/query-invalidation";
import { queryKeys } from "../data/query-keys";
import type { EpisodeDetail } from "../domain/episode-detail";
import {
  type LibraryEntry,
  playsOnlyInProgress,
  type Stopped,
  stoppedOf,
} from "../domain/model/library";
import {
  type EpisodeMatch,
  patchEpisodes,
  type SeasonView,
  type ShowProgress,
  toEpisodeRef,
} from "../domain/show-detail";
import type { QueuedOp } from "../domain/write-queue/types";
import type { CueRuntime, UpNextData } from "../runtime/runtime";
import { forgetOwnMark, isBehindOwnMark, keepOwnMark, type OwnMark } from "../stores/own-marks";
import { whenNoWritePending } from "../stores/write-locks";

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
): Promise<void> {
  if (ownMark === undefined) forgetOwnMark(showId);
  else keepOwnMark(showId, ownMark);
  invalidateShowProgress(qc, showId, episode);
  return qc
    .fetchQuery({ queryKey: queryKeys.showProgress(showId), queryFn: load })
    .then((progress) => {
      if (!isBehindOwnMark(showId, progress.completed)) patchLibraryProgress(qc, showId, progress);
    })
    .catch(() => {});
}

/**
 * Reads lists that hold many shows or movies again, once no write to any of them is pending: those a
 * screen shows, or with "all" every one in the cache.
 */
export const rereadLists = (
  qc: QueryClient,
  keys: readonly (readonly unknown[])[],
  refetchType: "active" | "all" = "active",
): Promise<void> =>
  new Promise((resolve) => {
    whenNoWritePending(() => {
      void Promise.all(
        keys.map((queryKey) => qc.invalidateQueries({ queryKey, refetchType })),
      ).then(() => resolve());
    });
  });

const MOVIE_LISTS = [queryKeys.movieLibrary(), queryKeys.movieWatchlist()];

/**
 * Reads back from Trakt what a write it refused showed: the progress of the show it was made on at
 * once, and the lists of many shows or movies once no write is pending. A write that does not say
 * which show or movie it changed reads every list again.
 */
export const readBackRefused =
  (qc: QueryClient, runtime: Pick<CueRuntime, "loadShowProgress">) =>
  async (op: QueuedOp): Promise<void> => {
    const [kind, id] = op.target?.split(":") ?? [];
    const showId = Number(id);
    const history = op.request.path.startsWith("/sync/history");
    const library = kind === "movie" ? [] : [queryKeys.library()];
    await Promise.all([
      history && qc.invalidateQueries({ queryKey: queryKeys.historyPrefix() }),
      kind === "show" &&
        history &&
        refreshShowProgress(qc, showId, () => runtime.loadShowProgress(showId), "all"),
      rereadLists(qc, kind === "show" ? library : [...library, ...MOVIE_LISTS], "all"),
    ]);
  };

export function patchStopped(qc: QueryClient, showId: number, stopped: Stopped | null): void {
  patchLibraryEntry(qc, showId, (e) => ({
    ...e,
    hidden: stopped !== null,
    dropped: stopped === "dropped",
  }));
}

const libraryEntryOf = (qc: QueryClient, showId: number): LibraryEntry | undefined =>
  qc.getQueryData<UpNextData>(queryKeys.library())?.entries.find((e) => e.showId === showId);

/** Whether the show may have a play its progress does not count, as a show watched again from the start has. */
export function mayHavePlaysOutsideProgress(qc: QueryClient, showId: number): boolean {
  const entry = libraryEntryOf(qc, showId);
  return entry === undefined || !playsOnlyInProgress(entry);
}

export function stoppedIn(qc: QueryClient, showId: number): Stopped | null {
  const entry = libraryEntryOf(qc, showId);
  return entry === undefined ? null : stoppedOf(entry);
}

/** Sets the matching episodes watched or not, and returns the `season:number` of each it changed. */
export function patchShowSeasons(
  qc: QueryClient,
  showId: number,
  match: EpisodeMatch,
  watched: boolean,
): ReadonlySet<string> {
  const key = queryKeys.showSeasons(showId);
  const changed = new Set(
    (qc.getQueryData<readonly SeasonView[]>(key) ?? []).flatMap((season) =>
      season.episodes
        .filter((e) => e.watched !== watched && match(season.number, e.number, e.aired))
        .map((e) => `${season.number}:${e.number}`),
    ),
  );
  qc.setQueryData<readonly SeasonView[]>(key, (old) =>
    old === undefined ? old : patchEpisodes(old, match, watched),
  );
  return changed;
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
