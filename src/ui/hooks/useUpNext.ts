import type { LibraryEntry } from "@data/trakt/library";
import { groupUpNext, type UpNextItem } from "@domain/up-next";
import { DEFAULT_NEW_EPISODE_WINDOW_MS } from "@domain/watch-status";
import { type QueryStatus, queryStatus } from "@ui/hooks/query-freshness";
import { sortQueue, stabilizeProvisional } from "@ui/hooks/queue-order";
import { useLibrarySnapshot } from "@ui/hooks/useLibrarySnapshot";
import { usePrefs } from "@ui/prefs/prefs-store";
import { useEffect, useMemo, useRef } from "react";

interface EmptyStateCounts {
  /** Every tracked show, hidden included: 0 only when the library is truly empty. */
  readonly totalCount: number;
  /** Non-hidden tracked shows: 0 distinguishes an only-Stopped library from a real one. */
  readonly trackedCount: number;
  /** Non-hidden shows with at least one watched episode: 0 means nothing has been started. */
  readonly startedCount: number;
}

export interface UpNextCard {
  readonly item: UpNextItem;
  readonly entry: LibraryEntry;
}

export interface UpNextView extends QueryStatus {
  /** The flat active queue (marquee = its head when ≥3), ordered per the
   * "Next episode order" preference. */
  readonly queue: readonly UpNextCard[];
  /** In-progress but idle: the collapsed "Haven't watched lately" drawer. */
  readonly lapsedCards: readonly UpNextCard[];
  /** Shows beyond the cold-sync progress budget: rendered with the striped
   * bar + disabled-syncing check until their progress is read. */
  readonly syncPending: readonly LibraryEntry[];
  /** Watchlist members, for the empty state's "From your watchlist" tiles. */
  readonly watchlistEntries: readonly LibraryEntry[];
  /** Every tracked show, hidden included: 0 only when the library is truly empty. */
  readonly totalCount: number;
  /** Every non-hidden tracked show: distinguishes an only-Stopped library from a real one. */
  readonly trackedCount: number;
  /** Non-hidden shows with watch progress: 0 means nothing has been started yet. */
  readonly startedCount: number;
  /** The library exceeds the cold-sync progress budget, so only recent shows are
   * fully synced: the honest "recent shows synced" caveat. */
  readonly isPartial: boolean;
  refetch(): void;
}

/**
 * The Up Next read hook: the persisted-SWR `library` snapshot (instant paint from
 * the restored cache, background revalidate) run through the pure `groupUpNext`
 * partition, each item re-joined to its `LibraryEntry` for poster + action. The
 * fresh + continued groups flatten into one queue sorted per the user's order
 * preference; the domain grouping semantics themselves are untouched.
 */
export function useUpNext(): UpNextView {
  const { query, data, byId, thresholdMs } = useLibrarySnapshot();
  const order = usePrefs((s) => s.nextEpisodeOrder);
  // Last committed queue order (show ids): a just-marked row is pinned to its
  // slot through the reverse window instead of jumping mid-tap.
  const previousOrder = useRef<readonly number[]>([]);

  const groups = useMemo(() => {
    const empty = {
      queue: [] as UpNextCard[],
      lapsedCards: [] as UpNextCard[],
      syncPending: [] as LibraryEntry[],
      watchlistEntries: [] as LibraryEntry[],
    };
    if (data === undefined) return empty;
    const now = Date.now();
    const partition = groupUpNext(data.entries, now, thresholdMs, DEFAULT_NEW_EPISODE_WINDOW_MS);
    const toCards = (items: readonly UpNextItem[]): UpNextCard[] => {
      const out: UpNextCard[] = [];
      for (const item of items) {
        const entry = byId.get(item.showId);
        if (entry !== undefined) out.push({ item, entry });
      }
      return out;
    };
    const sorted = sortQueue([...partition.fresh, ...partition.continued], order);
    return {
      queue: toCards(stabilizeProvisional(sorted, previousOrder.current)),
      lapsedCards: toCards(partition.lapsed),
      syncPending: data.entries.filter((entry) => !entry.progressKnown && !entry.hidden),
      watchlistEntries: data.entries.filter((entry) => entry.inWatchlist && !entry.hidden),
    };
  }, [data, byId, thresholdMs, order]);

  useEffect(() => {
    previousOrder.current = groups.queue.map((card) => card.entry.showId);
  }, [groups.queue]);

  const counts = useMemo<EmptyStateCounts>(() => {
    if (data === undefined) return { totalCount: 0, trackedCount: 0, startedCount: 0 };
    const tracked = data.entries.filter((entry) => !entry.hidden);
    return {
      totalCount: data.entries.length,
      trackedCount: tracked.length,
      startedCount: tracked.filter((entry) => entry.completed > 0).length,
    };
  }, [data]);

  return {
    ...groups,
    ...counts,
    isPartial: data?.isPartial ?? false,
    ...queryStatus(query, data !== undefined),
    refetch: () => void query.refetch(),
  };
}
