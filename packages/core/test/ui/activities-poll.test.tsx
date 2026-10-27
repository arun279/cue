// @vitest-environment jsdom
/**
 * The activities poll is gated on the durable write queue: local ops flush
 * BEFORE the freshness check, and a reconcile never applies while ops remain
 * (it would repaint server state missing the local marks). It runs on TanStack
 * Query's interval, focus and reconnect triggers, so it waits while the device
 * is offline and stops while the app is in the background. Reconnect still
 * flushes pending ops in the background, without polling.
 */

import { queryKeys } from "@cue/core/data/query-keys";
import { useActivitiesPoll } from "@cue/core/hooks/useActivitiesPoll";
import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { createQueryClient } from "@cue/core/runtime/query-cache";
import type { ActivitiesReconcile, CueRuntime } from "@cue/core/runtime/runtime";
import { useSyncActivity } from "@cue/core/stores/sync-activity-store";
import { focusManager, onlineManager, useQuery } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { partialRuntime, withRuntime } from "../support/runtime";

function Poll(): null {
  useActivitiesPoll();
  return null;
}

interface Stub {
  readonly runtime: CueRuntime;
  readonly pendingWrites: ReturnType<typeof vi.fn>;
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
  const pendingWrites = vi.fn(() => depth);
  const runtime = partialRuntime({ pendingWrites, flushWrites, pollActivities });
  return { runtime, pendingWrites, flushWrites, pollActivities };
}

async function mountPoll(runtime: CueRuntime, node: ReactNode = <Poll />): Promise<void> {
  render(node, { wrapper: withRuntime(runtime, createQueryClient()) });
  await act(async () => {});
}

const setOnline = (online: boolean) => act(async () => onlineManager.setOnline(online));
const setFocused = (focused: boolean) => act(async () => focusManager.setFocused(focused));

afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

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
    expect(stub.flushWrites.mock.invocationCallOrder[0]).toBeLessThan(
      stub.pollActivities.mock.invocationCallOrder[0] as number,
    );
  });

  it("skips the reconcile cycle entirely while ops stay pending", async () => {
    const stub = stubRuntime(2, 2);
    await mountPoll(stub.runtime);
    expect(stub.flushWrites).toHaveBeenCalledTimes(1);
    expect(stub.pollActivities).not.toHaveBeenCalled();
    expect(useSyncActivity.getState().checked).toBe(false);
  });

  it("marks the session checked once a poll has run, and unchecked when the session ends", async () => {
    const stub = stubRuntime(0);
    await mountPoll(stub.runtime);
    expect(useSyncActivity.getState().checked).toBe(true);

    cleanup();
    expect(useSyncActivity.getState().checked).toBe(false);
  });

  it("flushes on reconnect in the background, without polling", async () => {
    onlineManager.setOnline(false);
    focusManager.setFocused(false);
    const stub = stubRuntime(1, 0);
    await mountPoll(stub.runtime);
    expect(stub.flushWrites).not.toHaveBeenCalled();

    await setOnline(true);
    expect(stub.flushWrites).toHaveBeenCalledTimes(1);
    expect(stub.pollActivities).not.toHaveBeenCalled();
  });

  it("flushes once when the device reconnects in the foreground", async () => {
    onlineManager.setOnline(false);
    let depth = 1;
    const flushWrites = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      depth = 0;
      return depth;
    });
    const pollActivities = vi.fn(() => Promise.resolve(null));
    await mountPoll(
      partialRuntime({
        pendingWrites: () => depth,
        flushWrites,
        pollActivities,
      }),
    );

    await setOnline(true);
    await vi.waitFor(() => expect(pollActivities).toHaveBeenCalledOnce());
    expect(flushWrites).toHaveBeenCalledOnce();
  });
});

