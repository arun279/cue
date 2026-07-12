import { queryKeys } from "@data/query-keys";
import { type CalendarDay, groupCalendar } from "@domain/calendar";
import { localTimeZone } from "@domain/time";
import { useQuery } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS, type QueryStatus, queryStatus } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";
import { useEffect, useMemo, useState } from "react";

/**
 * The Calendar screen's agenda depth and the ONE window the query ever
 * fetches. Every consumer shares this single cache entry (one GET per window,
 * whichever surface loads first); narrower views slice it client-side.
 */
export const CALENDAR_WINDOW_DAYS = 28;

/** The home "On the way" slice: one week of the shared read. */
const DEFAULT_CALENDAR_WINDOW = 7;

/** How often the day clock re-checks whether the local day has flipped. */
const DAY_CHECK_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The shared 28-day read cut to a caller's narrower window ("YYYY-MM-DD"
 * day keys are pure dates, so key arithmetic is DST-safe). */
export function sliceCalendarDays(
  days: readonly CalendarDay[],
  startKey: string,
  windowDays: number,
): readonly CalendarDay[] {
  if (windowDays >= CALENDAR_WINDOW_DAYS) return days;
  const limit = Date.parse(startKey) + windowDays * DAY_MS;
  return days.filter((day) => Date.parse(day.dayKey) < limit);
}

export interface CalendarView extends QueryStatus {
  readonly days: readonly CalendarDay[];
  /** The one frozen clock this render's grouping and relative labels derive
   * from, so a day header and its rows can never disagree about "today". */
  readonly now: number;
  refetch(): void;
}

/** `ms → "YYYY-MM-DD"` in the viewer's local tz: the window anchor + day handle. */
function localDayKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: localTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}

/**
 * A clock frozen per render pass, re-stamped only when the local calendar day
 * changes: a session left open across midnight re-anchors the window and its
 * Today/Tomorrow labels instead of drifting a day behind.
 */
function useDayClock(): number {
  const [now, setNow] = useState(() => Date.now());
  const dayKey = localDayKey(now);
  useEffect(() => {
    const timer = setInterval(() => {
      if (localDayKey(Date.now()) !== dayKey) setNow(Date.now());
    }, DAY_CHECK_MS);
    return () => clearInterval(timer);
  }, [dayKey]);
  return now;
}

/**
 * The forward-calendar read hook. Fetches the full shared window (always
 * `CALENDAR_WINDOW_DAYS`, anchored on the local today. One cache key means the
 * home slice and the Calendar screen never each fire their own GET), groups
 * episodes by local day through the pure domain `groupCalendar` (hidden shows
 * excluded, aired rows flagged), and returns the caller's `windowDays` slice.
 * Read-only: the calendar renders no marks. Aired episodes are marked from
 * the Up Next queue, one home per action.
 */
export function useCalendar(windowDays: number = DEFAULT_CALENDAR_WINDOW): CalendarView {
  const runtime = useRuntime();
  const now = useDayClock();
  const startDate = localDayKey(now);
  const query = useQuery({
    queryKey: queryKeys.calendar(startDate, CALENDAR_WINDOW_DAYS),
    queryFn: () => runtime.loadCalendar(startDate, CALENDAR_WINDOW_DAYS),
    // Time/content-driven, NOT gated on last_activities: newly-announced or
    // newly-aired future episodes don't always bump user activity.
    staleTime: CONTENT_STALE_TIME_MS,
  });

  const data = query.data;
  const days = useMemo<readonly CalendarDay[]>(() => {
    if (data === undefined) return [];
    const grouped = groupCalendar(data.entries, {
      now,
      timeZone: localTimeZone(),
      hiddenShowIds: new Set(data.hiddenShowIds),
    });
    return sliceCalendarDays(grouped, startDate, windowDays);
  }, [data, now, startDate, windowDays]);

  return {
    days,
    now,
    ...queryStatus(query, data !== undefined),
    refetch: () => void query.refetch(),
  };
}
