// @vitest-environment jsdom
import { type SearchInput, useSearchInput } from "@cue/core/hooks/useSearchInput";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "./_mount";

function Probe({ slot }: { readonly slot: SearchInput[] }): null {
  slot[0] = useSearchInput();
  return null;
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

    act(() => vi.advanceTimersByTime(300));
    expect(slot[0]?.query).toBe("harbor");
    expect(slot[0]?.settling).toBe(false);
  });

  it("keeps five unique successful queries in recency order", () => {
    const slot: SearchInput[] = [];
    mount(<Probe slot={slot} />);

    act(() => {
      for (const query of ["one", "two", "three", "four", "five", "six", "three", ""]) {
        slot[0]?.remember(query);
      }
    });

    expect(slot[0]?.recent).toEqual(["three", "six", "five", "four", "two"]);
  });
});
