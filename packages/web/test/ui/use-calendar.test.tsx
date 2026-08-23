/**
 * The calendar cache-key unification: every `useCalendar` consumer keys the
 * SAME full-window query (one GET serves home's 72h "On the way" slice and the
 * 28-day Calendar screen), and narrower callers get a client-side day slice.
 */
import type { CalendarEntry } from "@cue/core/domain/calendar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CALENDAR_WINDOW_DAYS,
  recentCalendarStart,
  sliceCalendarDays,
  useCalendar,
} from "@ui/hooks/useCalendar";
import { type CueRuntime, RuntimeProvider } from "@ui/runtime/runtime";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Tomorrow + `days - 1` further out, so both land inside any window ≥ 1 day. */
function entriesAt(...dayOffsets: readonly number[]): CalendarEntry[] {
  return dayOffsets.map((offset, index) => ({
    showId: index + 1,
    showTitle: `Show ${index + 1}`,
    season: 1,
    number: index + 1,
    episodeTitle: null,
    firstAired: new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString(),
    ids: { trakt: index + 1 },
    posters: [],
    network: null,
    tmdbId: null,
  }));
}

function Probe({
  windowDays,
  onDays,
}: {
  readonly windowDays: number;
  readonly onDays: (count: number) => void;
}): null {
  const view = useCalendar(windowDays);
  onDays(view.days.length);
  return null;
}

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

async function mount(node: ReactElement): Promise<void> {
  root = createRoot(document.createElement("div"));
  // Two passes: mount, then let the query resolve and notify its subscribers
  // (react-query's notifyManager batches on a macrotask, not a microtask).
  await act(async () => root?.render(node));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe("useCalendar", () => {
  it("keys one full-window query for every caller and slices narrower views", async () => {
    const loadCalendar = vi.fn((_start: string, _days: number) =>
      Promise.resolve({ entries: entriesAt(1, 10), hiddenShowIds: [] }),
    );
    const runtime = { loadCalendar } as unknown as CueRuntime;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const dayCounts = { home: 0, calendar: 0 };

    await mount(
      <QueryClientProvider client={queryClient}>
        <RuntimeProvider value={runtime}>
          <Probe windowDays={7} onDays={(count) => (dayCounts.home = count)} />
          <Probe
            windowDays={CALENDAR_WINDOW_DAYS}
            onDays={(count) => (dayCounts.calendar = count)}
          />
        </RuntimeProvider>
      </QueryClientProvider>,
    );

    // ONE fetch, for the full window, shared by both consumers.
    expect(loadCalendar).toHaveBeenCalledTimes(1);
    expect(loadCalendar.mock.calls[0]?.[1]).toBe(CALENDAR_WINDOW_DAYS);
    // The +10d episode is outside the 7-day slice but inside the full window.
    expect(dayCounts.home).toBe(1);
    expect(dayCounts.calendar).toBe(2);
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
