/**
 * The shared read pool under a rate limit. Trakt's limits are per window, so a
 * 429 is a fact about the whole app rather than about one read: the pause it
 * opens is published, so the strip can say what is happening and when it
 * retries instead of inferring an outage from a read that happens to be failing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { TraktClient, type TraktResult, unwrapRead } from "@/core/data/trakt/client";
import { DEFAULT_TRAKT_POLICY } from "@/core/data/trakt/policy";
import {
  loadUpNextEntries,
  readsPausedUntil,
  resetReadPause,
  subscribeReadPause,
  withReadRateRetry,
} from "@/core/data/trakt/read-budget";
import { TraktReadError } from "@/core/domain/read-failure";
import { emptyAccount, libraryShow, type ShowSpec } from "../trakt-fake/account.ts";
import { createTraktFake } from "../trakt-fake/fake.ts";

const rateLimited = (retryAfterMs: number | null): TraktResult<never> => ({
  ok: false,
  error: { kind: "rate-limited", retryAfterMs },
});

afterEach(() => {
  resetReadPause();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("unwrapRead", () => {
  it("carries the failure kind across the throw, so the UI can name it", () => {
    try {
      unwrapRead(rateLimited(2000), "watched shows");
      expect.unreachable("unwrapRead must throw a failed read");
    } catch (error) {
      expect(error).toBeInstanceOf(TraktReadError);
      expect((error as TraktReadError).failure).toEqual({
        kind: "rate-limited",
        retryAfterMs: 2000,
      });
    }
  });

  it("hands back the data of a read that worked", () => {
    expect(unwrapRead({ ok: true, data: [1, 2], pagination: null }, "x")).toEqual([1, 2]);
  });
});

describe("withReadRateRetry", () => {
  it("publishes the pause even for the 429 that spends the retry budget", async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    subscribeReadPause(() => seen.push(readsPausedUntil()));
    // Every attempt is rate limited, so the read gives up: the window is still
    // closed, and every OTHER read has to know that.
    const read = vi.fn(() => Promise.resolve(rateLimited(5000)));
    const settled = withReadRateRetry(read);
    await vi.runAllTimersAsync();
    const result = await settled;

    expect(result.ok).toBe(false);
    expect(seen.length).toBeGreaterThan(0);
    expect(readsPausedUntil()).toBeGreaterThan(Date.now());
  });

  it("never shortens a pause another read has already opened", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const far = withReadRateRetry(() => Promise.resolve(rateLimited(30_000)));
    const near = withReadRateRetry(() => Promise.resolve(rateLimited(1000)));
    // Both first attempts answer in the same instant; the shorter wait must not
    // reopen a window the longer one closed, or the fan-out fires straight back
    // into it and every read burns its budget on the same limit.
    await vi.advanceTimersByTimeAsync(0);
    expect(readsPausedUntil()).toBe(startedAt + 30_000);

    await vi.runAllTimersAsync();
    await Promise.all([far, near]);
  });

  it("backs off with full jitter and pauses no other read when a 429 names no Retry-After", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const read = vi
      .fn<() => Promise<TraktResult<number>>>()
      .mockResolvedValueOnce(rateLimited(null))
      .mockResolvedValueOnce(rateLimited(null))
      .mockResolvedValue({ ok: true, data: 1, pagination: null });
    const settled = withReadRateRetry(read);
    await vi.advanceTimersByTimeAsync(0);
    expect(readsPausedUntil()).toBe(0);

    await vi.advanceTimersByTimeAsync(499);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await settled).ok).toBe(true);
  });

  it("spreads the retries of reads rate limited together rather than firing them in step", async () => {
    vi.useFakeTimers();
    const draws = [0.1, 0.9];
    vi.spyOn(Math, "random").mockImplementation(() => draws.shift() ?? 0);
    const attempts: number[] = [];
    const reader = () => {
      let calls = 0;
      return () => {
        calls += 1;
        attempts.push(Date.now());
        return Promise.resolve<TraktResult<number>>(
          calls === 1 ? rateLimited(null) : { ok: true, data: 1, pagination: null },
        );
      };
    };
    const startedAt = Date.now();
    const both = Promise.all([withReadRateRetry(reader()), withReadRateRetry(reader())]);
    await vi.runAllTimersAsync();
    await both;

    expect(attempts.map((at) => at - startedAt)).toEqual([0, 0, 100, 900]);
  });

  it("opens no pause at all for a read that works", async () => {
    const result = await withReadRateRetry(() =>
      Promise.resolve({ ok: true, data: 1, pagination: null } as TraktResult<number>),
    );
    expect(result.ok).toBe(true);
    expect(readsPausedUntil()).toBe(0);
  });

  it("leaves a non-rate-limit failure to the caller without pausing anything", async () => {
    const result = await withReadRateRetry(() =>
      Promise.resolve({ ok: false, error: { kind: "server", status: 503 } } as TraktResult<never>),
    );
    expect(result.ok).toBe(false);
    expect(readsPausedUntil()).toBe(0);
  });
});

it("caps concurrent reads across independent callers, not per fan-out", async () => {
  // The lazy per-card art reads a scrolling list issues are 300 separate calls,
  // not one fan-out. A cap owned by the fan-out leaves their sum unbounded, which
  // is the shape of every burst that has taken this app off the air.
  let inFlight = 0;
  let peak = 0;
  const read = async (): Promise<TraktResult<number>> => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight -= 1;
    return { ok: true, data: 1, pagination: null };
  };

  await Promise.all(Array.from({ length: 300 }, () => withReadRateRetry(read)));

  expect(peak).toBe(DEFAULT_TRAKT_POLICY.readConcurrency);
});

/** A show in the account's watch history: `aired` episodes out, `completed` of them played. */
function played(
  trakt: number,
  aired: number,
  completed: number,
  extra: Partial<ShowSpec> = {},
): ShowSpec {
  return {
    trakt,
    tmdb: trakt,
    slug: `show-${trakt}`,
    title: `Show ${trakt}`,
    year: 2020,
    status: "returning series",
    network: "Meridian",
    runtime: 45,
    genres: ["drama"],
    overview: "A show in the account's history.",
    seasons: [aired],
    startDaysAgo: aired * 7 + 30,
    completed,
    lastWatchedDaysAgo: trakt,
    ...extra,
  };
}