describe("useActivitiesPoll triggers", () => {
  it("does not poll when the connection returns while the app is in the background", async () => {
    const stub = stubRuntime(0);
    await mountPoll(stub.runtime);
    await setFocused(false);
    await setOnline(false);
    await setOnline(true);
    expect(stub.pollActivities).toHaveBeenCalledTimes(1);
  });

  it("does not poll while offline, and polls once the device reconnects", async () => {
    onlineManager.setOnline(false);
    const stub = stubRuntime(0);
    await mountPoll(stub.runtime);
    expect(stub.pollActivities).not.toHaveBeenCalled();

    await setOnline(true);
    expect(stub.pollActivities).toHaveBeenCalledTimes(1);
  });

  it("polls on reconnect in the foreground and ignores a network drop", async () => {
    const stub = stubRuntime(0);
    await mountPoll(stub.runtime);
    await setOnline(false);
    expect(stub.pollActivities).toHaveBeenCalledTimes(1);
    await setOnline(true);
    expect(stub.pollActivities).toHaveBeenCalledTimes(2);
  });

  it("polls every minute in the foreground, stops in the background, and polls on return", async () => {
    vi.useFakeTimers();
    const stub = stubRuntime(0);
    await mountPoll(stub.runtime);
    const elapse = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    expect(stub.pollActivities).toHaveBeenCalledTimes(1);

    await elapse(60_000);
    expect(stub.pollActivities).toHaveBeenCalledTimes(2);

    await setFocused(false);
    const checks = stub.pendingWrites.mock.calls.length;
    await elapse(5 * 60_000);
    expect(stub.pollActivities).toHaveBeenCalledTimes(2);
    expect(stub.pendingWrites).toHaveBeenCalledTimes(checks);

    await setFocused(true);
    await elapse(0);
    expect(stub.pollActivities).toHaveBeenCalledTimes(3);
    await elapse(60_000);
    expect(stub.pollActivities).toHaveBeenCalledTimes(4);
  });
});

