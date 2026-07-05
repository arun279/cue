import type { EpisodeIds, MovieIds } from "../model/ids";
import type { QueuedOp, RequestDescriptor } from "./types";

const HISTORY = "/sync/history";
const HISTORY_REMOVE = "/sync/history/remove";

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
