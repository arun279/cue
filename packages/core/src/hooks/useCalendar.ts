import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type CalendarDay, groupCalendar, sliceCalendarDays } from "../domain/calendar";
import { dayKeyOf } from "../domain/day";
import { DAY_MS, localTimeZone } from "../domain/time";
import { CALENDAR_WINDOW_DAYS, calendarQuery } from "../queries/calendar";
import { type QueryStatus, queryStatus } from "../queries/freshness";
import { useRuntime } from "../runtime/runtime";
import { useCoarseClock } from "./useCoarseClock";

/**
 * The Calendar screen's agenda depth and the ONE window the query ever
 * fetches. Every consumer shares this single cache entry (one GET per window,
 * whichever surface loads first); narrower views slice it client-side.
 */
/** The home "On the way" slice: one week of the shared read. */
const DEFAULT_CALENDAR_WINDOW = 7;

export interface CalendarView extends QueryStatus {
  readonly days: readonly CalendarDay[];
  /** The one frozen clock this render's grouping and relative labels derive
   * from, so a day header and its rows can never disagree about "today". */
  readonly now: number;
  refetch(): void;
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
  const now = useCoarseClock(DAY_MS);
  const startDate = dayKeyOf(localTimeZone(), now);
  const query = useQuery({
    ...calendarQuery(runtime, startDate),
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
    return sliceCalendarDays(grouped, startDate, windowDays, CALENDAR_WINDOW_DAYS);
  }, [data, now, startDate, windowDays]);

  return {
    days,
    now,
    ...queryStatus(query, data !== undefined),
    refetch: () => void query.refetch(),
  };
}
