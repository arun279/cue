/**
 * The strip renders the contract and decides nothing. What it has to prove here
 * is the wiring the contract cannot: the durable queue depth (a mark deferred
 * offline sits in the op-log with nothing in flight and is still pending), the
 * shared rate-limit pause published by the read pool, and the Retry button
 * appearing only when there is something for the user to retry.
 */

import type { TraktResult } from "@cue/core/data/trakt/client";
import {
  readsPausedUntil,
  resetReadPause,
  withReadRateRetry,
} from "@cue/core/data/trakt/read-budget";
import type { QueryStatus } from "@cue/core/hooks/query-freshness";
import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { SyncStrip } from "@ui/app-shell/SyncStrip";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "./_mount";

let queueDepth = 0;
const runtime = { pendingWrites: () => queueDepth } as unknown as CueRuntime;

const healthy: QueryStatus = {
  isLoading: false,
  isFetching: false,
  isError: false,
  hasData: true,
  syncedAt: 0,
  failure: null,
  retrying: false,
};

function mountStrip(status: QueryStatus = healthy, onRetry?: () => void): void {
  mount(
    <RuntimeProvider value={runtime}>
      <SyncStrip status={status} onRetry={onRetry} />
    </RuntimeProvider>,
  );
}

const strip = (): HTMLElement | null => document.querySelector("[data-testid='sync-strip']");

/** Open the shared read pause the way the pool does: one rate-limited read. Its
 * own retries sleep on the fake clock, which is the state under test. */
async function rateLimitReads(retryAfterMs: number): Promise<void> {
  await act(async () => {
    void withReadRateRetry(
      () =>
        Promise.resolve({
          ok: false,
          error: { kind: "rate-limited", retryAfterMs },
        }) as Promise<TraktResult<never>>,
    );
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  queueDepth = 0;
  resetReadPause();
});

afterEach(() => {
  vi.useRealTimers();
  resetReadPause();
});

describe("SyncStrip", () => {
  it("is silent while sync is healthy", () => {
    mountStrip();
    expect(strip()).toBeNull();
  });

  it("surfaces ≥3 durable ops after the grace window, with the will-sync copy", () => {
    queueDepth = 3;
    mountStrip();
    // Inside the grace window a burst stays silent.
    expect(strip()).toBeNull();
    act(() => vi.advanceTimersByTime(5100));
    expect(strip()?.getAttribute("data-state")).toBe("pending");
    expect(strip()?.textContent).toContain("3 marks pending · will sync");
  });

  it("stays silent below the threshold", () => {
    queueDepth = 2;
    mountStrip();
    act(() => vi.advanceTimersByTime(6000));
    expect(strip()).toBeNull();
  });

  it("clears once a background flush drains the queue, with no in-flight signal", () => {
    queueDepth = 4;
    mountStrip();
    act(() => vi.advanceTimersByTime(5100));
    expect(strip()).not.toBeNull();
    // A poll/reconnect flush drains the log without any submit bracketing;
    // the strip's own coarse re-sample must notice.
    queueDepth = 0;
    act(() => vi.advanceTimersByTime(1100));
    expect(strip()).toBeNull();
  });

  it("reads the shared rate-limit pause, names it, and offers no Retry", async () => {
    await rateLimitReads(3000);
    const retry = vi.fn();
    mountStrip({ ...healthy, failure: { kind: "rate-limited", retryAfterMs: 3000 } }, retry);

    expect(strip()?.getAttribute("data-state")).toBe("rate-limited");
    expect(strip()?.textContent).toContain("Trakt is limiting requests.");
    expect(strip()?.textContent).not.toContain("unreachable");
    // Nothing for the user to do: the pool is holding every read until it lifts.
    expect(strip()?.querySelector(".sync-strip__retry")).toBeNull();
  });

  it("retracts on its own once the pause lifts", async () => {
    await rateLimitReads(3000);
    mountStrip();
    expect(strip()).not.toBeNull();
    act(() => vi.advanceTimersByTime(3100));
    expect(strip()).toBeNull();
  });

  it("offers Retry only for a settled failure over cached content", () => {
    const retry = vi.fn();
    mountStrip({ ...healthy, isError: true, failure: { kind: "network" } }, retry);
    expect(strip()?.getAttribute("data-state")).toBe("unreachable");
    expect(strip()?.textContent).toContain("Can't reach Trakt. Showing your cached data.");
    strip()?.querySelector<HTMLButtonElement>(".sync-strip__retry")?.click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("leaves the pause at zero when nothing rate limited anything", () => {
    mountStrip();
    expect(readsPausedUntil()).toBe(0);
    expect(strip()).toBeNull();
  });
});
