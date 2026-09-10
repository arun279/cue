/**
 * The shared read pool under a rate limit. Trakt's limits are per window, so a
 * 429 is a fact about the whole app rather than about one read: the pause it
 * opens is published, so the strip can say what is happening and when it
 * retries instead of inferring an outage from a read that happens to be failing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { TraktReadError, type TraktResult, unwrapRead } from "../../src/data/trakt/client";
import {
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
