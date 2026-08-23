import type { MovieSummary, SearchResult, ShowSummary } from "@data/trakt/schemas";
import {
  assembleMovieHits,
  assembleSearchHits,
  assembleShowHits,
  rankSearchHits,
} from "@data/trakt/search";
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

describe("assembleShowHits", () => {
  it("maps a bare show list to show-typed poster hits", () => {
    const shows: ShowSummary[] = [
      { title: "Severance", year: 2022, ids: { trakt: 1 }, images: { poster: ["p.webp"] } },
      { title: "Dark", ids: { trakt: 2 } },
    ];
    const hits = assembleShowHits(shows);
    expect(hits.map((h) => h.type)).toEqual(["show", "show"]);
    expect(hits[0]).toMatchObject({ key: "show:1", traktId: 1, posters: ["p.webp"] });
    expect(hits[1]).toMatchObject({ year: null, posters: [] });
  });
});

describe("assembleMovieHits", () => {
  it("maps a bare movie list to movie-typed poster hits routing to /movie/:id", () => {
    const movies: MovieSummary[] = [
      {
        title: "Dune",
        year: 2021,
        ids: { trakt: 9, tmdb: 438631 },
        images: { poster: ["d.webp"] },
      },
      { title: "Inception", ids: { trakt: 10 } },
    ];
    const hits = assembleMovieHits(movies);
    expect(hits.map((h) => h.type)).toEqual(["movie", "movie"]);
    expect(hits[0]).toMatchObject({
      key: "movie:9",
      traktId: 9,
      posters: ["d.webp"],
      tmdbId: 438631,
    });
    expect(hits[1]).toMatchObject({ key: "movie:10", year: null, posters: [] });
  });
});

describe("rankSearchHits", () => {
  const hit = (traktId: number, title: string): SearchResult => ({
    type: "show",
    show: { title, ids: { trakt: traktId } },
  });

  it("floats an exact title match above prefix, substring, and non-title matches", () => {
    const hits = assembleSearchHits([
      hit(1, "The Severance Files"), // substring
      hit(2, "The Office"), // no title match
      hit(3, "Severance"), // exact
      hit(4, "Severance: Origins"), // prefix
    ]);
    expect(rankSearchHits(hits, "severance").map((h) => h.traktId)).toEqual([3, 4, 1, 2]);
  });

  it("is stable within a relevance bucket (keeps Trakt score order)", () => {
    const hits = assembleSearchHits([hit(10, "Alpha"), hit(11, "Beta"), hit(12, "Gamma")]);
    expect(rankSearchHits(hits, "zzz").map((h) => h.traktId)).toEqual([10, 11, 12]);
  });

  it("treats an empty query as all-equal, preserving order", () => {
    const hits = assembleSearchHits([hit(20, "Bravo"), hit(21, "Alpha")]);
    expect(rankSearchHits(hits, "").map((h) => h.traktId)).toEqual([20, 21]);
  });
});
