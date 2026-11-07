import type { SearchHit } from "@/core/domain/discover";
import type { MovieEntry, MovieHeader } from "@/core/domain/model/movie";
import { buildMarkMovieOp } from "@/core/domain/write-queue/ops";
import type { WriteState } from "@/core/domain/write-queue/queue";
import type { WriteReceipt } from "@/core/domain/write-queue/receipt";
import type { CueRuntime } from "@/core/runtime/runtime";
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
  inCollection: false,
  addedAt: null,
};

export function movieRuntime(overrides: Partial<MovieEntry> = {}) {
  let id = 0;
  const submit = jest.fn<ReturnType<CueRuntime["submit"]>, Parameters<CueRuntime["submit"]>>(
    async () => "deferred",
  );
  return {
    ...fakeRuntime({}),
    newId: jest.fn(() => String(++id)),
    submit,
    settled: (_opId: string): ReturnType<CueRuntime["settled"]> => new Promise(() => {}),
    writeState: jest.fn((_opId: string): WriteState => "unsent"),
    writeReceipt: (opId: string): WriteReceipt | null =>
      submit.mock.calls.some(([op]) => op.id === opId)
        ? { added: 1, updated: 0, deleted: 0, existing: 0, notFound: 0 }
        : null,
    loadMovieHeader: jest.fn(async () => movieHeader),
    loadMovieLibrary: jest.fn(async () => ({ entries: [{ ...movieEntry, ...overrides }] })),
    loadMovieRelated: jest.fn(async (): Promise<readonly SearchHit[]> => []),
    loadMoviePlays: jest.fn(async () => [{ historyId: 91, watchedAt: movieEntry.watchedAt ?? "" }]),
    loadMovieWatchlist: jest.fn(async (): Promise<readonly MovieEntry[]> => []),
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
  runtime.writeState.mockReturnValue(inFlight ? "sent" : "unsent");
  return { runtime, pending };
}
