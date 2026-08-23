import type { SearchHit } from "@cue/core/data/trakt/search";
import { visibleSearchHits } from "@ui/hooks/useSearch";
import { describe, expect, it } from "vitest";

function hit(type: "show" | "movie", traktId: number): SearchHit {
  return {
    key: `${type}:${traktId}`,
    type,
    traktId,
    title: `Title ${traktId}`,
    year: 2020,
    posters: [],
    tmdbId: null,
    ids: { trakt: traktId, slug: `title-${traktId}` },
  };
}

const mixed = [hit("show", 1), hit("movie", 2), hit("show", 3)];

describe("visibleSearchHits", () => {
  it("passes everything through with both media enabled", () => {
    expect(visibleSearchHits(mixed, true, true)).toEqual(mixed);
  });

  it("hides movie hits for a shows-only user", () => {
    expect(visibleSearchHits(mixed, true, false).map((h) => h.traktId)).toEqual([1, 3]);
  });

  it("hides show hits for a movies-only user", () => {
    expect(visibleSearchHits(mixed, false, true).map((h) => h.traktId)).toEqual([2]);
  });
});
