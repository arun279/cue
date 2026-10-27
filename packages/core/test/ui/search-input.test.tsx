// @vitest-environment jsdom
import { type SearchInput, useSearchInput } from "@cue/core/hooks/useSearchInput";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The hook's own two windows, spelled here so a case fails if either moves. */
const DEBOUNCE_MS = 300;
const DWELL_MS = 1500;

/**
 * A query typed and then left alone long enough to count as a search. The two
 * windows are advanced separately because React commits the settled query
 * between them, and a single jump past both would fire the previous query's
 * dwell before its effect had been torn down.
 */
function rest(input: { readonly current: SearchInput }, query: string): void {
  act(() => input.current.setInput(query));
  act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
  act(() => vi.advanceTimersByTime(DWELL_MS));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSearchInput", () => {
  it("trims and settles an input after the debounce window", () => {
    const { result: input } = renderHook(useSearchInput);

    act(() => input.current.setInput("  harbor  "));
    expect(input.current.query).toBe("");
    expect(input.current.settling).toBe(true);

    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
    expect(input.current.query).toBe("harbor");
    expect(input.current.settling).toBe(false);
  });

  it("remembers the query the reader rests on, not the ones typed through it", () => {
    const { result: input } = renderHook(useSearchInput);

    act(() => input.current.setInput("h"));
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
    rest(input, "harbor");

    expect(input.current.recent).toEqual(["harbor"]);
  });

  it("forgets a query abandoned before it stands", () => {
    const { result: input } = renderHook(useSearchInput);

    act(() => input.current.setInput("harbor"));
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
    rest(input, "");

    expect(input.current.recent).toEqual([]);
  });

  it("keeps five queries in recency order, each of them once", () => {
    const { result: input } = renderHook(useSearchInput);

    for (const query of ["one", "two", "three", "four", "five", "six", "three"]) {
      rest(input, query);
    }

    expect(input.current.recent).toEqual(["three", "six", "five", "four", "two"]);
  });
});
