// @vitest-environment jsdom

import { onlineManager } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraktResult } from "@/core/data/trakt/client";
import { resetReadPause, withReadRateRetry } from "@/core/data/trakt/read-budget";
import { useSyncBanner } from "@/core/hooks/useSyncBanner";
import type { QueryStatus } from "@/core/queries/freshness";
import { RuntimeProvider } from "@/core/runtime/runtime";
import { useSyncActivity } from "@/core/stores/sync-activity-store";
import { partialRuntime } from "../support/runtime";

const fresh: QueryStatus = {
  isLoading: false,
  isFetching: false,
  isError: false,
  hasData: true,
  syncedAt: 0,
  failure: null,
  retrying: false,
};

function mountBanner(
  wrapper?: (props: { readonly children: ReactNode }) => ReactNode,
): () => string | null {
  const { result } = renderHook(() => useSyncBanner(fresh), { wrapper });
  return () => result.current?.message ?? null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  onlineManager.setOnline(true);
  resetReadPause();
  vi.useRealTimers();
});

describe("useSyncBanner", () => {
  it("says the device is offline until it reconnects", () => {
    onlineManager.setOnline(false);
    const message = mountBanner();
    expect(message()).toBe("Offline. Your marks are saved.");

    act(() => onlineManager.setOnline(true));
    expect(message()).toBeNull();
  });

  it("counts a shared rate-limit pause down to silence", async () => {
    const message = mountBanner();
    const read = vi
      .fn<() => Promise<TraktResult<number>>>()
      .mockResolvedValueOnce({ ok: false, error: { kind: "rate-limited", retryAfterMs: 2000 } })
      .mockResolvedValue({ ok: true, data: 1, pagination: null });
    await act(async () => {
      void withReadRateRetry(read);
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
    const runtime = partialRuntime({ pendingWrites: () => queued });
    const message = mountBanner(({ children }) => (
      <RuntimeProvider value={runtime}>{children}</RuntimeProvider>
    ));
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
