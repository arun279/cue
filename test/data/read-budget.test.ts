import { TRAKT_API_BASE, TraktClient } from "@data/trakt/client";
import { loadUpNextEntries, WATCHED_PROGRESS_BUDGET } from "@data/trakt/read-budget";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "./_msw";

const server = mswServer();
const client = new TraktClient({ clientId: "cid" });

const WATCHED_PAGE_LIMIT = 100;

/**
 * A heavy account's hidden set and watchlist each run to a few hundred entries. 200
 * exercises real multi-page pagination (2 pages at 100/page): the case the old
 * single-page model silently missed: while staying inside the smallest
 * (250-show) library's id range so these membership reads flip flags without
 * fabricating extra library entries. (Overlap with the watched set is irrelevant to
 * the GET count this suite gates; it just isolates the count from entry assembly,
 * which trakt-library.test.ts covers.)
 */
const HIDDEN_COUNT = 200;
const WATCHLIST_COUNT = 200;

interface Counts {
  watchedPages: number;
  progress: number;
  /** Bare `/shows/:id` art reads: must be ZERO in cold sync (art is deferred). */
  art: number;
  hidden: number;
  watchlist: number;
}

/**
 * A watched show `i` in most-recently-watched-DESC order (show 0 is the most
 * recent), carrying the bulk counts every row now brings: 10 aired episodes and a
 * season breakdown of `watched` watched ones. The default leaves a backlog, which
 * is what makes a show worth spending a progress read on.
 */
function watchedShow(i: number, watched = 8): unknown {
  const lastWatchedAt = new Date(Date.UTC(2026, 0, 1) - i * 86_400_000).toISOString();
  return {
    last_watched_at: lastWatchedAt,
    show: {
      title: `Show ${i}`,
      status: "returning series",
      aired_episodes: 10,
      ids: { trakt: i + 1 },
    },
    reset_at: null,
    seasons: [
      {
        number: 1,
        episodes: Array.from({ length: watched }, (_, e) => ({
          number: e + 1,
          last_watched_at: lastWatchedAt,
        })),
      },
    ],
  };
}

/** A progress payload with a real unwatched aired next episode (an Up Next card). */
function progressBody(id: number): unknown {
  return {
    aired: 10,
    completed: 3,
    last_watched_at: "2026-01-01T00:00:00.000Z",
    next_episode: {
      season: 1,
      number: 4,
      title: "Next",
      first_aired: "2026-01-01T00:00:00.000Z",
      ids: { trakt: id * 1000 },
    },
    seasons: [],
  };
}

/** A hidden-set row (`/users/hidden/progress_watched`) for show `id`: flips the
 * hidden flag only, materializes no library entry. */
function hiddenItem(id: number): unknown {
  return {
    hidden_at: "2026-01-01T00:00:00.000Z",
    type: "show",
    show: { title: `Show ${id}`, ids: { trakt: id } },
  };
}

/** A watchlist row for show `id`; ids overlap the watched set so it flips membership
 * without materializing a watchlist-only entry (kept out of the entry count). */
function watchlistItem(id: number): unknown {
  return {
    rank: id,
    listed_at: "2026-01-01T00:00:00.000Z",
    type: "show",
    show: { title: `Show ${id}`, ids: { trakt: id } },
  };
}

/** One page of a Trakt list read: slices `all` by the request's `page`/`limit` and
 * echoes the `X-Pagination-*` headers `getAllPages` walks. An empty list still
 * resolves as a single page (pageCount 1). Shared by every counted list handler so
 * the paginated-slicer isn't copy-pasted (jscpd, 0% threshold). */
function pageResponse(all: readonly unknown[], url: URL) {
  const page = Number(url.searchParams.get("page") ?? "1");
  const limit = Number(url.searchParams.get("limit") ?? String(WATCHED_PAGE_LIMIT));
  const start = (page - 1) * limit;
  return HttpResponse.json(all.slice(start, start + limit) as never, {
    headers: {
      "x-pagination-page": String(page),
      "x-pagination-page-count": String(Math.max(1, Math.ceil(all.length / limit))),
      "x-pagination-limit": String(limit),
      "x-pagination-item-count": String(all.length),
    },
  });
}

