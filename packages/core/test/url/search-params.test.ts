import { parseHistorySearch, parseLibrarySearch } from "@cue/core/url/search-params";
import { describe, expect, it } from "vitest";

describe("parseLibrarySearch", () => {
  it("keeps the one param Movies pins", () => {
    expect(parseLibrarySearch({ type: "movies" })).toEqual({ type: "movies" });
  });

  it("drops everything else, so bare /library is Shows", () => {
    expect(parseLibrarySearch({})).toEqual({});
    expect(parseLibrarySearch({ type: "tv" })).toEqual({});
    expect(parseLibrarySearch({ type: 7 })).toEqual({});
    expect(parseLibrarySearch({ type: "movies", stray: "1" })).toEqual({ type: "movies" });
  });
});

describe("parseHistorySearch", () => {
  it("keeps a known medium and drops anything else", () => {
    expect(parseHistorySearch({ type: "tv" })).toEqual({ type: "tv" });
    expect(parseHistorySearch({ type: "movies" })).toEqual({ type: "movies" });
    expect(parseHistorySearch({ type: "books" })).toEqual({});
  });

  it("accepts any real year in the generous range and rejects the rest", () => {
    expect(parseHistorySearch({ year: "1999" })).toEqual({ year: 1999 });
    expect(parseHistorySearch({ year: 2100 })).toEqual({ year: 2100 });
    expect(parseHistorySearch({ year: 1969 })).toEqual({});
    expect(parseHistorySearch({ year: 2101 })).toEqual({});
    expect(parseHistorySearch({ year: "nineteen" })).toEqual({});
    expect(parseHistorySearch({ year: 1999.5 })).toEqual({});
  });

  it("drops a month with no valid year, because a month alone is not a position", () => {
    expect(parseHistorySearch({ month: 3 })).toEqual({});
    expect(parseHistorySearch({ year: 1969, month: 3 })).toEqual({});
    expect(parseHistorySearch({ year: 1999, month: 3 })).toEqual({ year: 1999, month: 3 });
  });

  it("rejects a month outside 1 to 12 while keeping its year", () => {
    expect(parseHistorySearch({ year: 1999, month: 0 })).toEqual({ year: 1999 });
    expect(parseHistorySearch({ year: 1999, month: 13 })).toEqual({ year: 1999 });
    expect(parseHistorySearch({ year: 1999, month: "March" })).toEqual({ year: 1999 });
  });

  it("carries all three together, and nothing it was not given", () => {
    expect(parseHistorySearch({ type: "movies", year: "2024", month: "12", other: "x" })).toEqual({
      type: "movies",
      year: 2024,
      month: 12,
    });
  });
});
