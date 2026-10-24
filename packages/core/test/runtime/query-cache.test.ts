/**
 * What survives a cold boot. The persisted blob is what the first screen paints
 * before the network answers, and it is unbounded in age, so what goes into it
 * is a product decision rather than a caching detail: too little and an offline
 * user boots to an empty Up Next, too much and the blob grows with every title
 * ever opened.
 */

import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../../src/data/query-keys";
import { createQueryCachePolicy, restorableCache } from "../../src/runtime/query-cache";

const LIBRARY_SHOW = 1;
const UNSEEN_SHOW = 2;

function policyOver(entries?: readonly { readonly showId: number }[]): {
  persists(
    key: readonly unknown[],
    state?: { status: "success" | "error"; data?: unknown },
  ): boolean;
} {
  const queryClient = new QueryClient();
  if (entries !== undefined) queryClient.setQueryData(queryKeys.library(), { entries });
  const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);
  return {
    persists(key, state = { status: "success", data: {} }) {
      return shouldDehydrateQuery({ queryKey: key, state } as Parameters<
        typeof shouldDehydrateQuery
      >[0]);
    },
  };
}

const policy = policyOver([{ showId: LIBRARY_SHOW }]);

describe("what a cold boot restores", () => {
  it("keeps the screens a user lands on", () => {
    expect(policy.persists(queryKeys.library())).toBe(true);
    expect(policy.persists(queryKeys.movieLibrary())).toBe(true);
    expect(policy.persists(queryKeys.watchlist("shows"))).toBe(true);
    expect(policy.persists(queryKeys.history("all"))).toBe(true);
    expect(policy.persists(queryKeys.calendar("2026-01-01", 7))).toBe(true);
    expect(policy.persists(queryKeys.firstPlay())).toBe(true);
    expect(policy.persists(queryKeys.userSettings())).toBe(true);
    expect(policy.persists(queryKeys.genres())).toBe(true);
  });

  it("drops the unbounded key spaces nobody boots into", () => {
    expect(policy.persists(queryKeys.search("dune", "movie"))).toBe(false);
    expect(policy.persists(queryKeys.browse())).toBe(false);
  });

  it("drops the per-title detail trees, which cost one read to re-open", () => {
    expect(policy.persists(queryKeys.showProgress(LIBRARY_SHOW))).toBe(false);
    expect(policy.persists(queryKeys.showSeasons(UNSEEN_SHOW))).toBe(false);
    expect(policy.persists(queryKeys.episode(LIBRARY_SHOW, 1, 1))).toBe(false);
    expect(policy.persists(queryKeys.movieHeader(LIBRARY_SHOW))).toBe(false);
  });

  it("keeps the artwork a restored library card paints, and only that", () => {
    expect(policy.persists(queryKeys.showInfo(LIBRARY_SHOW))).toBe(true);
    expect(policy.persists(queryKeys.showInfo(UNSEEN_SHOW))).toBe(false);
  });

  it("keeps a library show's season tree, which places its card when the calendar sees a new episode", () => {
    expect(policy.persists(queryKeys.showSeasons(LIBRARY_SHOW))).toBe(true);
  });

  it("keeps nothing at all when there is no library to paint cards from", () => {
    const empty = policyOver([]);
    expect(empty.persists(queryKeys.showInfo(LIBRARY_SHOW))).toBe(false);
    expect(empty.persists(queryKeys.library())).toBe(true);
    expect(policyOver().persists(queryKeys.showInfo(LIBRARY_SHOW))).toBe(false);
  });

  it("never restores a query that has nothing to show", () => {
    expect(policy.persists(queryKeys.library(), { status: "error" })).toBe(false);
    expect(policy.persists(queryKeys.showInfo(LIBRARY_SHOW), { status: "error" })).toBe(false);
  });

  it("keeps the last good data of a query whose refresh failed, restored as that data", () => {
    const failedRefresh = { status: "error" as const, data: { entries: [] } };
    expect(policy.persists(queryKeys.library(), failedRefresh)).toBe(true);

    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.library(), failedRefresh.data);
    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.library() });
    query?.setState({ status: "error", error: new Error("503"), fetchFailureCount: 3 });
    const restored = new QueryClient();
    const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);
    const persisted = restorableCache({
      clientState: dehydrate(queryClient, { shouldDehydrateQuery }),
    });
    hydrate(restored, persisted.clientState);

    expect(restored.getQueryData(queryKeys.library())).toEqual(failedRefresh.data);
    expect(restorableCache(persisted)).toEqual(persisted);
    expect(restored.getQueryState(queryKeys.library())).toMatchObject({
      status: "success",
      error: null,
      fetchFailureCount: 0,
    });
  });
});
