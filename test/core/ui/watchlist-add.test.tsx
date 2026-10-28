// @vitest-environment jsdom

import { notifyManager, QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import { queryKeys } from "@/core/data/query-keys";
import type { SearchHit } from "@/core/domain/discover";
import type { LibraryEntry } from "@/core/domain/model/library";
import type { MovieEntry } from "@/core/domain/model/movie";
import type { QueuedOp } from "@/core/domain/write-queue/types";
import { useWatchlistAdd, type WatchlistAddView } from "@/core/hooks/useWatchlistAdd";
import type {
  CueRuntime,
  MovieLibraryData,
  SubmitOutcome,
  UpNextData,
} from "@/core/runtime/runtime";
import { useSnackbar } from "@/core/stores/snackbar-store";
import { makeShow } from "../domain/_helpers";
import { partialRuntime, withRuntime } from "../support/runtime";

beforeAll(() => notifyManager.setScheduler((callback) => callback()));

const show: SearchHit = {
  key: "show:1",
  type: "show",
  traktId: 1,
  title: "Refetched Show",
  year: 2026,
  posters: [],
  tmdbId: null,
  ids: { trakt: 1 },
};

const movie: SearchHit = { ...show, key: "movie:1", type: "movie", title: "Dune" };

const watchedShow: LibraryEntry = {
  ...makeShow({ showId: show.traktId, lastWatchedAt: "2026-01-01T00:00:00.000Z", completed: 3 }),
  tmdbId: null,
  runtime: null,
  posters: [],
};

const watchedMovie: MovieEntry = {
  movieId: movie.traktId,
  ids: { trakt: movie.traktId },
  title: movie.title,
  year: movie.year,
  watched: true,
  watchedAt: "2026-01-01T00:00:00.000Z",
  inWatchlist: false,
  inCollection: false,
  addedAt: null,
  posters: [],
  tmdbId: null,
  runtime: null,
};

const listedMovie: MovieEntry = {
  ...watchedMovie,
  watched: false,
  watchedAt: null,
  inWatchlist: true,
};

let view: { readonly current: WatchlistAddView };

async function mountAdd(client: QueryClient, runtime: CueRuntime): Promise<void> {
  view = renderHook(useWatchlistAdd, { wrapper: withRuntime(runtime, client) }).result;
  await act(async () => {});
}

function membershipRuntime(outcome: SubmitOutcome, submitted: QueuedOp[] = []): CueRuntime {
  return partialRuntime({
    newId: () => `op-${submitted.length}`,
    loadUpNext: () => new Promise(() => {}),
    loadMovieWatchlist: () => new Promise(() => {}),
    submit: (op: QueuedOp) => {
      submitted.push(op);
      return Promise.resolve(outcome);
    },
  });
}

it("lists an added show in the library at once and drops it again when the add is undone", async () => {
  const client = new QueryClient();
  client.setQueryData<UpNextData>(queryKeys.library(), { entries: [] });
  await mountAdd(client, membershipRuntime("deferred"));

  await act(async () => view.current.add(show));
  expect(view.current.isAdded(show)).toBe(true);
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toEqual([
    {
      showId: show.traktId,
      title: show.title,
      year: show.year,
      status: "",
      hidden: false,
      inWatchlist: true,
      addedAt: expect.any(String),
      lastWatchedAt: null,
      plays: 0,
      aired: 0,
      completed: 0,
      left: 0,
      nextEpisode: null,
      lastAired: null,
      tmdbId: null,
      runtime: null,
      posters: [],
      pendingAdvance: false,
    },
  ]);

  await act(async () => view.current.remove(show));
  expect(view.current.isAdded(show)).toBe(false);
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toEqual([]);
});

it("restores every cache that lists a title after a hard-failed remove", async () => {
  const client = new QueryClient();
  const shows: UpNextData = { entries: [{ ...watchedShow, inWatchlist: true }] };
  const movies: MovieLibraryData = { entries: [{ ...watchedMovie, inWatchlist: true }] };
  client.setQueryData(queryKeys.library(), shows);
  client.setQueryData(queryKeys.movieLibrary(), movies);
  client.setQueryData(queryKeys.movieWatchlist(), [listedMovie]);
  await mountAdd(client, membershipRuntime("failed"));

  await act(async () => view.current.remove(show));
  await act(async () => view.current.remove(movie));

  expect(client.getQueryData(queryKeys.library())).toEqual(shows);
  expect(client.getQueryData(queryKeys.movieLibrary())).toEqual(movies);
  expect(client.getQueryData(queryKeys.movieWatchlist())).toEqual([listedMovie]);
});

it("keeps watched titles in the library when they leave the watchlist", async () => {
  const client = new QueryClient();
  client.setQueryData<UpNextData>(queryKeys.library(), {
    entries: [{ ...watchedShow, inWatchlist: true }],
  });
  client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), {
    entries: [{ ...watchedMovie, inWatchlist: true }],
  });
  client.setQueryData(queryKeys.movieWatchlist(), [listedMovie]);
  await mountAdd(client, membershipRuntime("deferred"));

  await act(async () => view.current.remove(show));
  await act(async () => view.current.remove(movie));

  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toEqual([watchedShow]);
  expect(client.getQueryData<MovieLibraryData>(queryKeys.movieLibrary())?.entries).toEqual([
    watchedMovie,
  ]);
  expect(client.getQueryData(queryKeys.movieWatchlist())).toEqual([]);
  expect(view.current.isAdded(movie)).toBe(true);
});

