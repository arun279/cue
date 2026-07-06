import type { LibraryEntry } from "@data/trakt/library";
import { groupLibrary, type LibrarySort } from "@domain/library-buckets";
import type { WatchStatus } from "@domain/watch-status";
import { useLibrarySnapshot } from "@ui/hooks/useLibrarySnapshot";
import type { UpNextData } from "@ui/runtime/runtime";
import { useMemo } from "react";

interface LibraryBucketView {
  readonly status: WatchStatus;
  readonly entries: readonly LibraryEntry[];
}

export interface LibraryBucketsView {
  readonly buckets: readonly LibraryBucketView[];
  /** Non-hidden tracked shows — the count that decides an empty library (aligned with Up Next). */
  readonly trackedCount: number;
  /** Every tracked show, hidden included — 0 only when the library is truly empty. */
  readonly totalCount: number;
  readonly tmdbConfig: UpNextData["tmdbConfig"];
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  refetch(): void;
}

/**
 * My Shows read hook: the same persisted `library` snapshot Up Next paints from,
 * grouped into the piles via the pure `groupLibrary` selector against the
 * live staleness threshold. Reuses the shared cache so the screen paints instantly
 * on navigation with no extra fetch.
 */
export function useLibraryBuckets(sort: LibrarySort): LibraryBucketsView {
  const { query, data, byId, thresholdMs } = useLibrarySnapshot();

  const buckets = useMemo<LibraryBucketView[]>(() => {
    if (data === undefined) return [];
    const now = Date.now();
    return groupLibrary(data.entries, now, thresholdMs, sort).map((bucket) => ({
      status: bucket.status,
      entries: bucket.shows.flatMap((show) => {
        const entry = byId.get(show.showId);
        return entry === undefined ? [] : [entry];
      }),
    }));
  }, [data, byId, thresholdMs, sort]);

  return {
    buckets,
    trackedCount: data === undefined ? 0 : data.entries.filter((entry) => !entry.hidden).length,
    totalCount: data?.entries.length ?? 0,
    tmdbConfig: data?.tmdbConfig ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    hasData: data !== undefined,
    refetch: () => void query.refetch(),
  };
}
