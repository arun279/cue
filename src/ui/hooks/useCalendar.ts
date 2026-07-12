import { queryKeys } from "@data/query-keys";
import { type CalendarDay, groupCalendar } from "@domain/calendar";
import { localTimeZone } from "@domain/time";
import { useQuery } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS, type QueryStatus, queryStatus } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";
import { useEffect, useMemo, useState } from "react";

/** The home "On the way" slice reads one week; the Calendar screen widens it. */
const DEFAULT_CALENDAR_WINDOW = 7;

/** How often the day clock re-checks whether the local day has flipped. */
const DAY_CHECK_MS = 60_000;

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
 * The forward-calendar read hook. Fetches the personalized window
 * (`windowDays` wide, anchored on the local today) and groups episodes by local
 * day through the pure domain `groupCalendar` (hidden shows excluded, aired
 * rows flagged). Read-only: the calendar renders no marks — aired episodes are
 * marked from the Up Next queue, one home per action.
 */
export function useCalendar(windowDays: number = DEFAULT_CALENDAR_WINDOW): CalendarView {
  const runtime = useRuntime();
  const now = useDayClock();
  const startDate = localDayKey(now);
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
      now,
      timeZone: localTimeZone(),
      hiddenShowIds: new Set(data.hiddenShowIds),
    });
  }, [data, now]);

  return {
    days,
    now,
    ...queryStatus(query, data !== undefined),
    refetch: () => void query.refetch(),
  };
}
