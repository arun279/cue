import { queryKeys } from "@data/query-keys";
import type { LibraryEntry } from "@data/trakt/library";
import { selectUpNext, type UpNextItem, type UpNextSort } from "@domain/up-next";
import { useQuery } from "@tanstack/react-query";
import { type UpNextData, useRuntime } from "@ui/runtime/runtime";
import { useMemo } from "react";

export interface UpNextCard {
  readonly item: UpNextItem;
  readonly entry: LibraryEntry;
}

export interface UpNextView {
  readonly cards: readonly UpNextCard[];
  /** Every non-hidden tracked show — distinguishes "all caught up" from "nothing tracked". */
  readonly trackedCount: number;
  readonly tmdbConfig: UpNextData["tmdbConfig"];
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  /** Cached data is showing despite a failed refetch — the cached-retry affordance state. */
  readonly hasData: boolean;
  /** Epoch ms of the last successful library sync (drives the pill's recency). */
  readonly syncedAt: number;
  refetch(): void;
}

/**
 * The Up Next read hook: the persisted-SWR `library` query (instant paint from
 * the restored cache, background revalidate) run through the pure
 * `selectUpNext` filter, re-joined to its `LibraryEntry` for poster + action.
 */
export function useUpNext(sort: UpNextSort = "recently-watched"): UpNextView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.library(),
    queryFn: () => runtime.loadUpNext(),
  });

  const data = query.data;
  const cards = useMemo<UpNextCard[]>(() => {
    if (data === undefined) return [];
    const byId = new Map(data.entries.map((entry) => [entry.showId, entry]));
    const now = Date.now();
    const out: UpNextCard[] = [];
    for (const item of selectUpNext(data.entries, now, sort)) {
      const entry = byId.get(item.showId);
      if (entry !== undefined) out.push({ item, entry });
    }
    return out;
  }, [data, sort]);

  const trackedCount = useMemo(
    () => (data === undefined ? 0 : data.entries.filter((entry) => !entry.hidden).length),
    [data],
  );

  return {
    cards,
    trackedCount,
    tmdbConfig: data?.tmdbConfig ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    hasData: data !== undefined,
    syncedAt: query.dataUpdatedAt,
    refetch: () => void query.refetch(),
  };
}
