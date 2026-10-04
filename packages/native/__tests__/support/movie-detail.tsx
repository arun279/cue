import type { MovieEntry, MovieHeader } from "@cue/core/data/trakt/movie-library";
import type { SearchHit } from "@cue/core/data/trakt/search";
import { buildMarkMovieOp } from "@cue/core/domain/write-queue/ops";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import { fakeRuntime } from "./up-next";

export const movieHeader: MovieHeader = {
  movieId: 5501,
  ids: { trakt: 5501, slug: "the-lantern-keeper" },
  title: "The Lantern Keeper",
  year: 2021,
  overview: "The keeper stays.",
  runtime: 104,
  released: "2021-09-17",
  genres: ["drama"],
  posters: [],
  backdrops: [],
  tmdbId: null,
};

export const movieEntry: MovieEntry = {
  ...movieHeader,
  watched: true,
  watchedAt: "2026-08-08T12:00:00Z",
  inWatchlist: false,
  listedAt: null,
};

export function movieRuntime(overrides: Partial<MovieEntry> = {}) {
  let id = 0;
  return {
    ...fakeRuntime({}),
    newId: jest.fn(() => String(++id)),
    submit: jest.fn<ReturnType<CueRuntime["submit"]>, Parameters<CueRuntime["submit"]>>(
      async () => "deferred",
    ),
    loadMovieHeader: jest.fn(async () => movieHeader),
    loadMovieLibrary: jest.fn(async () => ({ entries: [{ ...movieEntry, ...overrides }] })),
    loadMovieRelated: jest.fn(async (): Promise<readonly SearchHit[]> => []),
    loadMoviePlays: jest.fn(async () => [{ historyId: 91, watchedAt: movieEntry.watchedAt ?? "" }]),
    loadWatchlistIds: jest.fn(async () => []),
  };
}

export function pendingMovieRuntime(inFlight = false) {
  const runtime = movieRuntime();
  const pending = buildMarkMovieOp({
    opId: "pending-movie",
    ids: movieHeader.ids,
    watchedAt: movieEntry.watchedAt ?? "",
  });
  runtime.pendingOps = () => [pending];
  runtime.inFlightOpId = () => (inFlight ? pending.id : null);
  return { runtime, pending };
}
