import { queryKeys } from "@data/query-keys";
import type { LibraryEntry } from "@data/trakt/library";
import { queryOptions, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { USER_STATE_STALE_TIME } from "@ui/hooks/query-freshness";
import { usePrefs } from "@ui/prefs/prefs-store";
import { thresholdMsFromDays } from "@ui/prefs/threshold";
import { type CueRuntime, type UpNextData, useRuntime } from "@ui/runtime/runtime";

export interface LibrarySnapshot {
  readonly query: UseQueryResult<UpNextData>;
  readonly data: UpNextData | undefined;
  /** The live staleness threshold (from usePrefs) the Watching/lapsed split reads. */
  readonly thresholdMs: number;
}

const libraryQuery = (runtime: CueRuntime) =>
  queryOptions({
    queryKey: queryKeys.library(),
    queryFn: () => runtime.loadUpNext(),
    staleTime: USER_STATE_STALE_TIME,
  });

/**
 * One show's entry off the same snapshot, narrowed with `select` so a detail
 * screen re-renders when THAT show changes rather than on every library update.
 * Same cache, same query, no extra fetch.
 */
export function useLibraryEntry(showId: number): LibraryEntry | undefined {
  const runtime = useRuntime();
  return useQuery({
    ...libraryQuery(runtime),
    select: (data) => data.entries.find((entry) => entry.showId === showId),
  }).data;
}

/**
 * The shared read for the home surfaces: the persisted-SWR `library` query Up Next
 * and Library both paint from, plus the live threshold. One source so both hooks
 * stay in lock-step and neither re-fetches on navigation.
 */
export function useLibrarySnapshot(enabled = true): LibrarySnapshot {
  const runtime = useRuntime();
  const query = useQuery({
    ...libraryQuery(runtime),
    // A movies-only user has no TV surfaces, so the shared library read
    // stays idle rather than fetching a hidden medium's Up Next / bucket snapshot.
    enabled,
  });
  const thresholdDays = usePrefs((s) => s.thresholdDays);
  return { query, data: query.data, thresholdMs: thresholdMsFromDays(thresholdDays) };
}
