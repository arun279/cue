import { changedActivityKeys, showProgressKeys } from "@cue/core/data/query-invalidation";
import type { WatchlistItem } from "@cue/core/data/trakt/schemas";
import type { LastActivities } from "@cue/core/domain/sync-activities";
import { firstPlayQuery, historyQuery } from "@cue/core/queries/history";
import { movieLibraryQuery, movieWatchlistQuery } from "@cue/core/queries/library";
import { movieHeaderQuery } from "@cue/core/queries/movies";
import { episodeQuery, showInfoQuery, showProgressQuery } from "@cue/core/queries/shows";
import { userProfileQuery } from "@cue/core/queries/user";
import { InfiniteQueryObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { startTraktFake } from "../trakt-fake/in-process.ts";
import { buildRuntime } from "./_runtime";

const AT = "2026-07-05T00:00:00.000Z";

const EVERY_STAMP: LastActivities = {
  episodes: { watched_at: AT, collected_at: AT },
  shows: { hidden_at: AT, dropped_at: AT, watchlisted_at: AT },
  movies: { watched_at: AT, watchlisted_at: AT, collected_at: AT },
  watchlist: { updated_at: AT },
};

// A stamp the app has never seen counts as moved.
const moved = (stamps: LastActivities) => changedActivityKeys({}, stamps);

startTraktFake();
const runtime = await buildRuntime();
const loaders = {
  loadUserProfile: vi.spyOn(runtime, "loadUserProfile"),
  loadMovieLibrary: vi.spyOn(runtime, "loadMovieLibrary"),
  loadMovieWatchlist: vi.spyOn(runtime, "loadMovieWatchlist"),
  loadShowInfo: vi.spyOn(runtime, "loadShowInfo"),
  loadShowProgress: vi.spyOn(runtime, "loadShowProgress"),
  loadEpisode: vi.spyOn(runtime, "loadEpisode"),
  loadMovieHeader: vi.spyOn(runtime, "loadMovieHeader"),
  loadFirstPlayAt: vi
    .spyOn(runtime, "loadFirstPlayAt")
    .mockResolvedValue("2019-03-09T10:00:00.000Z"),
  loadHistory: vi
    .spyOn(runtime, "loadHistory")
    .mockImplementation((_section, page) => Promise.resolve({ entries: [], page, pageCount: 2 })),
};

interface Watched {
  subscribe(listener: () => void): () => void;
  getCurrentResult(): { readonly isSuccess: boolean };
}

/** Keep one observer on a read, as a mounted screen would, until it has loaded. */
async function observe(watch: (queryClient: QueryClient) => Watched): Promise<QueryClient> {
  const queryClient = new QueryClient();
  const observer = watch(queryClient);
  observer.subscribe(() => {});
  await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
  return queryClient;
}

describe("each read refreshes on the invalidation meant for it", () => {
  it.each([
    [
      "movie library",
      (qc: QueryClient) => new QueryObserver(qc, movieLibraryQuery(runtime)),
      loaders.loadMovieLibrary,
      [expect.any(Promise)],
      { movies: { watched_at: AT } },
    ],
    [
      "show progress",
      (qc: QueryClient) => new QueryObserver(qc, showProgressQuery(runtime, 8803)),
      loaders.loadShowProgress,
      [8803],
      null,
    ],
  ] as const)("%s", async (_name, watch, load, args, stamps) => {
    load.mockClear();
    const queryClient = await observe(watch);
    expect(load).toHaveBeenCalledWith(...args);
    const keys = stamps === null ? showProgressKeys(8803) : moved(stamps);
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refreshes a marked episode's detail, by coordinate and by a bulk mark", async () => {
    const queryClient = await observe(
      (qc) => new QueryObserver(qc, episodeQuery(runtime, 8803, 2, 3)),
    );
    expect(loaders.loadEpisode).toHaveBeenCalledWith(8803, 2, 3);
    for (const scope of [{ season: 2, number: 3 }, "all"] as const) {
      await Promise.all(
        showProgressKeys(8803, scope).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    }
    expect(loaders.loadEpisode).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      "account identity",
      (qc: QueryClient) => new QueryObserver(qc, userProfileQuery(runtime)),
      loaders.loadUserProfile,
      [],
    ],
    [
      "show info",
      (qc: QueryClient) => new QueryObserver(qc, showInfoQuery(runtime, 8803)),
      loaders.loadShowInfo,
      [8803],
    ],
    [
      "movie header",
      (qc: QueryClient) => new QueryObserver(qc, movieHeaderQuery(runtime, 5501)),
      loaders.loadMovieHeader,
      [5501],
    ],
  ] as const)("leaves the %s alone on every activity and every mark", async (_name, watch, load, args) => {
    load.mockClear();
    const queryClient = await observe(watch);
    expect(load).toHaveBeenCalledWith(...args);
    const keys = [...moved(EVERY_STAMP), ...showProgressKeys(8803, "all")];
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("the movie library", () => {
  it("is built from the cached movie watchlist, read once", async () => {
    const rows: WatchlistItem[] = [{ type: "movie", movie: { title: "Dune", ids: { trakt: 1 } } }];
    loaders.loadMovieWatchlist.mockClear();
    loaders.loadMovieWatchlist.mockResolvedValue(rows);
    const queryClient = await observe((qc) => new QueryObserver(qc, movieWatchlistQuery(runtime)));
    loaders.loadMovieLibrary.mockClear();
    await queryClient.fetchQuery(movieLibraryQuery(runtime));
    expect(loaders.loadMovieWatchlist).toHaveBeenCalledOnce();
    await expect(loaders.loadMovieLibrary.mock.calls[0]?.[0]).resolves.toBe(rows);
  });
});

describe("the Diary read", () => {
  it("pages through TV plays until the last page, and refreshes on a watch", async () => {
    const queryClient = new QueryClient();
    const observer = new InfiniteQueryObserver(queryClient, historyQuery(runtime, "tv", "all"));
    observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    await observer.fetchNextPage();
    expect(loaders.loadHistory.mock.calls.map(([section, page]) => [section, page])).toEqual([
      ["episodes", 1],
      ["episodes", 2],
    ]);
    expect(observer.getCurrentResult().hasNextPage).toBe(false);

    await Promise.all(
      moved({ episodes: { watched_at: AT } }).map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
    expect(loaders.loadHistory).toHaveBeenCalledTimes(4);
  });
});

describe("the month jump's first play", () => {
  it("reads once and refreshes whenever History does", async () => {
    const queryClient = await observe((qc) => new QueryObserver(qc, firstPlayQuery(runtime)));
    expect(queryClient.getQueryData(firstPlayQuery(runtime).queryKey)).toBe(
      "2019-03-09T10:00:00.000Z",
    );
    await Promise.all(
      moved({ movies: { watched_at: AT } }).map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
    expect(loaders.loadFirstPlayAt).toHaveBeenCalledTimes(2);
  });
});
