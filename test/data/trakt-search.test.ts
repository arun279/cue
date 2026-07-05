import type { SearchResult } from "@data/trakt/schemas";
import { assembleSearchHits } from "@data/trakt/search";
import { describe, expect, it } from "vitest";

describe("assembleSearchHits", () => {
  it("maps a show row to a hit", () => {
    const results: SearchResult[] = [
      {
        type: "show",
        show: {
          title: "Severance",
          year: 2022,
          ids: { trakt: 1, slug: "severance", tmdb: 95396, imdb: "tt11280740" },
          images: { poster: ["media.trakt.tv/s.webp"] },
        },
      },
    ];
    expect(assembleSearchHits(results)).toEqual([
      {
        key: "show:1",
        type: "show",
        traktId: 1,
        title: "Severance",
        year: 2022,
        posters: ["media.trakt.tv/s.webp"],
        tmdbId: 95396,
        ids: { trakt: 1, slug: "severance", tmdb: 95396, imdb: "tt11280740" },
      },
    ]);
  });

  it("maps a movie row to a hit", () => {
    const results: SearchResult[] = [
      { type: "movie", movie: { title: "Dune", year: 2021, ids: { trakt: 9, tmdb: 438631 } } },
    ];
    const [hit] = assembleSearchHits(results);
    expect(hit?.type).toBe("movie");
    expect(hit?.key).toBe("movie:9");
    expect(hit?.ids.tmdb).toBe(438631);
  });

  it("defaults a missing year to null and absent images to []", () => {
    const [hit] = assembleSearchHits([
      { type: "show", show: { title: "No Year Show", ids: { trakt: 3 } } },
    ]);
    expect(hit?.year).toBeNull();
    expect(hit?.posters).toEqual([]);
    expect(hit?.tmdbId).toBeNull();
  });

  it("drops a row whose declared type has no matching body", () => {
    const results: SearchResult[] = [
      { type: "show", movie: { title: "Mismatch", ids: { trakt: 4 } } },
      { type: "person", show: { title: "Person", ids: { trakt: 5 } } },
    ];
    expect(assembleSearchHits(results)).toEqual([]);
  });
});
