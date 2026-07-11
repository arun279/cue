import type { LibraryEntry } from "@data/trakt/library";
import { groupUpNext, type UpNextItem } from "@domain/up-next";
import { DEFAULT_NEW_EPISODE_WINDOW_MS } from "@domain/watch-status";
import { type QueryStatus, queryStatus } from "@ui/hooks/query-freshness";
import { useLibrarySnapshot } from "@ui/hooks/useLibrarySnapshot";
import { useMemo } from "react";

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
  /** New ⧺ Continue in render order: the flat active queue (drives the Up Next count). */
  readonly cards: readonly UpNextCard[];
  /** This week's freshly-aired next episodes ("New"). */
  readonly newCards: readonly UpNextCard[];
  /** Mid-run shows, most-recently-watched first ("Continue"). */
  readonly continueCards: readonly UpNextCard[];
  /** In-progress but idle: the collapsed "Haven't watched in a while" drawer. */
  readonly lapsedCards: readonly UpNextCard[];
  /** Every tracked show, hidden included: 0 only when the library is truly empty. */
  readonly totalCount: number;
  /** Every non-hidden tracked show: distinguishes an only-Stopped library from a real one. */
  readonly trackedCount: number;
  /** Non-hidden shows with watch progress: 0 means nothing has been started yet. */
  readonly startedCount: number;
  /** The library exceeds the cold-sync progress budget, so only recent shows are
   * fully synced: the pill's honest "recent shows synced" state. */
  readonly isPartial: boolean;
  refetch(): void;
}

/**
 * The Up Next read hook: the persisted-SWR `library` snapshot (instant paint from
 * the restored cache, background revalidate) run through the pure `groupUpNext`
 * partition, each item re-joined to its `LibraryEntry` for poster + action. Exposes
 * the New / Continue / lapsed-drawer groups plus a flat `cards` (New ⧺ Continue).
 */
export function useUpNext(): UpNextView {
  const { query, data, byId, thresholdMs } = useLibrarySnapshot();

  const groups = useMemo(() => {
    const empty = {
      newCards: [] as UpNextCard[],
      continueCards: [] as UpNextCard[],
      lapsedCards: [] as UpNextCard[],
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
    return {
      newCards: toCards(partition.fresh),
      continueCards: toCards(partition.continued),
      lapsedCards: toCards(partition.lapsed),
    };
  }, [data, byId, thresholdMs]);

  const cards = useMemo(() => [...groups.newCards, ...groups.continueCards], [groups]);

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
    cards,
    newCards: groups.newCards,
    continueCards: groups.continueCards,
    lapsedCards: groups.lapsedCards,
    totalCount: counts.totalCount,
    trackedCount: counts.trackedCount,
    startedCount: counts.startedCount,
    isPartial: data?.isPartial ?? false,
    ...queryStatus(query, data !== undefined),
    refetch: () => void query.refetch(),
  };
}
