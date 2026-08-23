import { toMs } from "@domain/time";
import type { UpNextItem } from "@domain/up-next";
import type { LapsedOrder, NextEpisodeOrder } from "@ui/prefs/tracking";

function airMs(item: UpNextItem): number {
  // A provisional post-mark projection has no air date. Treating it as OLDEST
  // keeps a just-marked show at the head of the queue through its reverse window
  // instead of yanking it to the bottom until the authoritative next lands.
  return toMs(item.episode.firstAired) ?? Number.NEGATIVE_INFINITY;
}

function watchedMs(item: UpNextItem): number {
  return toMs(item.lastWatchedAt) ?? Number.NEGATIVE_INFINITY;
}

const byRecentlyWatched = (a: UpNextItem, b: UpNextItem): number =>
  watchedMs(b) - watchedMs(a) || airMs(a) - airMs(b);

const byLongestIdle = (a: UpNextItem, b: UpNextItem): number =>
  watchedMs(a) - watchedMs(b) || airMs(a) - airMs(b);

/**
 * Order the flat Up Next queue per the "Next episode order" preference:
 * `oldest-unwatched` (default) leads with the show whose next unwatched episode
 * has waited longest; `after-last-watched` leads with the user's own most
 * recently watched show. Each tiebreaks on the other signal so the order is
 * stable across refetches.
 */
export function sortQueue(items: readonly UpNextItem[], order: NextEpisodeOrder): UpNextItem[] {
  const sorted = [...items];
  if (order === "after-last-watched") {
    sorted.sort(byRecentlyWatched);
  } else {
    sorted.sort((a, b) => airMs(a) - airMs(b) || watchedMs(b) - watchedMs(a));
  }
  return sorted;
}

/**
 * Order the "Haven't watched lately" drawer per its preference: `recently-watched`
 * (default) leads with the show the user most recently touched, so a show just
 * dropped sits at the top; `longest-idle` leads with the oldest `lastWatchedAt`
 * (unknown = oldest). Ties fall through to air date (ascending).
 */
export function sortLapsed(items: readonly UpNextItem[], order: LapsedOrder): UpNextItem[] {
  const sorted = [...items];
  if (order === "recently-watched") {
    sorted.sort(byRecentlyWatched);
  } else {
    sorted.sort(byLongestIdle);
  }
  return sorted;
}

/**
 * Pin just-marked rows to the slot they held before the mark. Both sort orders
 * would otherwise move a row the instant it is tapped, pulling its live undo
 * toggle out from under the finger and putting a different show's unwatched
 * check there. The row moves to its real slot once the authoritative next
 * episode lands and the check re-arms.
 */
export function stabilizePendingAdvance(
  sorted: readonly UpNextItem[],
  previousOrder: readonly number[],
  isPending: (showId: number) => boolean,
): UpNextItem[] {
  const pending = sorted.filter((item) => isPending(item.showId));
  if (pending.length === 0) return [...sorted];
  const out = sorted.filter((item) => !isPending(item.showId));
  // An unknown previous slot (fresh mount mid-advance) keeps the sorted slot.
  const slotOf = (item: UpNextItem): number => {
    const previous = previousOrder.indexOf(item.showId);
    return previous === -1 ? sorted.indexOf(item) : previous;
  };
  for (const item of [...pending].sort((a, b) => slotOf(a) - slotOf(b))) {
    out.splice(Math.min(slotOf(item), out.length), 0, item);
  }
  return out;
}
