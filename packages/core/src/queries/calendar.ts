import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { CalendarData, CueRuntime } from "../runtime/runtime";
import { CONTENT_STALE_TIME_MS } from "./freshness";

export const CALENDAR_WINDOW_DAYS = 28;
const RECENT_CALENDAR_WINDOW_DAYS = 33;

export const selectVisibleEntries = (data: CalendarData) => {
  const hidden = new Set(data.hiddenShowIds);
  return data.entries.filter((entry) => !hidden.has(entry.showId));
};

export const calendarQuery = (runtime: CueRuntime, startDate: string) =>
  queryOptions({
    queryKey: queryKeys.calendar(startDate, CALENDAR_WINDOW_DAYS),
    queryFn: () => runtime.loadCalendar(startDate, CALENDAR_WINDOW_DAYS),
    staleTime: CONTENT_STALE_TIME_MS,
  });

export const recentlyAiredQuery = (runtime: CueRuntime, startDate: string) =>
  queryOptions({
    queryKey: queryKeys.calendar(startDate, RECENT_CALENDAR_WINDOW_DAYS),
    queryFn: () => runtime.loadCalendar(startDate, RECENT_CALENDAR_WINDOW_DAYS),
    staleTime: CONTENT_STALE_TIME_MS,
  });
