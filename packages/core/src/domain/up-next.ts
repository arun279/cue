import type { EpisodeRef, LibraryShow } from "./model/library";
import { toMs } from "./time";
import { computeWatchStatus, type WatchStatus } from "./watch-status";

export interface UpNextItem {
  readonly showId: number;
  readonly title: string;
  readonly episode: EpisodeRef | null;
  readonly lastWatchedAt: string | null;
  readonly backlog: number;
}

/**
 * The honest partition of the tonight list: `queue` (in-progress with an aired
 * unwatched next, plus any just-marked show still carrying its provisional next
 * projection) and `lapsed` (in-progress but idle past the threshold: the soft
 * drawer at the bottom). Both come unordered; the presentation layer sorts each
 * by its own user preference.
 */
export interface UpNextGroups {
  readonly queue: UpNextItem[];
  readonly lapsed: UpNextItem[];
}

/** The states with nothing to queue: hidden, never started, or a finished run. */
const NOTHING_TO_QUEUE: ReadonlySet<WatchStatus> = new Set(["abandoned", "not-started", "ended"]);

/**
 * Whether a show nobody has just marked belongs on tonight's list. The air test
 * is explicit rather than inferred from the status: a show past the progress
 * budget is in-progress on its bulk counts alone, and an unaired (or
 * unknown-date) next episode is never something to queue tonight.
 */
function hasSomethingToWatch(show: LibraryShow, status: WatchStatus, now: number): boolean {
  if (status !== "watching" && status !== "lapsed") return false;
  const airedMs = show.nextEpisode === null ? null : toMs(show.nextEpisode.firstAired);
  return airedMs !== null && airedMs <= now;
}

/**
 * Partition in-progress shows for Up Next on verifiable facts only: no taste,
 * popularity, or "for you" ranking. Shows in a state with no next to queue
 * (`abandoned`/`not-started`/`ended`) are excluded, even for a just-marked show,
 * so an advancing row can never resurrect one into Up Next. A `watching` show
 * queues, a `lapsed` one (idle past `thresholdMs` since it last had something to
 * watch) lands in the drawer.
 *
 * A just-marked show stays in the queue, visible and locked, until the
 * authoritative refetch lands: its next is either a client projection (air date
 * unknown) or, past the aired run, not knowable at all, and either way the row
 * belongs where the reader left it rather than vanishing under the finger that
 * marked it.
 */
export function groupUpNext(
  shows: readonly LibraryShow[],
  now: number,
  thresholdMs: number,
): UpNextGroups {
  const queue: UpNextItem[] = [];
  const lapsed: UpNextItem[] = [];

  for (const show of shows) {
    const status = computeWatchStatus(show, now, thresholdMs);
    if (NOTHING_TO_QUEUE.has(status)) continue;
    if (!show.pendingAdvance && !hasSomethingToWatch(show, status, now)) continue;
    const item: UpNextItem = {
      showId: show.showId,
      title: show.title,
      episode: show.nextEpisode,
      lastWatchedAt: show.lastWatchedAt,
      backlog: Math.max(0, show.aired - show.completed),
    };
    if (!show.pendingAdvance && status === "lapsed") lapsed.push(item);
    else queue.push(item);
  }

  return { queue, lapsed };
}

/** Which of the five honest empty screens Up Next owes a library with no queue. */
export type UpNextEmptyKind =
  | "nothing-tracked"
  | "only-stopped"
  | "nothing-started"
  | "unresolved"
  | "caught-up";

export interface UpNextComposition {
  readonly queued: number;
  /** Every tracked show, hidden included: 0 only when the library is truly empty. */
  readonly totalCount: number;
  /** Non-hidden tracked shows: 0 distinguishes an only-Stopped library from a real one. */
  readonly trackedCount: number;
  /** Non-hidden shows with at least one watched episode: 0 means nothing has been started. */
  readonly startedCount: number;
  /** Non-hidden shows with episodes left whose next episode is not known. */
  readonly unresolvedCount: number;
  /** Whether the library read has landed; before it has, no empty state is honest. */
  readonly hasData: boolean;
}

/**
 * The empty branch this library composition earns, or null when a card renders.
 *
 * Decided from real composition rather than from an empty array, so the home
 * screen never tells a user the opposite of their state: a library of only
 * stopped shows must not read "nothing queued", a watchlist-only library must
 * not read "all caught up", and shows with episodes left whose next episode is
 * still unknown must not be counted as caught up either.
 */
export function upNextEmptyKind(view: UpNextComposition): UpNextEmptyKind | null {
  if (!view.hasData || view.queued > 0) return null;
  if (view.totalCount === 0) return "nothing-tracked";
  if (view.trackedCount === 0) return "only-stopped";
  if (view.startedCount === 0) return "nothing-started";
  return view.unresolvedCount > 0 ? "unresolved" : "caught-up";
}
