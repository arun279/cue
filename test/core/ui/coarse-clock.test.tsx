// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCoarseClock } from "@/core/hooks/useCoarseClock";

afterEach(() => {
  vi.useRealTimers();
});

/** The distinct values the clock rendered, before and after the minute that crosses `boundary`. */
async function ticksAround(
  start: string,
  minutesToBoundary: number,
  granularityMs: number,
  timeZone?: string,
): Promise<{ before: number; after: string[] }> {
  vi.useFakeTimers({ now: Date.parse(start) });
  const seen: number[] = [];
  renderHook(() => seen.push(useCoarseClock(granularityMs, timeZone)));
  await act(() => vi.advanceTimersByTimeAsync((minutesToBoundary - 1) * 60_000));
  const before = new Set(seen).size;
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  return { before, after: [...new Set(seen)].map((ms) => new Date(ms).toISOString()) };
}

it("re-renders once per crossed boundary, not on every check", async () => {
  expect(await ticksAround("2026-07-12T10:30:00Z", 30, 60 * 60_000, "UTC")).toEqual({
    before: 1,
    after: ["2026-07-12T10:30:00.000Z", "2026-07-12T11:00:00.000Z"],
  });
});

it("ticks a day clock at local midnight in a zone west of UTC", async () => {
  // 11:30 pm on 20 October in US Central, which is 04:30 UTC on the 21st.
  expect(
    await ticksAround("2026-10-21T04:30:00Z", 30, 24 * 60 * 60_000, "America/Chicago"),
  ).toEqual({ before: 1, after: ["2026-10-21T04:30:00.000Z", "2026-10-21T05:00:00.000Z"] });
});
