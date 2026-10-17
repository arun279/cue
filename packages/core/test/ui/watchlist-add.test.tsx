// @vitest-environment jsdom
import { queryKeys } from "@cue/core/data/query-keys";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { expect, it } from "vitest";
import { mountAsync } from "./_mount";

const hit: SearchHit = {
  key: "show:1",
  type: "show",
  traktId: 1,
  title: "Refetched Show",
  year: 2026,
  posters: [],
  tmdbId: null,
  ids: { trakt: 1 },
};

function Probe({ slot }: { readonly slot: WatchlistAddView[] }): null {
  slot[0] = useWatchlistAdd();
  return null;
}

async function mountProbe(
  client: QueryClient,
  runtime: CueRuntime,
  slot: WatchlistAddView[],
): Promise<void> {
  await mountAsync(
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>
        <Probe slot={slot} />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
}

it("drops aggregate membership immediately when a landed add is undone", async () => {
  let listed: readonly number[] = [];
  const runtime = {
    newId: () => "op-id",
    loadWatchlistIds: () => Promise.resolve(listed),
    loadUpNext: () => Promise.resolve({ entries: [] }),
    loadMovieLibrary: () => Promise.resolve({ entries: [] }),
    submit: (op: { readonly request: { readonly path: string } }) => {
      if (op.request.path === "/sync/watchlist") {
        listed = [hit.traktId];
        return Promise.resolve("done");
      }
      return Promise.resolve("deferred");
    },
  } as unknown as CueRuntime;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.watchlist("shows"), []);
  client.setQueryData<UpNextData>(queryKeys.library(), { entries: [] });
  const slot: WatchlistAddView[] = [];
  await mountProbe(client, runtime, slot);

  await act(async () => slot[0]?.add(hit));
  const aggregateEntry = { showId: hit.traktId } as LibraryEntry;
  await act(async () => {
    client.setQueryData<UpNextData>(queryKeys.library(), { entries: [aggregateEntry] });
  });
  expect(slot[0]?.isAdded(hit)).toBe(true);

  await act(async () => slot[0]?.remove(hit));

  expect(slot[0]?.isAdded(hit)).toBe(false);
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toEqual([]);
});

it("restores watchlist and aggregate caches after a hard-failed remove", async () => {
  const aggregateEntry = { showId: hit.traktId } as LibraryEntry;
  const runtime = {
    newId: () => "op-id",
    loadWatchlistIds: () => Promise.resolve([hit.traktId]),
    loadUpNext: () => Promise.resolve({ entries: [aggregateEntry] }),
    loadMovieLibrary: () => Promise.resolve({ entries: [] }),
    submit: () => Promise.resolve("failed"),
  } as unknown as CueRuntime;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.watchlist("shows"), [hit.traktId]);
  const aggregate: UpNextData = { entries: [aggregateEntry] };
  client.setQueryData(queryKeys.library(), aggregate);
  const slot: WatchlistAddView[] = [];
  await mountProbe(client, runtime, slot);

  await act(async () => slot[0]?.remove(hit));

  expect(slot[0]?.isAdded(hit)).toBe(true);
  expect(client.getQueryData(queryKeys.watchlist("shows"))).toEqual([hit.traktId]);
  expect(client.getQueryData(queryKeys.library())).toEqual(aggregate);
});

const movie: SearchHit = { ...hit, key: "movie:1", type: "movie", title: "Dune" };

function membershipRuntime(outcome: SubmitOutcome, submitted: QueuedOp[] = []): CueRuntime {
  return {
    newId: () => `op-${submitted.length}`,
    loadWatchlistIds: () => Promise.resolve([]),
    submit: (op: QueuedOp) => {
      submitted.push(op);
      return Promise.resolve(outcome);
    },
  } as unknown as CueRuntime;
}

it("adds and removes a movie against the movie watchlist and movie library", async () => {
  const submitted: QueuedOp[] = [];
  const client = new QueryClient();
  client.setQueryData(queryKeys.watchlist("movies"), []);
  client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), { entries: [] });
  const slot: WatchlistAddView[] = [];
  await mountProbe(client, membershipRuntime("done", submitted), slot);

  await act(async () => slot[0]?.add(movie));
  await act(async () => slot[0]?.add(movie));
  expect(submitted.map((op) => op.request.body)).toEqual([{ movies: [{ ids: { trakt: 1 } }] }]);
  expect(client.getQueryState(queryKeys.movieLibrary())?.isInvalidated).toBe(true);
  expect(slot[0]?.isAdded(hit)).toBe(false);

  const seen = { movieId: 1 } as MovieLibraryData["entries"][number];
  await act(async () => {
    client.setQueryData<MovieLibraryData>(queryKeys.movieLibrary(), { entries: [seen] });
  });
  await act(async () => slot[0]?.remove(movie));
  expect(client.getQueryData<MovieLibraryData>(queryKeys.movieLibrary())?.entries).toEqual([]);
  expect(submitted[1]?.request.path).toBe("/sync/watchlist/remove");
});

it("offers the add again, and says why, when Trakt refuses it", async () => {
  const client = new QueryClient();
  client.setQueryData(queryKeys.watchlist("shows"), []);
  const slot: WatchlistAddView[] = [];
  await mountProbe(client, membershipRuntime("failed"), slot);

  await act(async () => slot[0]?.add(hit));
  expect(slot[0]?.isAdded(hit)).toBe(false);
  expect(slot[0]?.addError).toBe(
    "Couldn't add Refetched Show to your watchlist. Please try again.",
  );
});

it("removes a listed hit before either library has loaded", async () => {
  const client = new QueryClient();
  client.setQueryData(queryKeys.watchlist("shows"), [hit.traktId]);
  client.setQueryData(queryKeys.watchlist("movies"), [movie.traktId]);
  const slot: WatchlistAddView[] = [];
  await mountProbe(client, membershipRuntime("deferred"), slot);

  await act(async () => slot[0]?.remove(hit));
  await act(async () => slot[0]?.remove(movie));
  expect(slot[0]?.isAdded(hit)).toBe(false);
  expect(slot[0]?.isAdded(movie)).toBe(false);
  expect(client.getQueryData(queryKeys.library())).toBeUndefined();
});

it("offers the add until membership has loaded", async () => {
  const runtime = {
    ...membershipRuntime("done"),
    loadWatchlistIds: () => new Promise<readonly number[]>(() => {}),
  };
  const slot: WatchlistAddView[] = [];
  await mountProbe(new QueryClient(), runtime, slot);
  expect(slot[0]?.isAdded(hit)).toBe(false);
  expect(slot[0]?.isAdded(movie)).toBe(false);
});
