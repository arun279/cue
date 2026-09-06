import { buildAddEpisodePlayOp, buildMarkEpisodeOp } from "@cue/core/domain/write-queue/ops";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import {
  hasPendingMark,
  lockShow,
  type MarkRecord,
  registerPendingMark,
  releasePendingMark,
  resetMarkStore,
  unlockShow,
  useMarkStore,
} from "@cue/core/stores/mark-store";
import { beforeEach, describe, expect, it } from "vitest";

const WATCHED_AT = "2026-07-05T12:00:00.000Z";

function runtimeWith(pending: readonly QueuedOp[]): CueRuntime {
  return { pendingOps: () => pending } as unknown as CueRuntime;
}

function record(showId: number, opId: string): MarkRecord {
  return {
    opId,
    showId,
    title: `Show ${showId}`,
    code: "S1 E1",
    at: 1000,
    episodeIds: { trakt: showId * 10 },
    season: 1,
    number: 1,
    watchedAt: WATCHED_AT,
    preCompleted: 0,
    beforeMark: {} as MarkRecord["beforeMark"],
  };
}

beforeEach(resetMarkStore);

describe("mark store windows", () => {
  it("opens a window per show and closes only with the owning op id", () => {
    const store = useMarkStore.getState();
    store.open(record(1, "op-old"));
    store.open(record(1, "op-new")); // a newer mark replaces the show's window
    expect(useMarkStore.getState().close(1, "op-old")).toBe(false);
    expect(useMarkStore.getState().records.get(1)?.opId).toBe("op-new");
    expect(useMarkStore.getState().close(1, "op-new")).toBe(true);
    expect(useMarkStore.getState().records.size).toBe(0);
  });

  it("closes unconditionally without an op id (re-arm)", () => {
    useMarkStore.getState().open(record(2, "op-a"));
    expect(useMarkStore.getState().close(2)).toBe(true);
    expect(useMarkStore.getState().close(2)).toBe(false);
  });
});

describe("show lock", () => {
  it("is a synchronous check-and-set, released explicitly", () => {
    expect(lockShow(7)).toBe(true);
    expect(lockShow(7)).toBe(false);
    unlockShow(7);
    expect(lockShow(7)).toBe(true);
  });
});

describe("pending-mark registry", () => {
  it("reports a mark registered synchronously (the pre-persist window)", () => {
    registerPendingMark("episode:42", "op-1");
    expect(hasPendingMark(runtimeWith([]), "episode:42")).toBe(true);
    releasePendingMark("episode:42", "op-1");
    expect(hasPendingMark(runtimeWith([]), "episode:42")).toBe(false);
  });

  it("makes release idempotent by ownership: a spent mark can't clear its successor", () => {
    registerPendingMark("episode:42", "op-1");
    registerPendingMark("episode:42", "op-2"); // successor re-claims the key
    releasePendingMark("episode:42", "op-1"); // late finally of the first mark
    expect(hasPendingMark(runtimeWith([]), "episode:42")).toBe(true);
    releasePendingMark("episode:42", "op-2");
    expect(hasPendingMark(runtimeWith([]), "episode:42")).toBe(false);
  });

  it("reads a queued durable mark as pending, by itemKey", () => {
    const op = buildMarkEpisodeOp({ opId: "op-q", ids: { trakt: 42 }, watchedAt: WATCHED_AT });
    expect(hasPendingMark(runtimeWith([op]), "episode:42")).toBe(true);
    expect(hasPendingMark(runtimeWith([op]), "episode:43")).toBe(false);
  });

  it("never reads an additive play or a queued unmark as a pending mark", () => {
    const additive = buildAddEpisodePlayOp({
      opId: "op-a",
      ids: { trakt: 42 },
      watchedAt: WATCHED_AT,
    });
    const unmark: QueuedOp = {
      ...buildMarkEpisodeOp({ opId: "op-u", ids: { trakt: 42 }, watchedAt: WATCHED_AT }),
      toState: "absent",
      fromState: "present",
    };
    expect(hasPendingMark(runtimeWith([additive, unmark]), "episode:42")).toBe(false);
  });
});
