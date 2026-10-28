// @vitest-environment jsdom

import { onlineManager } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetReadPause } from "@/core/data/trakt/read-budget";
import { useSyncBanner } from "@/core/hooks/useSyncBanner";
import type { QueryStatus } from "@/core/queries/freshness";
import { type CueRuntime, RuntimeProvider } from "@/core/runtime/runtime";
import { useSyncActivity } from "@/core/stores/sync-activity-store";
import { buildRuntime } from "../data/_runtime";
import { partialRuntime } from "../support/runtime";
import { createTraktFake } from "../trakt-fake/fake.ts";

const fresh: QueryStatus = {
  isLoading: false,
  isFetching: false,
  isError: false,
  hasData: true,
  syncedAt: 0,
  failure: null,
  retrying: false,
};

const unpaused = (members: Partial<CueRuntime> = {}): CueRuntime =>
  partialRuntime({
    pendingWrites: () => 0,
    readsPausedUntil: () => 0,
    subscribeReadPause: () => () => {},
    ...members,
  });

function mountBanner(runtime: CueRuntime): () => string | null {
  const { result } = renderHook(() => useSyncBanner(fresh), {
    wrapper: ({ children }) => <RuntimeProvider value={runtime}>{children}</RuntimeProvider>,
  });
  return () => result.current?.message ?? null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  onlineManager.setOnline(true);
  resetReadPause();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useSyncBanner", () => {
  it("says the device is offline until it reconnects", () => {
    onlineManager.setOnline(false);
    const message = mountBanner(unpaused());
    expect(message()).toBe("Offline. Your marks are saved.");

    act(() => onlineManager.setOnline(true));
    expect(message()).toBeNull();
  });

  it("counts a rate-limit pause the runtime's reads hit down to silence", async () => {
    const trakt = createTraktFake();
    trakt.fail({ path: /^\/users\/settings$/ }, 429, 1);
    vi.stubGlobal("fetch", trakt.fetch);
    const runtime = await buildRuntime();
    const message = mountBanner(runtime);
    await act(async () => {
      void runtime.loadUserProfile();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(message()).toBe("Trakt is limiting requests. Retrying in 2s.");

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(message()).toBe("Trakt is limiting requests. Retrying in 1s.");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(message()).toBeNull();
  });

  it("names a write backlog only once it outlasts the grace window", async () => {
    let queued = 3;
    const message = mountBanner(unpaused({ pendingWrites: () => queued }));
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(message()).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(message()).toBe("3 marks pending · will sync");

    queued = 0;
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(message()).toBeNull();

    queued = 3;
    act(() => useSyncActivity.getState().begin());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(message()).toBeNull();
    act(() => useSyncActivity.getState().end());
  });
});
