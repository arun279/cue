/**
 * What survives a cold boot. The persisted blob is what the first screen paints
 * before the network answers, and it is unbounded in age, so what goes into it
 * is a product decision rather than a caching detail: too little and an offline
 * user boots to an empty Up Next, too much and the blob grows with every title
 * ever opened.
 */

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../../src/data/query-keys";
import { createQueryCachePolicy } from "../../src/runtime/query-cache";

const LIBRARY_SHOW = 1;
const UNSEEN_SHOW = 2;

function policyOver(entries: readonly { readonly showId: number }[]): {
  persists(key: readonly unknown[], status?: "success" | "error"): boolean;
} {
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.library(), { entries });
  const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);
  return {
    persists(key, status = "success") {
      return shouldDehydrateQuery({ queryKey: key, state: { status } } as Parameters<
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
    expect(policy.persists(queryKeys.userStats())).toBe(true);
    expect(policy.persists(queryKeys.calendar("2026-01-01", 7))).toBe(true);
  });

  it("drops the unbounded key spaces nobody boots into", () => {
    expect(policy.persists(queryKeys.search("dune", "movie"))).toBe(false);
    expect(policy.persists(queryKeys.browse())).toBe(false);
  });

  it("drops the per-title detail trees, which cost one read to re-open", () => {
    expect(policy.persists(queryKeys.showProgress(LIBRARY_SHOW))).toBe(false);
    expect(policy.persists(queryKeys.showSeasons(LIBRARY_SHOW))).toBe(false);
    expect(policy.persists(queryKeys.episode(LIBRARY_SHOW, 1, 1))).toBe(false);
    expect(policy.persists(queryKeys.movieHeader(LIBRARY_SHOW))).toBe(false);
  });

  it("keeps the artwork a restored library card paints, and only that", () => {
    expect(policy.persists(queryKeys.showInfo(LIBRARY_SHOW))).toBe(true);
    expect(policy.persists(queryKeys.showInfo(UNSEEN_SHOW))).toBe(false);
  });

  it("keeps nothing at all when there is no library to paint cards from", () => {
    const empty = policyOver([]);
    expect(empty.persists(queryKeys.showInfo(LIBRARY_SHOW))).toBe(false);
    expect(empty.persists(queryKeys.library())).toBe(true);
  });

  it("never restores a query that failed", () => {
    expect(policy.persists(queryKeys.library(), "error")).toBe(false);
    expect(policy.persists(queryKeys.showInfo(LIBRARY_SHOW), "error")).toBe(false);
  });
});
