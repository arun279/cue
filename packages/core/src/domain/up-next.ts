import type { EpisodeRef, LibraryShow } from "./model/library";
import { toMs } from "./time";
import { computeWatchStatus } from "./watch-status";

export interface UpNextItem {
  readonly showId: number;
  readonly title: string;
  readonly episode: EpisodeRef;
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

/**
 * Partition in-progress shows for Up Next on verifiable facts only: no taste,
 * popularity, or "for you" ranking. Shows in a state with no next to queue
 * (`abandoned`/`not-started`/`ended`) are excluded; a `watching` show
 * queues, a `lapsed` one (idle past `thresholdMs` since it last had something to
 * watch) lands in the drawer. A just-marked show whose next is still a provisional
 * post-mark projection (`ids.trakt === 0`, air date unknown) stays in the queue,
 * visible and locked, until the authoritative refetch lands.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Partitions shows using status, provisional advance, air time, and lapse rules that jointly define queue membership.
export function groupUpNext(
  shows: readonly LibraryShow[],
  now: number,
  thresholdMs: number,
): UpNextGroups {
  const queue: UpNextItem[] = [];
  const lapsed: UpNextItem[] = [];

  for (const show of shows) {
    const ep = show.nextEpisode;
    if (ep === null) continue;
    const status = computeWatchStatus(show, now, thresholdMs);
    // Hard exclusions apply even to a just-marked show's optimistic projection: a
    // hidden (`abandoned`), never-started, or fully-watched `ended` show has no next
    // to queue, so a provisional projection must never resurrect it into Up Next.
    if (status === "abandoned" || status === "not-started" || status === "ended") continue;
    const provisional = ep.ids.trakt === 0;
    if (!provisional) {
      // Otherwise only in-progress shows with an AIRED next surface. The air test is
      // explicit rather than inferred from the status: a show past the progress
      // budget is in-progress on its bulk counts alone, and an unaired (or
      // unknown-date) next episode is never something to queue tonight.
      if (status !== "watching" && status !== "lapsed") continue;
      const airedMs = toMs(ep.firstAired);
      if (airedMs === null || airedMs > now) continue;
    }
    const item: UpNextItem = {
      showId: show.showId,
      title: show.title,
      episode: ep,
      lastWatchedAt: show.lastWatchedAt,
      backlog: Math.max(0, show.aired - show.completed),
    };
    if (!provisional && status === "lapsed") lapsed.push(item);
    else queue.push(item);
  }

  return { queue, lapsed };
}
