// @vitest-environment jsdom
/**
 * The calendar cache-key unification: every calendar consumer keys the
 * SAME full-window query (one GET serves home's 72h "On the way" slice and the
 * 28-day Calendar screen), and narrower callers get a client-side day slice.
 */

import { QueryClient, useQuery } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  buildCalendarDays,
  CALENDAR_WINDOW_DAYS,
  type CalendarEntry,
  recentCalendarStart,
  sliceCalendarDays,
} from "@/core/domain/calendar";
import { dayKeyOf } from "@/core/domain/day";
import { DAY_MS, localTimeZone } from "@/core/domain/time";
import { useCoarseClock } from "@/core/hooks/useCoarseClock";
import { calendarQuery } from "@/core/queries/calendar";
import { useRuntime } from "@/core/runtime/runtime";
import { partialRuntime, withRuntime } from "../support/runtime";

/** Tomorrow + `days - 1` further out, so both land inside any window ≥ 1 day. */
function entriesAt(...dayOffsets: readonly number[]): CalendarEntry[] {
  return dayOffsets.map((offset, index) => ({
    showId: index + 1,
    showTitle: `Show ${index + 1}`,
    season: 1,
    number: index + 1,
    episodeTitle: null,
    episodeType: null,
    firstAired: new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString(),
    ids: { trakt: index + 1 },
    posters: [],
    network: null,
    tmdbId: null,
  }));
}

function useDayCount(windowDays: number): number {
  const runtime = useRuntime();
  const now = useCoarseClock(DAY_MS);
  const timeZone = localTimeZone();
  const startDate = dayKeyOf(timeZone, now);
  const query = useQuery({
    ...calendarQuery(runtime, startDate),
    select: ({ entries }) =>
      buildCalendarDays(
        { entries, hiddenShowIds: new Set() },
        now,
        timeZone,
        startDate,
        windowDays,
      ),
  });
  return query.data?.length ?? 0;
}

describe("calendarQuery consumers", () => {
  it("keys one full-window query for every caller and slices narrower views", async () => {
    const loadCalendar = vi.fn((_start: string, _days: number) =>
      Promise.resolve({ entries: entriesAt(1, 10) }),
    );
    const runtime = partialRuntime({ loadCalendar });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = withRuntime(runtime, queryClient);

    const home = renderHook(() => useDayCount(7), { wrapper }).result;
    const calendar = renderHook(() => useDayCount(CALENDAR_WINDOW_DAYS), { wrapper }).result;
    await act(async () => {});
    // core leaves react-query's default scheduler in place, which notifies on a macrotask.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    // ONE fetch, for the full window, shared by both consumers.
    expect(loadCalendar).toHaveBeenCalledTimes(1);
    expect(loadCalendar.mock.calls[0]?.[1]).toBe(CALENDAR_WINDOW_DAYS);
    // The +10d episode is outside the 7-day slice but inside the full window.
    expect(home.current).toBe(1);
    expect(calendar.current).toBe(2);
  });
});

describe("sliceCalendarDays", () => {
  const day = (dayKey: string) => ({ dayKey, label: dayKey, rows: [] });

  it("keeps only days inside the caller's window, counted from the start key", () => {
    const days = [day("2026-07-12"), day("2026-07-18"), day("2026-07-19"), day("2026-08-01")];
    expect(sliceCalendarDays(days, "2026-07-12", 7).map((d) => d.dayKey)).toEqual([
      "2026-07-12",
      "2026-07-18",
    ]);
  });

  it("returns the full grouping untouched at (or past) the full window", () => {
    const days = [day("2026-07-12"), day("2026-08-01")];
    expect(sliceCalendarDays(days, "2026-07-12", CALENDAR_WINDOW_DAYS)).toBe(days);
  });
});

describe("recentCalendarStart", () => {
  it("subtracts calendar days across a daylight-saving transition", () => {
    expect(recentCalendarStart("2026-03-20")).toBe("2026-02-16");
  });
});
