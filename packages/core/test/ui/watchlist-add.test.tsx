// @vitest-environment jsdom
import { queryKeys } from "@cue/core/data/query-keys";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { MovieEntry } from "@cue/core/data/trakt/movie-library";
import type { SearchHit } from "@cue/core/data/trakt/search";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { useWatchlistAdd, type WatchlistAddView } from "@cue/core/hooks/useWatchlistAdd";
import {
  type CueRuntime,
  type MovieLibraryData,
  RuntimeProvider,
  type SubmitOutcome,
  type UpNextData,
} from "@cue/core/runtime/runtime";
import { useSnackbar } from "@cue/core/stores/snackbar-store";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { beforeAll, expect, it } from "vitest";
import { makeShow } from "../domain/_helpers";
import { mountAsync } from "./_mount";

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

function Probe({ slot }: { readonly slot: WatchlistAddView[] }): null {
  slot[0] = useWatchlistAdd();
  return null;
}

async function mountProbe(client: QueryClient, runtime: CueRuntime): Promise<WatchlistAddView[]> {
  const slot: WatchlistAddView[] = [];
  await mountAsync(
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>
        <Probe slot={slot} />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  return slot;
}

function membershipRuntime(outcome: SubmitOutcome, submitted: QueuedOp[] = []): CueRuntime {
  return {
    newId: () => `op-${submitted.length}`,
    loadUpNext: () => new Promise(() => {}),
    loadMovieWatchlistIds: () => new Promise(() => {}),
    submit: (op: QueuedOp) => {
      submitted.push(op);
      return Promise.resolve(outcome);
    },
  } as unknown as CueRuntime;
}

it("lists an added show in the library at once and drops it again when the add is undone", async () => {
  const client = new QueryClient();
  client.setQueryData<UpNextData>(queryKeys.library(), { entries: [] });
  const slot = await mountProbe(client, membershipRuntime("deferred"));

  await act(async () => slot[0]?.add(show));
  expect(slot[0]?.isAdded(show)).toBe(true);
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toMatchObject([
    { showId: show.traktId, title: show.title, inWatchlist: true, completed: 0 },
  ]);

  await act(async () => slot[0]?.remove(show));
  expect(slot[0]?.isAdded(show)).toBe(false);
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toEqual([]);
});

it("restores every cache that lists a title after a hard-failed remove", async () => {
  const client = new QueryClient();
  const shows: UpNextData = { entries: [{ ...watchedShow, inWatchlist: true }] };
  const movies: MovieLibraryData = { entries: [{ ...watchedMovie, inWatchlist: true }] };
  client.setQueryData(queryKeys.library(), shows);
  client.setQueryData(queryKeys.movieLibrary(), movies);
  client.setQueryData(queryKeys.movieWatchlist(), [movie.traktId]);
  const slot = await mountProbe(client, membershipRuntime("failed"));

  await act(async () => slot[0]?.remove(show));
  await act(async () => slot[0]?.remove(movie));

  expect(client.getQueryData(queryKeys.library())).toEqual(shows);
  expect(client.getQueryData(queryKeys.movieLibrary())).toEqual(movies);
  expect(client.getQueryData(queryKeys.movieWatchlist())).toEqual([movie.traktId]);
});

it("keeps watched titles in the library when they leave the watchlist", async () => {
  const client = new QueryClient();
  client.setQueryData<UpNextData>(queryKeys.library(), {
    entries: [{ ...watchedShow, inWatchlist: true }],
  });
  client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), {
    entries: [{ ...watchedMovie, inWatchlist: true }],
  });
  client.setQueryData(queryKeys.movieWatchlist(), [movie.traktId]);
  const slot = await mountProbe(client, membershipRuntime("deferred"));

  await act(async () => slot[0]?.remove(show));
  await act(async () => slot[0]?.remove(movie));

  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toEqual([watchedShow]);
  expect(client.getQueryData<MovieLibraryData>(queryKeys.movieLibrary())?.entries).toEqual([
    watchedMovie,
  ]);
  expect(client.getQueryData(queryKeys.movieWatchlist())).toEqual([]);
  expect(slot[0]?.isAdded(movie)).toBe(true);
});

it("adds a movie to the movie watchlist and movie library once, then revalidates both", async () => {
  const submitted: QueuedOp[] = [];
  const client = new QueryClient();
  client.setQueryData(queryKeys.movieWatchlist(), []);
  client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), { entries: [] });
  const slot = await mountProbe(client, membershipRuntime("done", submitted));

  await act(async () => slot[0]?.add(movie));
  await act(async () => slot[0]?.add(movie));

  expect(submitted.map((op) => op.request.body)).toEqual([{ movies: [{ ids: { trakt: 1 } }] }]);
  expect(client.getQueryData<MovieLibraryData>(queryKeys.movieLibrary())?.entries).toMatchObject([
    { movieId: movie.traktId, inWatchlist: true, watched: false },
  ]);
  expect(client.getQueryState(queryKeys.movieLibrary())?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.movieWatchlist())?.isInvalidated).toBe(true);
  expect(slot[0]?.isAdded(show)).toBe(false);
});

it("offers the add again, and says why, when Trakt refuses it", async () => {
  const client = new QueryClient();
  client.setQueryData<UpNextData>(queryKeys.library(), { entries: [] });
  const slot = await mountProbe(client, membershipRuntime("failed"));

  await act(async () => slot[0]?.add(show));

  expect(slot[0]?.isAdded(show)).toBe(false);
  expect(useSnackbar.getState().snack?.message).toBe(
    "Couldn't add Refetched Show to your watchlist. Please try again.",
  );
});

it("removes a listed movie before the movie library has loaded", async () => {
  const client = new QueryClient();
  client.setQueryData(queryKeys.movieWatchlist(), [movie.traktId]);
  const slot = await mountProbe(client, membershipRuntime("deferred"));
  expect(slot[0]?.isAdded(movie)).toBe(true);

  await act(async () => slot[0]?.remove(movie));
  expect(slot[0]?.isAdded(movie)).toBe(false);
  expect(client.getQueryData(queryKeys.movieLibrary())).toBeUndefined();
});

it("offers the add until membership has loaded", async () => {
  const slot = await mountProbe(new QueryClient(), membershipRuntime("done"));
  expect(slot[0]?.isAdded(show)).toBe(false);
  expect(slot[0]?.isAdded(movie)).toBe(false);
});

it("counts a movie in the movie library as added, but not a show with the same id", async () => {
  const client = new QueryClient();
  client.setQueryData(queryKeys.movieWatchlist(), []);
  client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), { entries: [watchedMovie] });
  const slot = await mountProbe(client, membershipRuntime("done"));

  expect(slot[0]?.isAdded(movie)).toBe(true);
  expect(slot[0]?.isAdded(show)).toBe(false);
});
