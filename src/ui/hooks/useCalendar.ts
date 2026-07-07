import type { TmdbImageConfig } from "@data/image-source";
import { showProgressKeys } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import {
  CALENDAR_TIME_ZONE,
  type CalendarDay,
  type CalendarRow,
  groupCalendar,
} from "@domain/calendar";
import { buildMarkEpisodeOp } from "@domain/write-queue/ops";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useMemo, useState } from "react";
import { useQueuedWrite } from "./useQueuedWrite";

/** Window options: a one-week default, widened to a fortnight. */
export const CALENDAR_WINDOWS = [7, 14] as const;
const DEFAULT_CALENDAR_WINDOW = 7;

export interface CalendarView {
  readonly days: readonly CalendarDay[];
  readonly windowDays: number;
  setWindowDays(days: number): void;
  readonly tmdbConfig: TmdbImageConfig | null;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasData: boolean;
  refetch(): void;
  isWatched(episodeId: number): boolean;
  markWatched(row: CalendarRow): Promise<void>;
  readonly markError: string | null;
  clearMarkError(): void;
}

/** `Date → "YYYY-MM-DD"` in the fixed calendar tz, the `{start}` of the window request. */
function startDateOf(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The Upcoming/Calendar read hook. Fetches the personalized window
 * (widening refetches on a new `days` key), groups episodes by local day through
 * the pure domain `groupCalendar` (hidden shows excluded, aired rows flagged),
 * and exposes an optimistic quick mark-watched that rides the write-queue path.
 */
export function useCalendar(): CalendarView {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [windowDays, setWindowDays] = useState<number>(DEFAULT_CALENDAR_WINDOW);
  const [watched, setWatched] = useState<ReadonlySet<number>>(() => new Set());
  const write = useQueuedWrite();

  // TODO(calendar-now): the window anchor + grouping freeze "now" at mount, so a
  // session left open across the fixed-tz midnight can mislabel days and gate
  // mark-watched until an unrelated refetch. Refresh on the next day boundary.
  const startDate = useMemo(() => startDateOf(Date.now()), []);
  const query = useQuery({
    queryKey: queryKeys.calendar(startDate, windowDays),
    queryFn: () => runtime.loadCalendar(startDate, windowDays),
    // Time/content-driven, NOT gated on last_activities: newly-announced or
    // newly-aired future episodes don't always bump user activity.
    staleTime: CONTENT_STALE_TIME_MS,
  });

  const data = query.data;
  const days = useMemo<CalendarDay[]>(() => {
    if (data === undefined) return [];
    return groupCalendar(data.entries, {
      now: Date.now(),
      timeZone: CALENDAR_TIME_ZONE,
      hiddenShowIds: new Set(data.hiddenShowIds),
    });
  }, [data]);

  const markWatched = useCallback(
    async (row: CalendarRow) => {
      const episodeId = row.ids.trakt;
      if (watched.has(episodeId)) return;
      setWatched((prev) => new Set(prev).add(episodeId));
      const op = buildMarkEpisodeOp({
        opId: crypto.randomUUID(),
        ids: row.ids,
        watchedAt: new Date().toISOString(),
        // No progress is loaded on this surface; anchor on 0 like the episode-detail
        // toggle does — a lost-response reconcile then retires on any fresh play.
        inversePatch: { showId: row.showId, preCompleted: 0 },
      });
      await write.run(
        op,
        () =>
          setWatched((prev) => {
            const next = new Set(prev);
            next.delete(episodeId);
            return next;
          }),
        `Couldn't mark ${row.showTitle} watched. Please try again.`,
        // A quick mark here is a watched-progress write like any other: refresh the
        // calendar window (this episode leaves the "unwatched aired" set) AND the
        // marked show's detail views via `showProgressKeys`, else the show-detail
        // header/seasons/episode read pre-mark progress until an unrelated remote
        // change — the same stale-cache defect the Up Next mark had.
        () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.calendarPrefix() });
          for (const queryKey of showProgressKeys(row.showId, {
            season: row.season,
            number: row.number,
          })) {
            void queryClient.invalidateQueries({ queryKey });
          }
        },
      );
    },
    [watched, write, queryClient],
  );

  return {
    days,
    windowDays,
    setWindowDays,
    tmdbConfig: data?.tmdbConfig ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    hasData: data !== undefined,
    refetch: () => void query.refetch(),
    isWatched: (episodeId) => watched.has(episodeId),
    markWatched,
    markError: write.error,
    clearMarkError: write.clearError,
  };
}
