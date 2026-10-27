import { invalidationKeys, showProgressKeys } from "@cue/core/data/query-invalidation";
import type { WatchlistItem } from "@cue/core/data/trakt/schemas";
import type { InvalidationTarget } from "@cue/core/domain/sync-activities";
import { firstPlayQuery, historyQuery } from "@cue/core/queries/history";
import { movieLibraryQuery, movieWatchlistQuery } from "@cue/core/queries/library";
import { movieHeaderQuery } from "@cue/core/queries/movies";
import { episodeQuery, showInfoQuery, showProgressQuery } from "@cue/core/queries/shows";
import { userProfileQuery } from "@cue/core/queries/user";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import { InfiniteQueryObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const EVERY_TARGET: readonly InvalidationTarget[] = [
  "watched/shows",
  "progress/watched",
  "watched/movies",
  "movie-progress",
  "watchlist/shows",
  "watchlist/movies",
  "hidden/progress_watched",
  "hidden/dropped",
  "recompute:buckets",
  "recompute:to-watch",
  "recompute:following",
];

const loaders = {
  loadUserProfile: vi.fn(() => Promise.resolve({})),
  loadMovieLibrary: vi.fn((_watchlist: Promise<readonly WatchlistItem[]>) =>
    Promise.resolve({ entries: [] }),
  ),
  loadMovieWatchlist: vi.fn((): Promise<readonly WatchlistItem[]> => Promise.resolve([])),
  loadShowInfo: vi.fn(() => Promise.resolve({})),
  loadShowProgress: vi.fn(() => Promise.resolve({})),
  loadEpisode: vi.fn(() => Promise.resolve({})),
  loadMovieHeader: vi.fn(() => Promise.resolve({})),
  loadFirstPlayAt: vi.fn(() => Promise.resolve("2019-03-09T10:00:00.000Z")),
  loadHistory: vi.fn((_section: string, page: number) =>
    Promise.resolve({ entries: [], page, pageCount: 2 }),
  ),
};
const runtime = loaders as unknown as CueRuntime;

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
      ["watched/movies"],
    ],
    [
      "show progress",
      (qc: QueryClient) => new QueryObserver(qc, showProgressQuery(runtime, 7)),
      loaders.loadShowProgress,
      [7],
      [],
    ],
  ] as const)("%s", async (_name, watch, load, args, targets) => {
    load.mockClear();
    const queryClient = await observe(watch);
    expect(load).toHaveBeenCalledWith(...args);
    const keys = targets.length > 0 ? invalidationKeys(targets) : showProgressKeys(7);
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refreshes a marked episode's detail, by coordinate and by a bulk mark", async () => {
    const queryClient = await observe(
      (qc) => new QueryObserver(qc, episodeQuery(runtime, 7, 2, 3)),
    );
    expect(loaders.loadEpisode).toHaveBeenCalledWith(7, 2, 3);
    for (const scope of [{ season: 2, number: 3 }, "all"] as const) {
      await Promise.all(
        showProgressKeys(7, scope).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
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
      (qc: QueryClient) => new QueryObserver(qc, showInfoQuery(runtime, 7)),
      loaders.loadShowInfo,
      [7],
    ],
    [
      "movie header",
      (qc: QueryClient) => new QueryObserver(qc, movieHeaderQuery(runtime, 9)),
      loaders.loadMovieHeader,
      [9],
    ],
  ] as const)("leaves the %s alone on every activity and every mark", async (_name, watch, load, args) => {
    load.mockClear();
    const queryClient = await observe(watch);
    expect(load).toHaveBeenCalledWith(...args);
    const keys = [...invalidationKeys(EVERY_TARGET), ...showProgressKeys(7, "all")];
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
      invalidationKeys(["watched/shows"]).map((queryKey) =>
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
      invalidationKeys(["watched/movies"]).map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
    expect(loaders.loadFirstPlayAt).toHaveBeenCalledTimes(2);
  });
});
