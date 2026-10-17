import type { EpisodeIds, MovieIds, ShowIds } from "../model/ids";
import type { QueuedOp, RequestDescriptor } from "./types";

const HISTORY = "/sync/history";
const HISTORY_REMOVE = "/sync/history/remove";
const HIDDEN = "/users/hidden/progress_watched";
const HIDDEN_REMOVE = "/users/hidden/progress_watched/remove";
const WATCHLIST = "/sync/watchlist";
const WATCHLIST_REMOVE = "/sync/watchlist/remove";

type HistorySection = "episodes" | "movies";

export interface HistoryOpParams {
  readonly opId: string;
  readonly ids: EpisodeIds | MovieIds;
  readonly watchedAt: string;
  readonly inversePatch?: unknown;
}

function post(path: string, body: unknown): RequestDescriptor {
  return { method: "POST", path, body };
}

export function episodeItemKey(trakt: number): string {
  return `episode:${trakt}`;
}

function historyOp(
  section: HistorySection,
  toState: "present" | "absent",
  params: HistoryOpParams,
): QueuedOp {
  const item = { ids: params.ids };
  const add = post(HISTORY, { [section]: [{ ...item, watched_at: params.watchedAt }] });
  const remove = post(HISTORY_REMOVE, { [section]: [item] });
  const marking = toState === "present";
  return {
    id: params.opId,
    itemKey: section === "movies" ? `movie:${params.ids.trakt}` : episodeItemKey(params.ids.trakt),
    request: marking ? add : remove,
    inverse: marking ? remove : add,
    inversePatch: params.inversePatch ?? null,
    watchedAt: params.watchedAt,
    fromState: marking ? "absent" : "present",
    toState,
    reconcileKeys:
      section === "movies"
        ? ["watched/movies", "movie-progress"]
        : ["progress/watched", "watched/shows"],
  };
}

export function buildMarkEpisodeOp(params: HistoryOpParams): QueuedOp {
  return historyOp("episodes", "present", params);
}

export function buildUnmarkEpisodeOp(params: HistoryOpParams): QueuedOp {
  return historyOp("episodes", "absent", params);
}

export function buildAddEpisodePlayOp(params: HistoryOpParams): QueuedOp {
  const op = historyOp("episodes", "present", params);
  return { ...op, itemKey: `${op.itemKey}:add:${params.opId}` };
}

export function buildMarkMovieOp(params: HistoryOpParams): QueuedOp {
  return historyOp("movies", "present", params);
}

export function buildUnmarkMovieOp(params: HistoryOpParams): QueuedOp {
  return historyOp("movies", "absent", params);
}

export interface RemoveHistoryPlayParams {
  readonly opId: string;
  // Trakt removes only these plays by id; removing by item deletes every play of it.
  readonly ids: readonly number[];
  readonly restore: {
    readonly section: HistorySection;
    readonly ids: EpisodeIds | MovieIds;
    readonly watchedAt: string;
  };
  readonly inversePatch?: unknown;
}

export function buildRemoveHistoryPlayOp(params: RemoveHistoryPlayParams): QueuedOp {
  const { section, ids, watchedAt } = params.restore;
  return {
    id: params.opId,
    itemKey: `history-play:${params.ids.join(",")}`,
    request: post(HISTORY_REMOVE, { ids: [...params.ids] }),
    inverse: post(HISTORY, { [section]: [{ ids, watched_at: watchedAt }] }),
    inversePatch: params.inversePatch ?? null,
    watchedAt,
    fromState: "present",
    toState: "absent",
    reconcileKeys:
      section === "movies"
        ? ["watched/movies", "movie-progress"]
        : ["progress/watched", "watched/shows"],
  };
}

export interface RemovePlaysParams {
  readonly opId: string;
  readonly ids: readonly number[];
  readonly restore: readonly { readonly trakt: number; readonly watchedAt: string }[];
}

export function buildRemovePlaysOp(params: RemovePlaysParams): QueuedOp {
  const ids = [...params.ids];
  return {
    id: params.opId,
    itemKey: `history-plays:${[...ids].sort((a, b) => a - b).join(",")}`,
    request: post(HISTORY_REMOVE, { ids }),
    inverse: post(HISTORY, {
      episodes: params.restore.map((r) => ({ ids: { trakt: r.trakt }, watched_at: r.watchedAt })),
    }),
    inversePatch: null,
    watchedAt: null,
    fromState: "present",
    toState: "absent",
    reconcileKeys: ["progress/watched", "watched/shows"],
  };
}

export interface HideOpParams {
  readonly opId: string;
  readonly ids: ShowIds;
  readonly inversePatch?: unknown;
}

function hideOp(toState: "present" | "absent", params: HideOpParams): QueuedOp {
  const body = { shows: [{ ids: params.ids }] };
  const add = post(HIDDEN, body);
  const remove = post(HIDDEN_REMOVE, body);
  const hiding = toState === "present";
  return {
    id: params.opId,
    itemKey: `show:${params.ids.trakt}:hidden`,
    request: hiding ? add : remove,
    inverse: hiding ? remove : add,
    inversePatch: params.inversePatch ?? null,
    watchedAt: null,
    fromState: hiding ? "absent" : "present",
    toState,
    reconcileKeys: ["hidden/progress_watched"],
  };
}

export function buildHideShowOp(params: HideOpParams): QueuedOp {
  return hideOp("present", params);
}

export function buildUnhideShowOp(params: HideOpParams): QueuedOp {
  return hideOp("absent", params);
}

type WatchlistSection = "shows" | "movies";

export interface WatchlistOpParams {
  readonly opId: string;
  readonly section: WatchlistSection;
  readonly ids: ShowIds | MovieIds;
  readonly inversePatch?: unknown;
}

function watchlistOp(toState: "present" | "absent", params: WatchlistOpParams): QueuedOp {
  const body = { [params.section]: [{ ids: params.ids }] };
  const add = post(WATCHLIST, body);
  const remove = post(WATCHLIST_REMOVE, body);
  const adding = toState === "present";
  return {
    id: params.opId,
    itemKey: `watchlist:${params.section}:${params.ids.trakt}`,
    request: adding ? add : remove,
    inverse: adding ? remove : add,
    inversePatch: params.inversePatch ?? null,
    watchedAt: null,
    fromState: adding ? "absent" : "present",
    toState,
    reconcileKeys: [`watchlist/${params.section}`],
  };
}

export function buildAddWatchlistOp(params: WatchlistOpParams): QueuedOp {
  return watchlistOp("present", params);
}

export function buildRemoveWatchlistOp(params: WatchlistOpParams): QueuedOp {
  return watchlistOp("absent", params);
}
