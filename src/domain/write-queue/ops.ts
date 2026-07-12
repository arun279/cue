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
  /** Frozen at enqueue; a retry re-sends this exact timestamp. */
  readonly watchedAt: string;
  readonly inversePatch?: unknown;
}

function post(path: string, body: unknown): RequestDescriptor {
  return { method: "POST", path, body };
}

/** Coalescing key of a single-episode history op: exported so every mark
 * surface (and the UI's pending-mark registry) keys the same episode the same
 * way the ops do. */
export function episodeItemKey(trakt: number): string {
  return `episode:${trakt}`;
}

/**
 * A single-item history op and its inverse. Marking is an add whose inverse is a
 * remove-by-item (all plays); unmarking is the mirror. `watchedAt` is frozen on
 * the op and its restore-inverse so replays stay byte-identical.
 */
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

/**
 * A deliberate ADDITIVE play: the rewatch increment behind "Add another play".
 * The request is a normal history add, but the itemKey is uniquified by the op
 * id so coalescing can never treat it as redundant against a pending mark (or
 * cancel it against a pending unmark) of the same episode: additive intent is
 * never one side of a toggle. Like every rewatch addition, its item-scoped
 * inverse is why the callers surface no Undo for it.
 */
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
  /**
   * The exact Trakt history-event ids to remove. `/sync/history/remove { ids }`
   * deletes precisely these plays and NOTHING else: the item's other plays and
   * rewatches survive. This is the only history removal that is truly per-play; a
   * remove-by-item (`{ episodes|movies:[{ids}] }`) wipes every play of the item.
   */
  readonly ids: readonly number[];
  /**
   * The item + timestamp for the best-effort restore inverse. Removal by history
   * id is EXACT; the restore re-adds the play by item + `watched_at`, so Trakt may
   * mint a new history id / action: the reversal is best-effort, not forensic.
   */
  readonly restore: {
    readonly section: HistorySection;
    readonly ids: EpisodeIds | MovieIds;
    readonly watchedAt: string;
  };
  readonly inversePatch?: unknown;
}

/**
 * Remove exactly one (or a few) history plays by their Trakt event ids: the
 * canonical safe removal the Diary offers on each row. Unlike
 * the mark-undo path, the Diary reads real `id`s from `/users/me/history`, so it
 * can scope the delete to the precise play and never disturb a rewatch. Retrying a
 * lost remove is idempotent (the id is already gone), so no reconcile anchor is
 * needed; the inverse re-adds the play best-effort for the Undo snackbar.
 */
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
  /** The exact Trakt history-event ids to remove: never an item/season token. */
  readonly ids: readonly number[];
  /**
   * The episodes to re-add for the Undo, each by its trakt id + frozen `watched_at`.
   * Restore is best-effort (Trakt mints fresh history ids on the re-add), matching
   * the Diary's per-play restore semantics.
   */
  readonly restore: readonly { readonly trakt: number; readonly watchedAt: string }[];
}

/**
 * Remove a SET of episode plays by their exact history-event ids: the durable,
 * per-play-safe reversal behind "Unmark season" and the per-episode uncheck
 * Because it deletes precise history ids, it can never wipe a play it
 * wasn't handed (a rewatch the planner deliberately left out survives). A lost
 * remove is idempotent (the ids are already gone), so no reconcile anchor is
 * needed; the inverse re-adds the removed episodes best-effort for the Undo.
 */
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
    watchedAt: params.restore[0]?.watchedAt ?? null,
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

/**
 * Add/remove a show from Trakt's hidden set. Hiding is the add
 * (`/users/hidden/progress_watched`); its inverse un-hides. `watchedAt` is null,
 * this op carries no history play. The hidden set is Cue's client-side
 * exclusion source, filtered out of Up Next + the calendar on every read.
 */
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

/**
 * A watchlist add/remove. Adding is `POST /sync/watchlist`; its inverse
 * removes. Idempotent (a re-add is a no-op on Trakt), so a lost-response retry is
 * safe without a reconcile anchor. The "To watch" bucket is derived from
 * membership, so the caller patches the library cache optimistically.
 */
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
