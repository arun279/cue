import type { QueryClient } from "@tanstack/react-query";
import { showProgressKeys } from "../data/query-invalidation";
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
import { targetOf } from "../domain/write-queue/ops";
import type { QueuedOp, WriteTarget } from "../domain/write-queue/types";
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

/** Reads the show's progress, seasons and episode pages again; fails unless Trakt answered. */
export async function refreshShowProgress(
  qc: QueryClient,
  showId: number,
  load: () => Promise<ShowProgress>,
  episode?: { readonly season: number; readonly number: number } | "all",
  ownMark?: OwnMark,
): Promise<void> {
  if (ownMark === undefined) forgetOwnMark(showId);
  else keepOwnMark(showId, ownMark);
  const progressKey = queryKeys.showProgress(showId);
  const views = showProgressKeys(showId, episode).slice(1);
  await qc.invalidateQueries({ queryKey: progressKey, refetchType: "none" });
  const progress = qc.fetchQuery({ queryKey: progressKey, queryFn: load }).then((read) => {
    assertRead(qc, [progressKey], "all");
    if (!isBehindOwnMark(showId, read.completed)) patchLibraryProgress(qc, showId, read);
  });
  await Promise.all([progress, reread(qc, views)]);
}

/** Reads lists that hold many shows or movies again once no write to any of them is pending. */
export const rereadLists = (qc: QueryClient, keys: readonly (readonly unknown[])[]): void =>
  whenNoWritePending(() => {
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  });

type Keys = readonly (readonly unknown[])[];

/** Fails unless every one of these queries has been read since it was marked out of date. */
function assertRead(qc: QueryClient, keys: Keys, type: "active" | "all"): void {
  const cache = qc.getQueryCache();
  const unread = keys.some((queryKey) =>
    cache.findAll({ queryKey, type }).some((query) => query.state.isInvalidated),
  );
  if (unread) throw new Error("Trakt was not read again");
}

/**
 * Reads these queries again, those no screen shows too with "all". All are marked out of date before
 * any is fetched, so one built from another reads it fresh; a read that pauses or is cancelled fails.
 */
async function reread(qc: QueryClient, keys: Keys, type: "active" | "all" = "active") {
  await Promise.all(
    keys.map((queryKey) => qc.invalidateQueries({ queryKey, refetchType: "none" })),
  );
  const options = { throwOnError: true, cancelRefetch: false };
  await Promise.all(keys.map((queryKey) => qc.refetchQueries({ queryKey, type }, options)));
  assertRead(qc, keys, type);
}

const LIBRARY = queryKeys.library();
const MOVIE_LISTS = [queryKeys.movieLibrary(), queryKeys.movieWatchlist()];
const listsOf = (target: WriteTarget | null): readonly (readonly unknown[])[] => {
  if (target === null) return [LIBRARY, ...MOVIE_LISTS];
  return target.kind === "show" ? [LIBRARY] : MOVIE_LISTS;
};
const SHOW_VIEWS = (["progress", "seasons", "episode"] as const).map(queryKeys.showSection);

/**
 * Reads back what a refused write showed: its show's progress at once, and the lists once no write
 * is pending. A write that names no show or movie reads every show and list. Fails unless Trakt
 * answered every read.
 */
export const readBackRefused =
  (qc: QueryClient, runtime: Pick<CueRuntime, "loadShowProgress">) =>
  async (op: QueuedOp): Promise<void> => {
    const target = targetOf(op);
    const history = op.request.path.startsWith("/sync/history");
    await Promise.all([
      history && reread(qc, [queryKeys.historyPrefix()]),
      history &&
        target?.kind === "show" &&
        refreshShowProgress(qc, target.id, () => runtime.loadShowProgress(target.id), "all"),
      history && target === null && reread(qc, SHOW_VIEWS),
      new Promise((resolve) =>
        whenNoWritePending(() => resolve(reread(qc, listsOf(target), "all"))),
      ),
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
