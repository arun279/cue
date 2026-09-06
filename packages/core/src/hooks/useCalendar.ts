import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { queryKeys } from "../data/query-keys";
import { type CalendarDay, type CalendarEntry, groupCalendar } from "../domain/calendar";
import { localTimeZone } from "../domain/time";
import { useRuntime } from "../runtime/runtime";
import { CONTENT_STALE_TIME_MS, type QueryStatus, queryStatus } from "./query-freshness";

/**
 * The Calendar screen's agenda depth and the ONE window the query ever
 * fetches. Every consumer shares this single cache entry (one GET per window,
 * whichever surface loads first); narrower views slice it client-side.
 */
export const CALENDAR_WINDOW_DAYS = 28;

/** The home "On the way" slice: one week of the shared read. */
const DEFAULT_CALENDAR_WINDOW = 7;

/** Trakt caps one calendar read at 33 days (docs.trakt.tv, About Calendars). */
const RECENT_WINDOW_DAYS = 33;

/** How often the day clock re-checks whether the local day has flipped. */
const DAY_CHECK_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function recentCalendarStart(dayKey: string): string {
  return new Date(Date.parse(dayKey) - (RECENT_WINDOW_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

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
 * The recent-airings read: the trailing 33-day window ending today, on the same
 * content cadence as the forward calendar. It is what the library selector
 * reconciles cached per-show progress against, since Trakt only refreshes that
 * progress when the user writes history for the show. Undefined until loaded;
 * a failed read leaves the library exactly as its own read produced it.
 */
export function useRecentlyAired(enabled = true): readonly CalendarEntry[] | undefined {
  const runtime = useRuntime();
  const now = useDayClock();
  const startDate = recentCalendarStart(localDayKey(now));
  const query = useQuery({
    queryKey: queryKeys.calendar(startDate, RECENT_WINDOW_DAYS),
    queryFn: () => runtime.loadCalendar(startDate, RECENT_WINDOW_DAYS),
    staleTime: CONTENT_STALE_TIME_MS,
    enabled,
  });
  const data = query.data;
  return useMemo(() => {
    if (data === undefined) return undefined;
    const hidden = new Set(data.hiddenShowIds);
    return data.entries.filter((entry) => !hidden.has(entry.showId));
  }, [data]);
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
export function useCalendar(
  windowDays: number = DEFAULT_CALENDAR_WINDOW,
  enabled = true,
): CalendarView {
  const runtime = useRuntime();
  const now = useDayClock();
  const startDate = localDayKey(now);
  const query = useQuery({
    queryKey: queryKeys.calendar(startDate, CALENDAR_WINDOW_DAYS),
    queryFn: () => runtime.loadCalendar(startDate, CALENDAR_WINDOW_DAYS),
    // Time/content-driven, NOT gated on last_activities: newly-announced or
    // newly-aired future episodes don't always bump user activity.
    staleTime: CONTENT_STALE_TIME_MS,
    // A background consumer (episode reminders) reads the same shared window
    // without paying a GET for it: disabled, it still sees whatever a visible
    // surface already loaded.
    enabled,
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