it("adds a movie to the movie watchlist and movie library once, then revalidates both", async () => {
  const submitted: QueuedOp[] = [];
  const client = new QueryClient();
  client.setQueryData(queryKeys.movieWatchlist(), []);
  client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), { entries: [] });
  await mountAdd(client, membershipRuntime("done", submitted));

  await act(async () => view.current.add(movie));
  await act(async () => view.current.add(movie));

  expect(submitted.map((op) => op.request.body)).toEqual([{ movies: [{ ids: { trakt: 1 } }] }]);
  const listed = {
    movieId: movie.traktId,
    ids: movie.ids,
    title: movie.title,
    year: movie.year,
    watched: false,
    watchedAt: null,
    inWatchlist: true,
    inCollection: false,
    addedAt: expect.any(String),
    posters: [],
    tmdbId: null,
    runtime: null,
  };
  expect(client.getQueryData<MovieLibraryData>(queryKeys.movieLibrary())?.entries).toEqual([
    listed,
  ]);
  expect(client.getQueryData(queryKeys.movieWatchlist())).toEqual([listed]);
  expect(client.getQueryState(queryKeys.movieLibrary())?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.movieWatchlist())?.isInvalidated).toBe(true);
  expect(view.current.isAdded(show)).toBe(false);
});

it("offers the add again, and says why, when Trakt refuses it", async () => {
  const client = new QueryClient();
  client.setQueryData<UpNextData>(queryKeys.library(), { entries: [] });
  await mountAdd(client, membershipRuntime("failed"));

  await act(async () => view.current.add(show));

  expect(view.current.isAdded(show)).toBe(false);
  expect(useSnackbar.getState().snack?.message).toBe(
    "Couldn't add Refetched Show to your watchlist. Please try again.",
  );
});

it("removes a listed movie before the movie library has loaded", async () => {
  const client = new QueryClient();
  client.setQueryData(queryKeys.movieWatchlist(), [listedMovie]);
  await mountAdd(client, membershipRuntime("deferred"));
  expect(view.current.isAdded(movie)).toBe(true);

  await act(async () => view.current.remove(movie));
  expect(view.current.isAdded(movie)).toBe(false);
  expect(client.getQueryData(queryKeys.movieLibrary())).toBeUndefined();
});

it("offers the add until membership has loaded", async () => {
  await mountAdd(new QueryClient(), membershipRuntime("done"));
  expect(view.current.isAdded(show)).toBe(false);
  expect(view.current.isAdded(movie)).toBe(false);
});

it("counts a movie in the movie library as added, but not a show with the same id", async () => {
  const client = new QueryClient();
  client.setQueryData(queryKeys.movieWatchlist(), []);
  client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), { entries: [watchedMovie] });
  await mountAdd(client, membershipRuntime("done"));

  expect(view.current.isAdded(movie)).toBe(true);
  expect(view.current.isAdded(show)).toBe(false);
});
