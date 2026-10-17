import { type UseQueryResult, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { firstUnwatchedAired, type SeasonView, toEpisodeRef } from "../data/trakt/show-detail";
import { recentCalendarStart, selectVisibleEntries } from "../domain/calendar";
import { dayKeyOf } from "../domain/day";
import { needsNextEpisode, reconcileRecentlyAired } from "../domain/recently-aired";
import { DAY_MS, localTimeZone } from "../domain/time";
import { usePrefs } from "../prefs/prefs-store";
import { thresholdMsFromDays } from "../prefs/threshold";
import { recentlyAiredQuery } from "../queries/calendar";
import { libraryQuery } from "../queries/library";
import { showSeasonsQuery } from "../queries/shows";
import { type UpNextData, useRuntime } from "../runtime/runtime";
import { useCoarseClock } from "./useCoarseClock";

export interface LibrarySnapshot {
  readonly query: UseQueryResult<UpNextData>;
  readonly data: UpNextData | undefined;
  readonly thresholdMs: number;
}

function combineSeasonTrees(
  results: readonly UseQueryResult<readonly SeasonView[]>[],
): readonly (readonly SeasonView[] | undefined)[] {
  return results.map((result) => result.data);
}

export function useLibrarySnapshot(enabled = true): LibrarySnapshot {
  const runtime = useRuntime();
  const query = useQuery({
    ...libraryQuery(runtime),
    enabled,
  });
  const thresholdDays = usePrefs((s) => s.thresholdDays);
  const now = useCoarseClock(DAY_MS);
  const recentStart = recentCalendarStart(dayKeyOf(localTimeZone(), now));
  const recentQuery = useQuery({ ...recentlyAiredQuery(runtime, recentStart), enabled });
  const recent = useMemo(
    () => (recentQuery.data === undefined ? undefined : selectVisibleEntries(recentQuery.data)),
    [recentQuery.data],
  );
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