/**
 * Install counting handlers for the whole cold-sync read surface: `n` watched shows,
 * plus `hiddenCount`/`watchlistCount` membership rows (default 0 → a single empty
 * page each). Every list endpoint paginates through {@link pageResponse}, so the
 * hidden/watchlist reads are counted at their real paginated cost, not as one GET.
 */
function installColdSync(
  n: number,
  hiddenCount = 0,
  watchlistCount = 0,
  shows: readonly unknown[] = Array.from({ length: n }, (_, i) => watchedShow(i)),
): Counts {
  const counts: Counts = { watchedPages: 0, progress: 0, art: 0, hidden: 0, watchlist: 0 };
  const hiddenItems = Array.from({ length: hiddenCount }, (_, i) => hiddenItem(i + 1));
  const watchlistItems = Array.from({ length: watchlistCount }, (_, i) => watchlistItem(i + 1));

  server.use(
    http.get(`${TRAKT_API_BASE}/sync/watched/shows`, ({ request }) => {
      counts.watchedPages += 1;
      return pageResponse(shows, new URL(request.url));
    }),
    http.get(`${TRAKT_API_BASE}/shows/:id/progress/watched`, ({ params }) => {
      counts.progress += 1;
      return HttpResponse.json(progressBody(Number(params["id"])) as never);
    }),
    // A bare `/shows/:id` art read: deferred to the lazy per-card query, so the
    // cold-sync read must never hit this. Counted to prove art is NOT up-front.
    http.get(`${TRAKT_API_BASE}/shows/:id`, () => {
      counts.art += 1;
      return HttpResponse.json({ title: "X", ids: { trakt: 0 }, images: {} } as never);
    }),
    http.get(`${TRAKT_API_BASE}/users/hidden/progress_watched`, ({ request }) => {
      counts.hidden += 1;
      return pageResponse(hiddenItems, new URL(request.url));
    }),
    http.get(`${TRAKT_API_BASE}/sync/watchlist/shows`, ({ request }) => {
      counts.watchlist += 1;
      return pageResponse(watchlistItems, new URL(request.url));
    }),
  );
  return counts;
}

const total = (c: Counts): number => c.watchedPages + c.progress + c.art + c.hidden + c.watchlist;

