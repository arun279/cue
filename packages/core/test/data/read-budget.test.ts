/**
 * The shared read pool under a rate limit. Trakt's limits are per window, so a
 * 429 is a fact about the whole app rather than about one read: the pause it
 * opens is published, so the strip can say what is happening and when it
 * retries instead of inferring an outage from a read that happens to be failing.
 */

import { DEFAULT_TRAKT_POLICY } from "@cue/core/data/trakt/policy";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TraktClient,
  TraktReadError,
  type TraktResult,
  unwrapRead,
} from "../../src/data/trakt/client";
import {
  loadUpNextEntries,
  readsPausedUntil,
  resetReadPause,
  subscribeReadPause,
  withReadRateRetry,
} from "../../src/data/trakt/read-budget";

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

/**
 * Which shows the cold sync spends a progress read on, for watched rows the
 * Trakt fake does not produce: a restarted show, more plays than aired episodes,
 * a row with no watched date, and a progress body that breaks the contract.
 */
describe("the progress read budget on unusual watched rows", () => {
  const playedAt = (i: number) => new Date(Date.UTC(2026, 0, 1) - i * 86_400_000).toISOString();
  const row = (i: number, watched: number, extra: object = {}) => ({
    last_watched_at: playedAt(i),
    reset_at: null,
    show: { title: `Show ${i}`, aired_episodes: 10, ids: { trakt: i + 1 } },
    seasons: [
      {
        number: 1,
        episodes: Array.from({ length: watched }, (_, e) => ({
          number: e + 1,
          last_watched_at: playedAt(i),
        })),
      },
    ],
    ...extra,
  });
  const next = { season: 1, number: 4, title: "Next", ids: { trakt: 4 } };

  function reading(
    rows: readonly object[],
    progress: object = { aired: 10, completed: 3, next_episode: next },
  ) {
    const reads: string[] = [];
    const fetch = async (input: string | URL | Request) => {
      const { pathname } = new URL(String(input));
      reads.push(pathname);
      const body =
        pathname === "/sync/watched/shows"
          ? rows
          : pathname.endsWith("/progress/watched")
            ? progress
            : [];
      return Response.json(body, {
        headers: { "x-pagination-page": "1", "x-pagination-page-count": "1" },
      });
    };
    const progressReads = () => reads.filter((path) => path.endsWith("/progress/watched")).length;
    return { client: new TraktClient({ clientId: "client", fetch }), progressReads };
  }

  it("reads a restarted show whose plays all predate the restart, and none once it is caught up again", async () => {
    const restarted = reading([row(0, 10, { reset_at: "2026-06-01T00:00:00.000Z" })]);
    expect((await loadUpNextEntries(restarted.client))[0]).toMatchObject({
      aired: 10,
      completed: 3,
    });
    expect(restarted.progressReads()).toBe(1);
    const caughtUp = reading([row(0, 10, { reset_at: "2020-01-01T00:00:00.000Z" })]);
    expect((await loadUpNextEntries(caughtUp.client))[0]).toMatchObject({
      completed: 10,
      nextEpisode: null,
    });
    expect(caughtUp.progressReads()).toBe(0);
  });

  it("reads a show with more plays than aired episodes instead of calling it caught up", async () => {
    const { client, progressReads } = reading([row(0, 12)]);
    expect((await loadUpNextEntries(client))[0]?.nextEpisode).not.toBeNull();
    expect(progressReads()).toBe(1);
  });

  it("ranks a show Trakt never stamped as watched last for the budget", async () => {
    const { last_watched_at: _never, ...unstamped } = row(0, 8);
    const rows = [
      unstamped,
      ...Array.from({ length: DEFAULT_TRAKT_POLICY.progressBudget }, (_, i) => row(i + 1, 8)),
    ];
    const { client, progressReads } = reading(rows);
    const entries = await loadUpNextEntries(client);
    expect(progressReads()).toBe(DEFAULT_TRAKT_POLICY.progressBudget);
    expect(entries.find((entry) => entry.showId === 1)?.nextEpisode).toBeNull();
  });

  it("fails the whole snapshot on a progress body that breaks the contract", async () => {
    await expect(loadUpNextEntries(reading([row(0, 8)], {}).client)).rejects.toThrow(
      TraktReadError,
    );
  });
});
