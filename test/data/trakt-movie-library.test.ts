import {
  assembleMovieHeader,
  assembleMovieLibrary,
  type MovieLibraryInput,
} from "@data/trakt/movie-library";
import type { MovieDetailData, WatchedMovie, WatchlistItem } from "@data/trakt/schemas";
import { describe, expect, it } from "vitest";

function watchedMovie(overrides: {
  trakt: number;
  title?: string;
  year?: number;
  lastWatchedAt?: string | null;
  posters?: string[];
  tmdb?: number;
}): WatchedMovie {
  return {
    last_watched_at: overrides.lastWatchedAt ?? "2026-07-01T00:00:00.000Z",
    movie: {
      title: overrides.title ?? "Movie",
      year: overrides.year ?? 2021,
      ids: { trakt: overrides.trakt, tmdb: overrides.tmdb },
      images: overrides.posters ? { poster: overrides.posters } : undefined,
    },
  };
}

function watchlistMovie(overrides: {
  trakt: number;
  title?: string;
  year?: number;
}): WatchlistItem {
  return {
    type: "movie",
    movie: {
      title: overrides.title ?? "Queued Movie",
      year: overrides.year ?? 2020,
      ids: { trakt: overrides.trakt },
    },
  };
}

describe("assembleMovieLibrary", () => {
  it("maps a watched movie, carrying its poster, tmdb id and last-watched date", () => {
    const input: MovieLibraryInput = {
      watchedMovies: [
        watchedMovie({ trakt: 5, title: "Dune", posters: ["media.trakt.tv/d.webp"], tmdb: 438631 }),
      ],
      watchlistMovies: [],
    };
    const entries = assembleMovieLibrary(input);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      movieId: 5,
      title: "Dune",
      year: 2021,
      watched: true,
      watchedAt: "2026-07-01T00:00:00.000Z",
      inWatchlist: false,
      posters: ["media.trakt.tv/d.webp"],
      tmdbId: 438631,
    });
    expect(entries[0]?.ids).toEqual({ trakt: 5, slug: undefined, imdb: undefined, tmdb: 438631 });
  });

  it("flags a watched movie that is also on the watchlist as inWatchlist", () => {
    const entries = assembleMovieLibrary({
      watchedMovies: [watchedMovie({ trakt: 5, title: "Both" })],
      watchlistMovies: [watchlistMovie({ trakt: 5, title: "Both" })],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.inWatchlist).toBe(true);
    expect(entries[0]?.watched).toBe(true);
  });

  it("materializes a watchlist-only movie as an unwatched entry with no poster", () => {
    const entries = assembleMovieLibrary({
      watchedMovies: [],
      watchlistMovies: [watchlistMovie({ trakt: 9, title: "Queued" })],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      movieId: 9,
      title: "Queued",
      watched: false,
      watchedAt: null,
      inWatchlist: true,
      posters: [],
      tmdbId: null,
    });
  });

  it("defaults a missing year to null and omits an empty-movie watchlist row", () => {
    const noYear: WatchedMovie = {
      last_watched_at: null,
      movie: { title: "No Year", ids: { trakt: 3 } },
    };
    const entries = assembleMovieLibrary({
      watchedMovies: [noYear],
      watchlistMovies: [{ type: "movie" }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.year).toBeNull();
    expect(entries[0]?.watchedAt).toBeNull();
  });
});

describe("assembleMovieHeader", () => {
  it("maps the full extended movie payload", () => {
    const movie: MovieDetailData = {
      title: "Dune",
      year: 2021,
      overview: "A duke's son leads desert warriors.",
      runtime: 155,
      released: "2021-10-22",
      genres: ["science fiction", "adventure"],
      ids: { trakt: 5, slug: "dune-2021", imdb: "tt1160419", tmdb: 438631 },
      images: { poster: ["p.webp"], fanart: ["b.webp"] },
    };
    expect(assembleMovieHeader(movie)).toEqual({
      movieId: 5,
      ids: { trakt: 5, slug: "dune-2021", imdb: "tt1160419", tmdb: 438631 },
      title: "Dune",
      year: 2021,
      overview: "A duke's son leads desert warriors.",
      runtime: 155,
      released: "2021-10-22",
      genres: ["science fiction", "adventure"],
      posters: ["p.webp"],
      backdrops: ["b.webp"],
      tmdbId: 438631,
    });
  });

  it("degrades missing optional fields to null / empty defaults", () => {
    const movie: MovieDetailData = { title: "Sparse", ids: { trakt: 7 } };
    expect(assembleMovieHeader(movie)).toMatchObject({
      movieId: 7,
      year: null,
      overview: null,
      runtime: null,
      released: null,
      genres: [],
      posters: [],
      backdrops: [],
      tmdbId: null,
    });
  });
});
