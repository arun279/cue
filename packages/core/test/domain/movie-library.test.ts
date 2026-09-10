import type { MovieEntry } from "@cue/core/data/trakt/movie-library";
import { groupMovieLibrary } from "@cue/core/domain/library-buckets";
import { describe, expect, it } from "vitest";

const movie = (overrides: Partial<MovieEntry>): MovieEntry => ({
  movieId: 1,
  ids: { trakt: 1 },
  title: "A Movie",
  year: 2020,
  watched: false,
  watchedAt: null,
  inWatchlist: false,
  listedAt: null,
  posters: [],
  tmdbId: null,
  ...overrides,
});

describe("groupMovieLibrary", () => {
  it("puts unwatched watchlist entries before watched entries without duplicates", () => {
    const segments = groupMovieLibrary(
      [
        movie({ movieId: 1, title: "Watched", watched: true, inWatchlist: true }),
        movie({ movieId: 2, title: "Wanted", inWatchlist: true }),
        movie({ movieId: 3, title: "Untracked" }),
      ],
      "alphabetical",
    );

    expect(segments.map((segment) => segment.key)).toEqual(["watchlist", "watched"]);
    expect(segments.flatMap((segment) => segment.entries.map((entry) => entry.movieId))).toEqual([
      2, 1,
    ]);
  });

  it("uses added dates for watchlist recency and watched dates for history recency", () => {
    const segments = groupMovieLibrary(
      [
        movie({ movieId: 1, title: "Old watch", watched: true, watchedAt: "2025-01-01" }),
        movie({ movieId: 2, title: "New watch", watched: true, watchedAt: "2026-01-01" }),
        movie({ movieId: 3, title: "Old add", inWatchlist: true, listedAt: "2025-01-01" }),
        movie({ movieId: 4, title: "New add", inWatchlist: true, listedAt: "2026-01-01" }),
      ],
      "recently-watched",
    );

    expect(segments[0]?.entries.map((entry) => entry.movieId)).toEqual([4, 3]);
    expect(segments[1]?.entries.map((entry) => entry.movieId)).toEqual([2, 1]);
  });

  it("sorts both segments by newest release year", () => {
    const segments = groupMovieLibrary(
      [
        movie({ movieId: 1, title: "Older wanted", year: 2020, inWatchlist: true }),
        movie({ movieId: 2, title: "Newer wanted", year: 2026, inWatchlist: true }),
        movie({ movieId: 3, title: "Older watched", year: 2019, watched: true }),
        movie({ movieId: 4, title: "Newer watched", year: 2025, watched: true }),
      ],
      "release-year",
    );

    expect(segments[0]?.entries.map((entry) => entry.movieId)).toEqual([2, 1]);
    expect(segments[1]?.entries.map((entry) => entry.movieId)).toEqual([4, 3]);
  });
});
