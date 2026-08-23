import { queryKeys } from "@cue/core/data/query-keys";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { SearchHit } from "@cue/core/data/trakt/search";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWatchlistAdd, type WatchlistAddView } from "@ui/hooks/useWatchlistAdd";
import { type CueRuntime, RuntimeProvider, type UpNextData } from "@ui/runtime/runtime";
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
  slot[0] = useWatchlistAdd({ shows: true });
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
