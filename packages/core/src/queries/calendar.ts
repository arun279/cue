import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import { CALENDAR_WINDOW_DAYS, RECENT_CALENDAR_WINDOW_DAYS } from "../domain/calendar";
import type { CueRuntime } from "../runtime/runtime";
import { CONTENT_STALE_TIME_MS } from "./freshness";

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