describe("cold-sync GET budget", () => {
  // Trakt's authed rate limit is 1000 GET / 5 min / user. The bounded read must
  // stay FAR under it at every realistic library size: and, unlike the old
  // ~2-GET-per-show fan-out, must not scale with the library. This is the numeric
  // gate this asserts: an asserted request count, not prose.
  const TRAKT_AUTHED_5MIN_BUDGET = 1000;
  // A generous ceiling for the whole cold-sync burst that still leaves ~9× of
  // Trakt's window free for the freshness poll, per-card art, the movie library
  // read, and bounded 429 retries. Every case below: including a heavy hidden set
  // and watchlist: comes in well under it.
  const COLD_SYNC_CEILING = 100;

  it.each([
    250, 500, 1000,
  ])("a %i-show library stays within a bounded budget, no per-show art up front", async (n) => {
    // Documented model for N shows (100/page throughout):
    //   ceil(N/100) watched pages
    // + min(N, BUDGET) progress
    // + ceil(HIDDEN_COUNT/100) hidden pages
    // + ceil(WATCHLIST_COUNT/100) watchlist pages
    // + 0 art (deferred to the lazy per-visible-row read).
    const expectedWatchedPages = Math.ceil(n / WATCHED_PAGE_LIMIT);
    const expectedProgress = Math.min(n, WATCHED_PROGRESS_BUDGET);
    const expectedHiddenPages = Math.ceil(HIDDEN_COUNT / WATCHED_PAGE_LIMIT);
    const expectedWatchlistPages = Math.ceil(WATCHLIST_COUNT / WATCHED_PAGE_LIMIT);
    const expectedTotal =
      expectedWatchedPages + expectedProgress + expectedHiddenPages + expectedWatchlistPages;

    const counts = installColdSync(n, HIDDEN_COUNT, WATCHLIST_COUNT);
    const entries = await loadUpNextEntries(client);

    expect(counts.watchedPages).toBe(expectedWatchedPages);
    expect(counts.progress).toBe(expectedProgress);
    // Art is NEVER fetched in cold sync: it loads lazily per visible row.
    expect(counts.art).toBe(0);
    // Hidden + watchlist are paginated bulk reads, counted at their real page cost
    // (a heavy account spills past one page): not the single GET the model assumed.
    expect(counts.hidden).toBe(expectedHiddenPages);
    expect(counts.watchlist).toBe(expectedWatchlistPages);
    expect(total(counts)).toBe(expectedTotal);

    // The whole library is present; only the progress fan-out is capped. The
    // watchlist rows overlap the watched set, so they add no entries here.
    expect(entries).toHaveLength(n);

    // The bounded budget: comfortably under the ceiling AND Trakt's 5-min window.
    expect(total(counts)).toBeLessThan(COLD_SYNC_CEILING);
    expect(total(counts)).toBeLessThan(TRAKT_AUTHED_5MIN_BUDGET / 5);
  });

  it("does not scale ~2× with library size: 4× the shows is NOT ~4× the GETs", async () => {
    const small = installColdSync(250);
    await loadUpNextEntries(client);
    const smallTotal = total(small);
    server.resetHandlers();

    const large = installColdSync(1000);
    await loadUpNextEntries(client);
    const largeTotal = total(large);

    // 4× the library (250 → 1000) adds only the extra paginated list walk
    // (7 more pages); the dominant per-show fan-out stays pinned at the budget.
    expect(largeTotal - smallTotal).toBe(Math.ceil(1000 / 100) - Math.ceil(250 / 100));
    expect(largeTotal).toBeLessThan(smallTotal * 1.5);
  });

  it("bounds the hidden + watchlist reads: a heavy account spills to ceil(size/100) pages", async () => {
    // The reads the old model missed: with 200 hidden + 200 watchlist rows at
    // 100/page, each walks exactly 2 pages: bounded, not one GET and not unbounded.
    const counts = installColdSync(300, HIDDEN_COUNT, WATCHLIST_COUNT);
    await loadUpNextEntries(client);
    expect(counts.hidden).toBe(2);
    expect(counts.watchlist).toBe(2);
  });

  it("fetches progress for the MOST-RECENTLY-watched head; the tail keeps its real bulk counts", async () => {
    installColdSync(WATCHED_PROGRESS_BUDGET + 5);
    const entries = await loadUpNextEntries(client);

    // Show 0 is the most recent → in the budget head → real progress (aired 10,
    // completed 3, a next episode). The oldest show (index BUDGET+4) is beyond the
    // head, so its counts come from the bulk row: 8 of 10 watched. Its backlog is
    // real and visible; only the next episode's identity is missing.
    const newest = entries.find((e) => e.showId === 1);
    const oldest = entries.find((e) => e.showId === WATCHED_PROGRESS_BUDGET + 5);
    expect(newest).toMatchObject({ aired: 10, completed: 3 });
    expect(newest?.nextEpisode).not.toBeNull();
    expect(oldest).toMatchObject({ aired: 10, completed: 8, nextEpisode: null });
  });

  it("a library within the budget fetches every show's progress", async () => {
    const counts = installColdSync(WATCHED_PROGRESS_BUDGET - 20);
    await loadUpNextEntries(client);
    expect(counts.progress).toBe(WATCHED_PROGRESS_BUDGET - 20);
    expect(counts.art).toBe(0);
  });

  it("spends nothing on caught-up shows: a fully-watched library costs ZERO progress reads", async () => {
    // Every show's counts already arrive in bulk, so a progress read buys only the
    // next episode's identity. A show with nothing left has no next episode to name.
    const shows = Array.from({ length: 300 }, (_, i) => watchedShow(i, 10));
    const counts = installColdSync(300, 0, 0, shows);
    const entries = await loadUpNextEntries(client);
    expect(counts.progress).toBe(0);
    expect(entries).toHaveLength(300);
    expect(entries.every((e) => e.aired === 10 && e.completed === 10)).toBe(true);
  });

  it("spends the budget on shows with a backlog, most-recently-watched first", async () => {
    // 20 caught-up shows interleaved ahead of the ones with a backlog: the caught-up
    // rows must not consume budget the backlog rows need.
    const shows = Array.from({ length: 80 }, (_, i) => watchedShow(i, i < 20 ? 10 : 8));
    const counts = installColdSync(80, 0, 0, shows);
    const entries = await loadUpNextEntries(client);
    expect(counts.progress).toBe(WATCHED_PROGRESS_BUDGET);
    // Shows 20..79 have the backlog: exactly the 60 that fit the budget, so every
    // one of them is resolved and none of the caught-up rows was read.
    expect(entries.filter((e) => e.nextEpisode !== null)).toHaveLength(WATCHED_PROGRESS_BUDGET);
    expect(entries.find((e) => e.showId === 1)?.nextEpisode).toBeNull();
  });

  it("resolves a restarted show from the bulk breakdown, spending no read of its own", async () => {
    // Trakt's "restart show" leaves the pre-reset plays in the breakdown while
    // `/progress/watched` counts only the plays since. Every breakdown episode is
    // stamped, so the same cut is made here: all 10 plays predate the reset, so the
    // show reads as zero-watched with a real backlog and its progress read buys
    // only the next episode's identity, exactly as any other backlog show's does.
    const reset = {
      ...(watchedShow(0, 10) as Record<string, unknown>),
      reset_at: "2026-06-01T00:00:00.000Z",
    };
    const counts = installColdSync(1, 0, 0, [reset]);
    const entries = await loadUpNextEntries(client);
    expect(counts.progress).toBe(1);
    expect(entries[0]).toMatchObject({ aired: 10, completed: 3 });
  });

  it("pauses the whole fan-out on one 429 instead of each read waiting alone", async () => {
    // Trakt's limits are per WINDOW, and its guidance on a 429 is to pause requests
    // for Retry-After. With 10 backlog shows and 6 in flight, the six that already
    // left are unaffected, but the four behind them must wait out the same second
    // rather than firing straight into the window that just closed.
    const startedAt: number[] = [];
    let rateLimited = false;
    installColdSync(10);
    server.use(
      http.get(`${TRAKT_API_BASE}/shows/:id/progress/watched`, ({ params }) => {
        startedAt.push(Date.now());
        if (rateLimited) return HttpResponse.json(progressBody(Number(params["id"])) as never);
        rateLimited = true;
        return HttpResponse.json({} as never, { status: 429, headers: { "retry-after": "1" } });
      }),
    );

    await loadUpNextEntries(client);

    // 10 shows plus the one retried read, and nothing beyond the already-in-flight
    // six started inside the paused second.
    expect(startedAt).toHaveLength(11);
    const blockedAt = startedAt[0] as number;
    expect(startedAt.filter((at) => at - blockedAt < 900).length).toBeLessThanOrEqual(6);
  });

  it("costs zero reads for a restarted show already caught up on its post-reset plays", async () => {
    // The read the old reset special case always spent and never needed: every play
    // postdates the reset, so the local count matches `aired_episodes` and there is
    // no next episode to name.
    const reset = {
      ...(watchedShow(0, 10) as Record<string, unknown>),
      reset_at: "2020-01-01T00:00:00.000Z",
    };
    const counts = installColdSync(1, 0, 0, [reset]);
    const entries = await loadUpNextEntries(client);
    expect(counts.progress).toBe(0);
    expect(entries[0]).toMatchObject({ aired: 10, completed: 10, nextEpisode: null });
  });
});