describe("useActivitiesPoll reconcile", () => {
  function reconcileRuntime(reconcile: ActivitiesReconcile): CueRuntime {
    return partialRuntime({
      pendingWrites: () => 0,
      pendingOps: () => [],
      flushWrites: vi.fn(),
      pollActivities: () => Promise.resolve(reconcile),
    });
  }

  it("advances the baseline once the changed reads have refreshed", async () => {
    const commit = vi.fn(() => Promise.resolve());
    await mountPoll(reconcileRuntime({ keys: [], commit }));
    expect(commit).toHaveBeenCalledOnce();
  });

  it("advances the baseline past a changed read that no screen has enabled", async () => {
    const commit = vi.fn(() => Promise.resolve());
    function DisabledLibrary(): null {
      useQuery({ queryKey: queryKeys.library(), queryFn: vi.fn(), enabled: false });
      return null;
    }
    await mountPoll(
      reconcileRuntime({ keys: [queryKeys.library()], commit }),
      <>
        <DisabledLibrary />
        <Poll />
      </>,
    );
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
  });

  it("lets a sync the user asks for join a background pass already in flight", async () => {
    const commit = vi.fn(() => Promise.resolve());
    let answer = (_: ActivitiesReconcile) => {};
    const pollActivities = vi.fn(
      () => new Promise<ActivitiesReconcile>((resolve) => (answer = resolve)),
    );
    const sync: ReturnType<typeof useSyncNow>[] = [];
    function SyncNow(): null {
      sync[0] = useSyncNow();
      return null;
    }
    await mountPoll(
      { ...reconcileRuntime({ keys: [], commit }), pollActivities },
      <>
        <Poll />
        <SyncNow />
      </>,
    );
    expect(pollActivities).toHaveBeenCalledOnce();

    let synced: Promise<boolean> | undefined;
    await act(async () => {
      synced = sync[0]?.run();
    });
    await act(async () => answer({ keys: [], commit }));

    expect(await synced).toBe(true);
    expect(pollActivities).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it("polls once per trigger after a poll that failed", async () => {
    const commit = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("storage full"))
      .mockResolvedValue();
    const pollActivities = vi.fn(() => Promise.resolve({ keys: [], commit }));
    await mountPoll({ ...reconcileRuntime({ keys: [], commit }), pollActivities });
    await setFocused(false);
    await setFocused(true);
    expect(commit).toHaveBeenCalledTimes(2);

    await setFocused(false);
    await setFocused(true);
    expect(pollActivities).toHaveBeenCalledTimes(3);
  });

  /** A library read that fails offline at mount, a poll that answers, and a reconnect that
   * polls again; `refetch` stands in for every read after the first. */
  async function reconnectAfterFailedRead(refetch: () => Promise<unknown>) {
    let reads = 0;
    function Library(): null {
      useQuery({
        queryKey: queryKeys.library(),
        retry: false,
        queryFn: () => {
          reads += 1;
          return reads === 1 ? Promise.reject(new Error("offline")) : refetch();
        },
      });
      return null;
    }
    const commit = vi.fn(() => Promise.resolve());
    await mountPoll(
      reconcileRuntime({ keys: [], commit }),
      <>
        <Library />
        <Poll />
      </>,
    );
    await vi.waitFor(() => expect(reads).toBe(1));
    commit.mockClear();
    await setOnline(false);
    await setOnline(true);
    return { commit, reads: () => reads };
  }

  it("fetches a failed read again when Trakt answers on reconnect, though nothing changed there", async () => {
    const { reads } = await reconnectAfterFailedRead(() => Promise.resolve({ entries: [] }));
    await vi.waitFor(() => expect(reads()).toBe(2));
  });

  /** A library read held open until the test lets it land. */
  function heldRead() {
    let land: (() => void) | undefined;
    return {
      read: () =>
        new Promise((resolve) => {
          land = () => resolve({ entries: [] });
        }),
      started: () => land !== undefined,
      land: () => land?.(),
    };
  }

  async function endSessionBeforeLanding(held: ReturnType<typeof heldRead>, commit: Mock) {
    await vi.waitFor(() => expect(held.started()).toBe(true));
    cleanup();
    await act(async () => held.land());
    expect(commit).not.toHaveBeenCalled();
    expect(useSyncActivity.getState().checked).toBe(false);
  }

  it("never advances the baseline for a session torn down while a failed read is fetched again", async () => {
    const held = heldRead();
    const { commit } = await reconnectAfterFailedRead(held.read);
    await endSessionBeforeLanding(held, commit);
  });

  it("never advances the baseline or checks a session torn down mid-poll", async () => {
    const commit = vi.fn(() => Promise.resolve());
    let answer: ((reconcile: ActivitiesReconcile) => void) | undefined;
    const runtime = partialRuntime({
      pendingWrites: () => 0,
      flushWrites: vi.fn(),
      pollActivities: () =>
        new Promise<ActivitiesReconcile>((resolve) => {
          answer = resolve;
        }),
    });
    await mountPoll(runtime);
    cleanup();
    await act(async () => answer?.({ keys: [], commit }));
    expect(commit).not.toHaveBeenCalled();
    expect(useSyncActivity.getState().checked).toBe(false);
  });

  it("never advances the baseline for a session torn down mid-refresh", async () => {
    const commit = vi.fn(() => Promise.resolve());
    const held = heldRead();
    let reads = 0;
    function Library(): null {
      useQuery({
        queryKey: queryKeys.library(),
        queryFn: () => {
          reads += 1;
          return reads === 1 ? Promise.resolve({ entries: [] }) : held.read();
        },
      });
      return null;
    }
    await mountPoll(
      reconcileRuntime({ keys: [queryKeys.library()], commit }),
      <>
        <Library />
        <Poll />
      </>,
    );
    await endSessionBeforeLanding(held, commit);
  });

  it("keeps the baseline when the connection drops during the refresh, and advances it on the next poll", async () => {
    const commit = vi.fn(() => Promise.resolve());
    const reconcile = { keys: [queryKeys.library()], commit };
    let answer: ((value: ActivitiesReconcile) => void) | undefined;
    const pollActivities = vi
      .fn<() => Promise<ActivitiesReconcile>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      )
      .mockResolvedValue(reconcile);
    const read = vi.fn(() => Promise.resolve({ entries: [] }));
    function Library(): null {
      useQuery({ queryKey: queryKeys.library(), queryFn: read });
      return null;
    }
    await mountPoll(
      { ...reconcileRuntime(reconcile), pollActivities },
      <>
        <Library />
        <Poll />
      </>,
    );
    await vi.waitFor(() => expect(answer).toBeDefined());

    await setOnline(false);
    await act(async () => answer?.(reconcile));
    await vi.waitFor(() => expect(useSyncActivity.getState().checked).toBe(true));
    expect(read).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();

    await setOnline(true);
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(pollActivities).toHaveBeenCalledTimes(2);
  });
});
