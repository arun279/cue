import { toMs } from "./time";
import type { UpNextItem } from "./up-next";

export const NEXT_EPISODE_ORDER_OPTIONS = ["oldest-unwatched", "after-last-watched"] as const;
export type NextEpisodeOrder = (typeof NEXT_EPISODE_ORDER_OPTIONS)[number];

export const LAPSED_ORDER_OPTIONS = ["recently-watched", "longest-idle"] as const;
export type LapsedOrder = (typeof LAPSED_ORDER_OPTIONS)[number];

function airMs(item: UpNextItem): number {
  return toMs(item.episode?.firstAired ?? null) ?? Number.NEGATIVE_INFINITY;
}

function watchedMs(item: UpNextItem): number {
  return toMs(item.lastWatchedAt) ?? Number.NEGATIVE_INFINITY;
}

const byRecentlyWatched = (a: UpNextItem, b: UpNextItem): number =>
  watchedMs(b) - watchedMs(a) || airMs(a) - airMs(b);

const byLongestIdle = (a: UpNextItem, b: UpNextItem): number =>
  watchedMs(a) - watchedMs(b) || airMs(a) - airMs(b);

export function sortQueue(items: readonly UpNextItem[], order: NextEpisodeOrder): UpNextItem[] {
  const sorted = [...items];
  if (order === "after-last-watched") {
    sorted.sort(byRecentlyWatched);
  } else {
    sorted.sort((a, b) => airMs(a) - airMs(b) || watchedMs(b) - watchedMs(a));
  }
  return sorted;
}

export function sortLapsed(items: readonly UpNextItem[], order: LapsedOrder): UpNextItem[] {
  const sorted = [...items];
  if (order === "recently-watched") {
    sorted.sort(byRecentlyWatched);
  } else {
    sorted.sort(byLongestIdle);
  }
  return sorted;
}

export function stabilizePendingAdvance(
  sorted: readonly UpNextItem[],
  previousOrder: readonly number[],
  isPending: (showId: number) => boolean,
): UpNextItem[] {
  const pending = sorted.filter((item) => isPending(item.showId));
  if (pending.length === 0) return [...sorted];
  const out = sorted.filter((item) => !isPending(item.showId));
  const slotOf = (item: UpNextItem): number => {
    const previous = previousOrder.indexOf(item.showId);
    return previous === -1 ? sorted.indexOf(item) : previous;
  };
  for (const item of [...pending].sort((a, b) => slotOf(a) - slotOf(b))) {
    out.splice(Math.min(slotOf(item), out.length), 0, item);
  }
  return out;
}
