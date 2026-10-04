// @vitest-environment jsdom
import { useCoarseClock } from "@cue/core/hooks/useCoarseClock";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { mount } from "./_mount";

afterEach(() => {
  vi.useRealTimers();
});

it("re-renders once per crossed boundary, not on every check", async () => {
  vi.useFakeTimers({ now: Date.parse("2026-07-12T10:30:00Z") });
  const seen: number[] = [];
  function Probe(): null {
    seen.push(useCoarseClock(60 * 60_000));
    return null;
  }
  mount(<Probe />);

  await act(() => vi.advanceTimersByTimeAsync(29 * 60_000));
  expect(new Set(seen).size).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect([...new Set(seen)].map((ms) => new Date(ms).toISOString())).toEqual([
    "2026-07-12T10:30:00.000Z",
    "2026-07-12T11:00:00.000Z",
  ]);
});
