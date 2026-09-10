import { type UseQueryResult, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { firstUnwatchedAired, type SeasonView, toEpisodeRef } from "../data/trakt/show-detail";
import { needsNextEpisode, reconcileRecentlyAired } from "../domain/recently-aired";
import { usePrefs } from "../prefs/prefs-store";
import { thresholdMsFromDays } from "../prefs/threshold";
import { libraryQuery } from "../queries/library";
import { showSeasonsQuery } from "../queries/shows";
import { type UpNextData, useRuntime } from "../runtime/runtime";
import { useRecentlyAired } from "./useRecentlyAired";

export interface LibrarySnapshot {
  readonly query: UseQueryResult<UpNextData>;
  readonly data: UpNextData | undefined;
  /** The live staleness threshold (from usePrefs) the Watching/lapsed split reads. */
  readonly thresholdMs: number;
}

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
    queries: unresolved.map((showId) => ({ ...showSeasonsQuery(runtime, showId), enabled })),
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