/** The cold sync over a fake account holding exactly these shows. */
async function coldSync(shows: readonly ShowSpec[]) {
  const fake = createTraktFake({
    account: () => {
      const account = emptyAccount();
      account.shows = shows.map((spec) => libraryShow(spec, account.now));
      return account;
    },
  });
  const client = new TraktClient({
    clientId: "client",
    getToken: () => fake.session().access_token,
    fetch: fake.fetch,
  });
  const entries = await loadUpNextEntries(client);
  const progressReads = fake.requests.filter((r) => r.path.endsWith("/progress/watched")).length;
  return { entries, progressReads };
}

const BUDGET = DEFAULT_TRAKT_POLICY.progressBudget;

describe("which shows the cold sync spends a progress read on", () => {
  it("spends the budget on shows with something left, so recently watched caught-up shows cost none of it", async () => {
    const caughtUp = Array.from({ length: 20 }, (_, i) =>
      played(i + 1, 10, 10, { lastWatchedDaysAgo: 0 }),
    );
    const backlog = Array.from({ length: BUDGET + 20 }, (_, i) => played(i + 21, 10, 8));
    const { entries, progressReads } = await coldSync([...caughtUp, ...backlog]);
    expect(progressReads).toBe(BUDGET);
    expect(entries.filter((entry) => entry.nextEpisode !== null)).toHaveLength(BUDGET);
    expect(entries.find((entry) => entry.showId === 1)?.nextEpisode).toBeNull();
  });

  it("reads a show restarted after all its plays, and none once its plays since the restart catch up", async () => {
    const restarted = await coldSync([
      played(1, 10, 10, { lastWatchedDaysAgo: 30, resetDaysAgo: 20 }),
    ]);
    expect(restarted.progressReads).toBe(1);
    expect(restarted.entries[0]).toMatchObject({
      aired: 10,
      completed: 0,
      nextEpisode: { number: 1 },
    });
    const caughtUp = await coldSync([
      played(1, 10, 10, { lastWatchedDaysAgo: 30, resetDaysAgo: 100 }),
    ]);
    expect(caughtUp.progressReads).toBe(0);
    expect(caughtUp.entries[0]).toMatchObject({ completed: 10, nextEpisode: null });
  });

  it("reads a show with more plays than aired episodes instead of calling it caught up", async () => {
    const { entries, progressReads } = await coldSync([
      played(1, 14, 12, { watchedRow: { aired_episodes: 10 } }),
    ]);
    expect(progressReads).toBe(1);
    expect(entries[0]?.nextEpisode).toMatchObject({ number: 13 });
  });

  it("ranks a show Trakt never stamped as watched last for the budget", async () => {
    const unstamped = played(1, 10, 8, {
      lastWatchedDaysAgo: 0,
      watchedRow: { last_watched_at: null },
    });
    const others = Array.from({ length: BUDGET }, (_, i) => played(i + 2, 10, 8));
    const { entries, progressReads } = await coldSync([unstamped, ...others]);
    expect(progressReads).toBe(BUDGET);
    expect(entries.find((entry) => entry.showId === 1)?.nextEpisode).toBeNull();
  });
});
