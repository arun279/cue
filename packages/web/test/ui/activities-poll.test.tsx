/**
 * The activities poll is gated on the durable write queue: local ops flush
 * BEFORE the freshness check, and a reconcile never applies while ops remain
 * (it would repaint server state missing the local marks). Reconnect always
 * attempts a flush, even hidden; the poll itself stays visibility-gated.
 */

import { useActivitiesPoll } from "@cue/core/hooks/useActivitiesPoll";
import { type AppVisibility, AppVisibilityProvider } from "@cue/core/ports/app-visibility";
import { type Network, NetworkProvider } from "@cue/core/ports/network";
import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { mountAsync } from "./_mount";

function Probe(): null {
  useActivitiesPoll();
  return null;
}

interface Stub {
  readonly runtime: CueRuntime;
  readonly flushWrites: ReturnType<typeof vi.fn>;
  readonly pollActivities: ReturnType<typeof vi.fn>;
}

function stubRuntime(pending: number, afterFlush = 0): Stub {
  let depth = pending;
  const flushWrites = vi.fn(() => {
    depth = afterFlush;
    return Promise.resolve(depth);
  });
  const pollActivities = vi.fn(() => Promise.resolve(null));
  const runtime = {
    pendingWrites: () => depth,
    flushWrites,
    pollActivities,
  } as unknown as CueRuntime;
  return { runtime, flushWrites, pollActivities };
}

/** A port whose listeners the test fires by hand, so no global is patched. */
function controllable(initial: boolean): { port: AppVisibility & Network; announce: () => void } {
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    port: { isVisible: () => initial, isOnline: () => true, subscribe },
    announce: () => {
      for (const listener of listeners) listener();
    },
  };
}

const mountPoll = (runtime: CueRuntime, visible = true): Promise<void> =>
  mountAsync(
    <AppVisibilityProvider value={{ isVisible: () => visible, subscribe: () => () => {} }}>
      <QueryClientProvider client={new QueryClient()}>
        <RuntimeProvider value={runtime}>
          <Probe />
        </RuntimeProvider>
      </QueryClientProvider>
    </AppVisibilityProvider>,
  );

describe("useActivitiesPoll write-queue gating", () => {
  it("polls straight away when the queue is empty, without flushing", async () => {
    const stub = stubRuntime(0);
    await mountPoll(stub.runtime);
    expect(stub.flushWrites).not.toHaveBeenCalled();
    expect(stub.pollActivities).toHaveBeenCalledTimes(1);
  });

  it("flushes pending ops first, then polls once drained", async () => {
    const stub = stubRuntime(2, 0);
    await mountPoll(stub.runtime);
    expect(stub.flushWrites).toHaveBeenCalledTimes(1);
    expect(stub.pollActivities).toHaveBeenCalledTimes(1);
  });

  it("skips the reconcile cycle entirely while ops stay pending", async () => {
    const stub = stubRuntime(2, 2);
    await mountPoll(stub.runtime);
    expect(stub.flushWrites).toHaveBeenCalledTimes(1);
    expect(stub.pollActivities).not.toHaveBeenCalled();
  });

  it("flushes on reconnect even while hidden, without polling", async () => {
    const hidden = controllable(false);
    const stub = stubRuntime(1, 0);
    await mountAsync(
      <AppVisibilityProvider value={hidden.port}>
        <NetworkProvider value={hidden.port}>
          <QueryClientProvider client={new QueryClient()}>
            <RuntimeProvider value={stub.runtime}>
              <Probe />
            </RuntimeProvider>
          </QueryClientProvider>
        </NetworkProvider>
      </AppVisibilityProvider>,
    );
    expect(stub.flushWrites).not.toHaveBeenCalled(); // mount poll is visibility-gated
    await act(async () => {
      hidden.announce();
    });
    expect(stub.flushWrites).toHaveBeenCalledTimes(1);
    expect(stub.pollActivities).not.toHaveBeenCalled();
  });
});
