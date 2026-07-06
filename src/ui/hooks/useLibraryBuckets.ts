import { queryKeys } from "@data/query-keys";
import type { LibraryEntry } from "@data/trakt/library";
import { groupLibrary, type LibrarySort } from "@domain/library-buckets";
import { DEFAULT_STALENESS_THRESHOLD_MS, type WatchStatus } from "@domain/watch-status";
import { useQuery } from "@tanstack/react-query";
import { type UpNextData, useRuntime } from "@ui/runtime/runtime";
import { useMemo } from "react";

interface LibraryBucketView {
  readonly status: WatchStatus;
  readonly entries: readonly LibraryEntry[];
}

export interface LibraryBucketsView {
  readonly buckets: readonly LibraryBucketView[];
  readonly trackedCount: number;
  readonly tmdbConfig: UpNextData["tmdbConfig"];
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  refetch(): void;
}

/**
 * My Shows read hook: the same persisted `library` query Up Next paints from,
 * grouped into the aired-based status buckets via the pure `groupLibrary`
 * selector. Reuses the Up Next cache so the library screen paints instantly on
 * navigation with no extra fetch.
 */
export function useLibraryBuckets(sort: LibrarySort): LibraryBucketsView {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.library(),
    queryFn: () => runtime.loadUpNext(),
  });

  const data = query.data;
  const buckets = useMemo<LibraryBucketView[]>(() => {
    if (data === undefined) return [];
    const byId = new Map(data.entries.map((entry) => [entry.showId, entry]));
    const now = Date.now();
    return groupLibrary(data.entries, now, DEFAULT_STALENESS_THRESHOLD_MS, sort).map((bucket) => ({
      status: bucket.status,
      entries: bucket.shows.flatMap((show) => {
        const entry = byId.get(show.showId);
        return entry === undefined ? [] : [entry];
      }),
    }));
  }, [data, sort]);

  return {
    buckets,
    trackedCount: data?.entries.length ?? 0,
    tmdbConfig: data?.tmdbConfig ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    hasData: data !== undefined,
    refetch: () => void query.refetch(),
  };
}
