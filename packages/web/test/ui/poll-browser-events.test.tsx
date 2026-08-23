/**
 * The web adapters wired into the poll, driven by real browser events.
 *
 * Every other test of `useActivitiesPoll` fires an injected port by hand, which
 * is the right shape for the gating rules but leaves the binding from the
 * events the browser actually fires to the poll asserted at no layer. This suite
 * owns exactly that binding: `visibilitychange`, `online` and `offline` through
 * `webAppVisibility` and `webNetwork`, with nothing stubbed between them.
 */

import { useActivitiesPoll } from "@cue/core/hooks/useActivitiesPoll";
import { AppVisibilityProvider } from "@cue/core/runtime/app-visibility";
import { NetworkProvider } from "@cue/core/runtime/network";
import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { webAppVisibility } from "@platform/app-visibility";
import { webNetwork } from "@platform/network";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountAsync } from "./_mount";

function Probe(): null {
  useActivitiesPoll();
  return null;
}

function stubRuntime(pending: number): {
  runtime: CueRuntime;
  flushWrites: ReturnType<typeof vi.fn>;
  pollActivities: ReturnType<typeof vi.fn>;
} {
  const flushWrites = vi.fn(() => Promise.resolve(0));
  const pollActivities = vi.fn(() => Promise.resolve(null));
  return {
    runtime: {
      pendingWrites: () => pending,
      flushWrites,
      pollActivities,
    } as unknown as CueRuntime,
    flushWrites,
    pollActivities,
  };
}

const setVisibility = (state: DocumentVisibilityState): void => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
};
const setOnline = (value: boolean): void => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
};

const mountPoll = (runtime: CueRuntime): Promise<void> =>
  mountAsync(
    <AppVisibilityProvider value={webAppVisibility}>
      <NetworkProvider value={webNetwork}>
        <QueryClientProvider client={new QueryClient()}>
          <RuntimeProvider value={runtime}>
            <Probe />
          </RuntimeProvider>
        </QueryClientProvider>
      </NetworkProvider>
    </AppVisibilityProvider>,
  );

const fire = async (target: EventTarget, type: string): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new Event(type));
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the browser's own events reaching the freshness poll", () => {
  it("does not poll while the tab is hidden", async () => {
    setVisibility("hidden");
    setOnline(true);
    const stub = stubRuntime(0);
    await mountPoll(stub.runtime);
    expect(stub.pollActivities).not.toHaveBeenCalled();
  });

  it("polls when the tab comes back to the front", async () => {
    setVisibility("hidden");
    setOnline(true);
    const stub = stubRuntime(0);
    await mountPoll(stub.runtime);

    setVisibility("visible");
    await fire(document, "visibilitychange");
    expect(stub.pollActivities).toHaveBeenCalledTimes(1);
  });

  it("lands deferred writes on a real reconnect, even from a hidden tab", async () => {
    setVisibility("hidden");
    setOnline(false);
    const stub = stubRuntime(1);
    await mountPoll(stub.runtime);
    expect(stub.flushWrites).not.toHaveBeenCalled();

    setOnline(true);
    await fire(window, "online");
    expect(stub.flushWrites).toHaveBeenCalledTimes(1);
    expect(stub.pollActivities).not.toHaveBeenCalled();
  });

  it("attempts nothing when the same subscription hears the tab go offline", async () => {
    setVisibility("visible");
    setOnline(true);
    const stub = stubRuntime(1);
    await mountPoll(stub.runtime);
    stub.flushWrites.mockClear();

    setOnline(false);
    await fire(window, "offline");
    expect(stub.flushWrites).not.toHaveBeenCalled();
  });
});
