import { queryKeys } from "@cue/core/data/query-keys";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import {
  firstUnwatchedAired,
  type SeasonView,
  toEpisodeRef,
} from "@cue/core/data/trakt/show-detail";
import { needsNextEpisode, reconcileRecentlyAired } from "@cue/core/domain/recently-aired";
import { queryOptions, type UseQueryResult, useQueries, useQuery } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS, USER_STATE_STALE_TIME } from "@ui/hooks/query-freshness";
import { useRecentlyAired } from "@ui/hooks/useCalendar";
import { usePrefs } from "@ui/prefs/prefs-store";
import { thresholdMsFromDays } from "@ui/prefs/threshold";
import { type CueRuntime, type UpNextData, useRuntime } from "@ui/runtime/runtime";
import { useMemo } from "react";

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

function combineSeasonTrees(
  results: readonly UseQueryResult<readonly SeasonView[]>[],
): readonly (readonly SeasonView[] | undefined)[] {
  return results.map((result) => result.data);
}

/**
 * The shared read for the home surfaces: the persisted library snapshot reconciled
 * with the recent calendar, with each flagged show's queue position read from its
 * season tree. It also provides the live threshold.
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
  const recent = useRecentlyAired(enabled);
  const reconciled = useMemo(() => {
    const now = Date.now();
    if (query.data === undefined || recent === undefined) return { now, data: query.data };
    return {
      now,
      data: {
        ...query.data,
        entries: reconcileRecentlyAired(query.data.entries, recent, now),
      },
    };
  }, [query.data, recent]);
  const unresolved = useMemo(() => {
    if (query.data === undefined || reconciled.data === undefined) return [];
    // An unrelated gap in Trakt's own progress has the same shape and must not trigger a tree read.
    return reconciled.data.entries.flatMap((entry, index) =>
      entry !== query.data.entries[index] && needsNextEpisode(entry, reconciled.now)
        ? [entry.showId]
        : [],
    );
  }, [query.data, reconciled]);
  const trees = useQueries({
    queries: unresolved.map((showId) => ({
      queryKey: queryKeys.showSeasons(showId),
      queryFn: () => runtime.loadShowSeasons(showId),
      staleTime: CONTENT_STALE_TIME_MS,
      enabled,
    })),
    combine: combineSeasonTrees,
  });
  const data = useMemo(() => {
    if (reconciled.data === undefined) return undefined;
    const treesByShow = new Map(unresolved.map((showId, index) => [showId, trees[index]]));
    return {
      ...reconciled.data,
      entries: reconciled.data.entries.map((entry) => {
        const tree = treesByShow.get(entry.showId);
        if (tree === undefined) return entry;
        const next = firstUnwatchedAired(tree);
        return {
          ...entry,
          nextEpisode: next === null ? null : toEpisodeRef(next),
          aired: tree.reduce(
            (count, season) =>
              count + (season.isSpecial || season.isHidden ? 0 : season.airedCount),
            0,
          ),
        };
      }),
    };
  }, [reconciled, trees, unresolved]);
  return { query, data, thresholdMs: thresholdMsFromDays(thresholdDays) };
}

/** The entry comes off the reconciled snapshot because `select` cannot see calendar or season queries. */
export function useLibraryEntry(showId: number): LibraryEntry | undefined {
  const { data } = useLibrarySnapshot();
  return useMemo(() => data?.entries.find((entry) => entry.showId === showId), [data, showId]);
}
