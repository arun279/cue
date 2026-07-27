import type { LibraryEntry } from "@data/trakt/library";
import { byTitle, type LibrarySort } from "@domain/library-buckets";
import { toMs } from "@domain/time";
import { computeWatchStatus } from "@domain/watch-status";
import { type QueryStatus, queryStatus } from "@ui/hooks/query-freshness";
import { useLibrarySnapshot } from "@ui/hooks/useLibrarySnapshot";
import { useMemo } from "react";

/**
 * The Library status chips. Statuses map onto them plainly: `caught-up` folds
 * into Watching (an up-to-date show is still one you watch; Finished is
 * reserved for completed terminal runs), `lapsed` folds into Watching (the
 * lapsed cut is Up Next's drawer, not a Library pile), `not-started` reads as
 * Watchlist, `abandoned` as Stopped.
 */
export type LibraryChipKey = "watching" | "watchlist" | "stopped" | "finished";

export type LibraryChips = Readonly<Record<LibraryChipKey, readonly LibraryEntry[]>>;

function progressRatio(entry: LibraryEntry): number {
  return entry.aired > 0 ? entry.completed / entry.aired : 0;
}

/** The domain bucket comparators (the S10 sort set), restated over entries so
 * the merged Watching chip keeps one order across its two source statuses. */
function comparatorFor(sort: LibrarySort): (a: LibraryEntry, b: LibraryEntry) => number {
  if (sort === "alphabetical") return byTitle;
  if (sort === "progress") return (a, b) => progressRatio(b) - progressRatio(a);
  return (a, b) => (toMs(b.lastWatchedAt) ?? 0) - (toMs(a.lastWatchedAt) ?? 0);
}

function chipOf(entry: LibraryEntry, now: number, thresholdMs: number): LibraryChipKey {
  const status = computeWatchStatus(entry, now, thresholdMs);
  switch (status) {
    case "watching":
    case "lapsed":
    case "caught-up":
      return "watching";
    case "not-started":
      return "watchlist";
    case "abandoned":
      return "stopped";
    case "ended":
      return "finished";
  }
}

/** Pure chip grouping: every entry lands in exactly one chip, each chip sorted
 * by the segment's chosen comparator. */
export function chipBuckets(
  entries: readonly LibraryEntry[],
  now: number,
  thresholdMs: number,
  sort: LibrarySort,
): LibraryChips {
  const lists: Record<LibraryChipKey, LibraryEntry[]> = {
    watching: [],
    watchlist: [],
    stopped: [],
    finished: [],
  };
  for (const entry of entries) {
    lists[chipOf(entry, now, thresholdMs)].push(entry);
  }
  const comparator = comparatorFor(sort);
  for (const list of Object.values(lists)) list.sort(comparator);
  return lists;
}

export interface LibraryChipsView extends QueryStatus {
  readonly chips: LibraryChips;
  refetch(): void;
}

/**
 * The Library shows read hook: the same persisted `library` snapshot Up Next
 * paints from, grouped into the status chips against the live staleness
 * threshold. Reuses the shared cache so the screen paints instantly on
 * navigation with no extra fetch.
 */
export function useLibraryBuckets(sort: LibrarySort, enabled = true): LibraryChipsView {
  const { query, data, thresholdMs } = useLibrarySnapshot(enabled);

  const chips = useMemo<LibraryChips>(
    () => chipBuckets(data?.entries ?? [], Date.now(), thresholdMs, sort),
    [data, thresholdMs, sort],
  );

  return {
    chips,
    ...queryStatus(query, data !== undefined),
    refetch: () => void query.refetch(),
  };
}
