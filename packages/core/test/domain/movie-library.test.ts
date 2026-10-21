import type { MovieEntry } from "@cue/core/data/trakt/movie-library";
import { movieBuckets, sortMovies } from "@cue/core/domain/library-buckets";
import { describe, expect, it } from "vitest";

const movie = (overrides: Partial<MovieEntry>): MovieEntry => ({
  movieId: 1,
  ids: { trakt: 1 },
  title: "A Movie",
  year: 2020,
  watched: false,
  watchedAt: null,
  inWatchlist: false,
  inCollection: false,
  addedAt: null,
  posters: [],
  tmdbId: null,
  runtime: null,
  ...overrides,
});

const ids = (entries: readonly MovieEntry[]): number[] => entries.map((entry) => entry.movieId);

describe("movieBuckets", () => {
  it("puts every unwatched title in Not started, whichever list it came from", () => {
    const buckets = movieBuckets([
      movie({ movieId: 1, watched: true, inWatchlist: true }),
      movie({ movieId: 2, inWatchlist: true }),
      movie({ movieId: 3, inCollection: true }),
    ]);

    expect(ids(buckets["not-started"])).toEqual([2, 3]);
    expect(ids(buckets.watched)).toEqual([1]);
  });
});

describe("sortMovies", () => {
  const titles = [
    movie({ movieId: 1, title: "Zeta", watchedAt: "2026-01-01", addedAt: "2026-01-01" }),
    movie({ movieId: 2, title: "Undated", year: null }),
    movie({ movieId: 3, title: "Alpha", watchedAt: "2026-01-01", addedAt: "2026-01-01" }),
    movie({
      movieId: 4,
      title: "Newest",
      year: 2026,
      watchedAt: "2026-02-01",
      addedAt: "2026-03-01",
    }),
  ];

  it("orders by the date watched, the date added, or the release year, newest first", () => {
    expect(ids(sortMovies(titles, "recently-watched"))).toEqual([4, 3, 1, 2]);
    expect(ids(sortMovies(titles, "recently-added"))).toEqual([4, 3, 1, 2]);
    expect(ids(sortMovies(titles, "release-year"))).toEqual([4, 3, 1, 2]);
  });

  it("orders by title without regard to case", () => {
    expect(ids(sortMovies(titles, "alphabetical"))).toEqual([3, 4, 2, 1]);
  });
});
