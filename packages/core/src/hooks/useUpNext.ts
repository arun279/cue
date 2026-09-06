import { useEffect, useMemo, useRef } from "react";
import type { LibraryEntry } from "../data/trakt/library";
import { groupUpNext, type UpNextItem } from "../domain/up-next";
import { usePrefs } from "../prefs/prefs-store";
import { type QueryStatus, queryStatus } from "./query-freshness";
import { sortLapsed, sortQueue, stabilizePendingAdvance } from "./queue-order";
import { useLibrarySnapshot } from "./useLibrarySnapshot";

interface EmptyStateCounts {
  /** Every tracked show, hidden included: 0 only when the library is truly empty. */
  readonly totalCount: number;
  /** Non-hidden tracked shows: 0 distinguishes an only-Stopped library from a real one. */
  readonly trackedCount: number;
  /** Non-hidden shows with at least one watched episode: 0 means nothing has been started. */
  readonly startedCount: number;
  /**
   * Non-hidden shows with episodes left whose next episode is not known, so no card
   * can name one: past the cold-sync progress budget. Above zero, "you're all
   * caught up" would be a lie.
   */
  readonly unresolvedCount: number;
}

export interface UpNextCard {
  readonly item: UpNextItem;
  readonly entry: LibraryEntry;
}

export interface UpNextView extends QueryStatus {
  /** The flat active queue (marquee = its head when ≥3), ordered per the
   * "Next episode order" preference. */
  readonly queue: readonly UpNextCard[];
  /** In-progress but idle: the drawer ordered per the "Haven't watched lately order" preference. */
  readonly lapsedCards: readonly UpNextCard[];
  /** Watchlist members, for the empty state's "From your watchlist" tiles. */
  readonly watchlistEntries: readonly LibraryEntry[];
  /** Every tracked show, hidden included: 0 only when the library is truly empty. */
  readonly totalCount: number;
  /** Every non-hidden tracked show: distinguishes an only-Stopped library from a real one. */
  readonly trackedCount: number;
  /** Non-hidden shows with watch progress: 0 means nothing has been started yet. */
  readonly startedCount: number;
  /** Non-hidden shows with episodes left but no known next episode: above zero the
   * queue cannot be empty AND the user caught up. */
  readonly unresolvedCount: number;
  refetch(): void;
}

/**
 * The Up Next read hook: the persisted-SWR `library` snapshot (instant paint from
 * the restored cache, background revalidate) run through the pure `groupUpNext`
 * partition, each item re-joined to its `LibraryEntry` for poster + action. The
 * queue and drawer are sorted per their respective user preferences.
 */
export function useUpNext(): UpNextView {
  const { query, data, thresholdMs } = useLibrarySnapshot();
  const order = usePrefs((s) => s.nextEpisodeOrder);
  const lapsedOrder = usePrefs((s) => s.lapsedOrder);
  // Last committed queue order (show ids): a just-marked row is pinned to its
  // slot through the reverse window instead of jumping mid-tap.
  const previousOrder = useRef<readonly number[]>([]);

  const groups = useMemo(() => {
    const empty = {
      queue: [] as UpNextCard[],
      lapsedCards: [] as UpNextCard[],
      watchlistEntries: [] as LibraryEntry[],
    };
    if (data === undefined) return empty;
    const now = Date.now();
    const partition = groupUpNext(data.entries, now, thresholdMs);
    // trakt id → entry, to re-join each grouped item to its poster + action.
    const byId = new Map(data.entries.map((entry) => [entry.showId, entry]));
    const toCards = (items: readonly UpNextItem[]): UpNextCard[] => {
      const out: UpNextCard[] = [];
      for (const item of items) {
        const entry = byId.get(item.showId);
        if (entry !== undefined) out.push({ item, entry });
      }
      return out;
    };
    const sorted = sortQueue(partition.queue, order);
    return {
      queue: toCards(
        stabilizePendingAdvance(
          sorted,
          previousOrder.current,
          (showId) => byId.get(showId)?.pendingAdvance === true,
        ),
      ),
      lapsedCards: toCards(sortLapsed(partition.lapsed, lapsedOrder)),
      watchlistEntries: data.entries.filter((entry) => entry.inWatchlist && !entry.hidden),
    };
  }, [data, thresholdMs, order, lapsedOrder]);

  useEffect(() => {
    previousOrder.current = groups.queue.map((card) => card.entry.showId);
  }, [groups.queue]);

  const counts = useMemo<EmptyStateCounts>(() => {
    if (data === undefined) {
      return { totalCount: 0, trackedCount: 0, startedCount: 0, unresolvedCount: 0 };
    }
    const tracked = data.entries.filter((entry) => !entry.hidden);
    return {
      totalCount: data.entries.length,
      trackedCount: tracked.length,
      startedCount: tracked.filter((entry) => entry.completed > 0).length,
      unresolvedCount: tracked.filter(
        (entry) => entry.nextEpisode === null && entry.completed < entry.aired,
      ).length,
    };
  }, [data]);

  return {
    ...groups,
    ...counts,
    ...queryStatus(query, data !== undefined),
    refetch: () => void query.refetch(),
  };
}
