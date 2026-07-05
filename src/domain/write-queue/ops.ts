import type { EpisodeIds, MovieIds, ShowIds } from "../model/ids";
import type { QueuedOp, RequestDescriptor } from "./types";

const HISTORY = "/sync/history";
const HISTORY_REMOVE = "/sync/history/remove";
const HIDDEN = "/users/hidden/progress_watched";
const HIDDEN_REMOVE = "/users/hidden/progress_watched/remove";
const RATINGS = "/sync/ratings";
const RATINGS_REMOVE = "/sync/ratings/remove";
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
    itemKey: `${section === "movies" ? "movie" : "episode"}:${params.ids.trakt}`,
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

export function buildMarkMovieOp(params: HistoryOpParams): QueuedOp {
  return historyOp("movies", "present", params);
}

export function buildUnmarkMovieOp(params: HistoryOpParams): QueuedOp {
  return historyOp("movies", "absent", params);
}

export interface HideOpParams {
  readonly opId: string;
  readonly ids: ShowIds;
  readonly inversePatch?: unknown;
}

/**
 * Add/remove a show from Trakt's hidden set. Hiding is the add
 * (`/users/hidden/progress_watched`); its inverse un-hides. `watchedAt` is null
 * — this op carries no history play. The hidden set is Cue's client-side
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

/** Rate/watchlist target on shows or episodes (movies only). */
export type RateSection = "shows" | "episodes" | "movies";
type WatchlistSection = "shows" | "movies";

export interface RateOpParams {
  readonly opId: string;
  readonly section: RateSection;
  readonly ids: ShowIds | EpisodeIds | MovieIds;
  /** 1–10 (Trakt numeric model). */
  readonly rating: number;
  /**
   * The rating this item carried before this write, or `null` if it was unrated.
   * The inverse restores it so an Undo of a re-rate (6 → 8) returns to 6 rather
   * than removing the rating outright.
   */
  readonly previousRating?: number | null;
  readonly inversePatch?: unknown;
}

export interface UnrateOpParams {
  readonly opId: string;
  readonly section: RateSection;
  readonly ids: ShowIds | EpisodeIds | MovieIds;
  /** Restored by the inverse so an Undo re-applies the exact prior rating. */
  readonly previousRating: number;
  readonly inversePatch?: unknown;
}

/**
 * A rating write. Setting a rating is a `POST /sync/ratings` whose inverse
 * undoes *this* write: for a first rating it removes the rating; for a re-rate it
 * restores `previousRating`, so Undo of 6 → 8 returns to 6 instead of clearing it.
 * A re-rate on the same item coalesces on `itemKey` so only the last value
 * survives. Rating writes carry no `watched_at` and are idempotent — a
 * lost-response retry re-sends the same value, so no reconcile anchor is needed.
 */
export function buildRateOp(params: RateOpParams): QueuedOp {
  const item = { ids: params.ids };
  const previous = params.previousRating ?? null;
  return {
    id: params.opId,
    itemKey: `rating:${params.section}:${params.ids.trakt}`,
    request: post(RATINGS, { [params.section]: [{ ...item, rating: params.rating }] }),
    inverse:
      previous === null
        ? post(RATINGS_REMOVE, { [params.section]: [item] })
        : post(RATINGS, { [params.section]: [{ ...item, rating: previous }] }),
    inversePatch: params.inversePatch ?? null,
    watchedAt: null,
    fromState: previous === null ? "absent" : "present",
    toState: "present",
    reconcileKeys: [`ratings/${params.section}`],
  };
}

/** Remove a rating; its inverse restores `previousRating` so Undo is exact. */
export function buildUnrateOp(params: UnrateOpParams): QueuedOp {
  const item = { ids: params.ids };
  return {
    id: params.opId,
    itemKey: `rating:${params.section}:${params.ids.trakt}`,
    request: post(RATINGS_REMOVE, { [params.section]: [item] }),
    inverse: post(RATINGS, { [params.section]: [{ ...item, rating: params.previousRating }] }),
    inversePatch: params.inversePatch ?? null,
    watchedAt: null,
    fromState: "present",
    toState: "absent",
    reconcileKeys: [`ratings/${params.section}`],
  };
}

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
