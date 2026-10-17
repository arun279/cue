// @vitest-environment jsdom
import { type SearchInput, useSearchInput } from "@cue/core/hooks/useSearchInput";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "./_mount";

/** The hook's own two windows, spelled here so a case fails if either moves. */
const DEBOUNCE_MS = 300;
const DWELL_MS = 1500;

function Probe({ slot }: { readonly slot: SearchInput[] }): null {
  slot[0] = useSearchInput();
  return null;
}

/**
 * A query typed and then left alone long enough to count as a search. The two
 * windows are advanced separately because React commits the settled query
 * between them, and a single jump past both would fire the previous query's
 * dwell before its effect had been torn down.
 */
function rest(slot: SearchInput[], query: string): void {
  act(() => slot[0]?.setInput(query));
  act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
  act(() => vi.advanceTimersByTime(DWELL_MS));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSearchInput", () => {
  it("trims and settles an input after the debounce window", () => {
    const slot: SearchInput[] = [];
    mount(<Probe slot={slot} />);

    act(() => slot[0]?.setInput("  harbor  "));
    expect(slot[0]?.query).toBe("");
    expect(slot[0]?.settling).toBe(true);

    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
    expect(slot[0]?.query).toBe("harbor");
    expect(slot[0]?.settling).toBe(false);
  });

  it("remembers the query the reader rests on, not the ones typed through it", () => {
    const slot: SearchInput[] = [];
    mount(<Probe slot={slot} />);

    act(() => slot[0]?.setInput("h"));
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
    rest(slot, "harbor");

    expect(slot[0]?.recent).toEqual(["harbor"]);
  });

  it("forgets a query abandoned before it stands", () => {
    const slot: SearchInput[] = [];
    mount(<Probe slot={slot} />);

    act(() => slot[0]?.setInput("harbor"));
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));
    rest(slot, "");

    expect(slot[0]?.recent).toEqual([]);
  });

  it("keeps five queries in recency order, each of them once", () => {
    const slot: SearchInput[] = [];
    mount(<Probe slot={slot} />);

    for (const query of ["one", "two", "three", "four", "five", "six", "three"]) {
      rest(slot, query);
    }

    expect(slot[0]?.recent).toEqual(["three", "six", "five", "four", "two"]);
  });
});
