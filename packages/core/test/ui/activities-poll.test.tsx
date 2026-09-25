// @vitest-environment jsdom
/**
 * The activities poll is gated on the durable write queue: local ops flush
 * BEFORE the freshness check, and a reconcile never applies while ops remain
 * (it would repaint server state missing the local marks). Reconnect always
 * attempts a flush, even hidden; the poll itself stays visibility-gated.
 */

import { queryKeys } from "@cue/core/data/query-keys";
import { useActivitiesPoll } from "@cue/core/hooks/useActivitiesPoll";
import { type AppVisibility, AppVisibilityProvider } from "@cue/core/ports/app-visibility";
import { type Network, NetworkProvider } from "@cue/core/ports/network";
import {
  type ActivitiesReconcile,
  type CueRuntime,
  RuntimeProvider,
} from "@cue/core/runtime/runtime";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { mount, mountAsync, unmount } from "./_mount";

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

/** Visibility and network ports whose state a test flips by hand. */
function devicePorts() {
  let visible = true;
  let online = true;
  const watchers = { visibility: new Set<() => void>(), network: new Set<() => void>() };
  const subscribeTo = (listeners: Set<() => void>) => (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const announce = (listeners: Set<() => void>): void => {
    for (const listener of listeners) listener();
  };
  const visibility: AppVisibility = {
    isVisible: () => visible,
    subscribe: subscribeTo(watchers.visibility),
  };
  const network: Network = { isOnline: () => online, subscribe: subscribeTo(watchers.network) };
  return {
    visibility,
    network,
    setVisible(next: boolean) {
      visible = next;
      announce(watchers.visibility);
    },
    setOnline(next: boolean) {
      online = next;
      announce(watchers.network);
    },
  };
}

function withPorts(
  device: ReturnType<typeof devicePorts>,
  runtime: CueRuntime | null,
  node: ReactNode,
) {
  const session =
    runtime === null ? node : <RuntimeProvider value={runtime}>{node}</RuntimeProvider>;
  return (
    <AppVisibilityProvider value={device.visibility}>
      <NetworkProvider value={device.network}>
        <QueryClientProvider client={new QueryClient()}>{session}</QueryClientProvider>
      </NetworkProvider>
    </AppVisibilityProvider>
  );
}

describe("useActivitiesPoll triggers", () => {
  it("polls again when the app comes back to the foreground", async () => {
    const device = devicePorts();
    const stub = stubRuntime(0);
    await mountAsync(withPorts(device, stub.runtime, <Probe />));
    await act(async () => device.setVisible(false));
    await act(async () => device.setVisible(true));
    expect(stub.pollActivities).toHaveBeenCalledTimes(2);
  });

  it("polls on reconnect in the foreground and ignores a network drop", async () => {
    const device = devicePorts();
    const stub = stubRuntime(0);
    await mountAsync(withPorts(device, stub.runtime, <Probe />));
    await act(async () => device.setOnline(false));
    expect(stub.pollActivities).toHaveBeenCalledTimes(1);
    await act(async () => device.setOnline(true));
    expect(stub.pollActivities).toHaveBeenCalledTimes(2);
  });

  it("listens to nothing before a session exists", () => {
    const device = devicePorts();
    const subscribe = vi.spyOn(device.visibility, "subscribe");
    mount(withPorts(device, null, <Probe />));
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe("useActivitiesPoll reconcile", () => {
  function reconcileRuntime(reconcile: ActivitiesReconcile): CueRuntime {
    return {
      pendingWrites: () => 0,
      flushWrites: vi.fn(),
      pollActivities: () => Promise.resolve(reconcile),
    } as unknown as CueRuntime;
  }

  it("advances the baseline once the changed reads have refreshed", async () => {
    const commit = vi.fn(() => Promise.resolve());
    await mountPoll(reconcileRuntime({ keys: [], commit }));
    expect(commit).toHaveBeenCalledOnce();
  });

  it("never advances the baseline for a session torn down mid-refresh", async () => {
    const commit = vi.fn(() => Promise.resolve());
    let finishRefetch: (() => void) | undefined;
    let reads = 0;
    function Library(): null {
      useQuery({
        queryKey: queryKeys.library(),
        queryFn: () => {
          reads += 1;
          return reads === 1
            ? Promise.resolve({ entries: [] })
            : new Promise((resolve) => {
                finishRefetch = () => resolve({ entries: [] });
              });
        },
      });
      return null;
    }
    const device = devicePorts();
    const runtime = reconcileRuntime({ keys: [queryKeys.library()], commit });
    await mountAsync(
      withPorts(
        device,
        runtime,
        <>
          <Library />
          <Probe />
        </>,
      ),
    );
    await vi.waitFor(() => expect(finishRefetch).toBeDefined());
    unmount();
    await act(async () => finishRefetch?.());
    expect(commit).not.toHaveBeenCalled();
  });
});
