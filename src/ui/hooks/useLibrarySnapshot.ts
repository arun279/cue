import { queryKeys } from "@data/query-keys";
import type { LibraryEntry } from "@data/trakt/library";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { USER_STATE_STALE_TIME } from "@ui/hooks/query-freshness";
import { usePrefs } from "@ui/prefs/prefs-store";
import { thresholdMsFromDays } from "@ui/prefs/threshold";
import { type UpNextData, useRuntime } from "@ui/runtime/runtime";
import { useMemo } from "react";

export interface LibrarySnapshot {
  readonly query: UseQueryResult<UpNextData>;
  readonly data: UpNextData | undefined;
  /** trakt id → entry, for re-joining a domain selector's output to its poster/action. */
  readonly byId: ReadonlyMap<number, LibraryEntry>;
  /** The live staleness threshold (from usePrefs) the Watching/lapsed split reads. */
  readonly thresholdMs: number;
}

/**
 * The shared read for the home surfaces: the persisted-SWR `library` query Up Next
 * and My Shows both paint from, plus the live threshold and an id→entry index. One
 * source so both hooks stay in lock-step and neither re-fetches on navigation.
 */
export function useLibrarySnapshot(enabled = true): LibrarySnapshot {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: queryKeys.library(),
    queryFn: () => runtime.loadUpNext(),
    staleTime: USER_STATE_STALE_TIME,
    // A movies-only user has no TV surfaces, so the shared library read
    // stays idle rather than fetching a hidden medium's Up Next / bucket snapshot.
    enabled,
  });
  const thresholdDays = usePrefs((s) => s.thresholdDays);
  const data = query.data;
  const byId = useMemo(
    () => new Map((data?.entries ?? []).map((entry) => [entry.showId, entry])),
    [data],
  );
  return { query, data, byId, thresholdMs: thresholdMsFromDays(thresholdDays) };
}
