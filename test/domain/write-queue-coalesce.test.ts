import { coalesce } from "@domain/write-queue/coalesce";
import { buildMarkEpisodeOp, buildUnmarkEpisodeOp } from "@domain/write-queue/ops";
import type { QueuedOp } from "@domain/write-queue/types";
import { describe, expect, it } from "vitest";

const WATCHED_AT = "2026-07-05T12:00:00.000Z";
const mark = (id: string, trakt: number): QueuedOp =>
  buildMarkEpisodeOp({ opId: id, ids: { trakt }, watchedAt: WATCHED_AT });
const unmark = (id: string, trakt: number): QueuedOp =>
  buildUnmarkEpisodeOp({ opId: id, ids: { trakt }, watchedAt: WATCHED_AT });

describe("coalesce", () => {
  it("appends an op on a fresh item key", () => {
    const next = coalesce([mark("a", 1)], mark("b", 2));
    expect(next.map((o) => o.itemKey)).toEqual(["episode:1", "episode:2"]);
  });

  it("drops a redundant op ending in the same state", () => {
    const next = coalesce([mark("a", 1)], mark("b", 1));
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("a");
  });

  it("cancels an opposite op: a toggle-untoggle vanishes", () => {
    const next = coalesce([mark("a", 1)], unmark("b", 1));
    expect(next).toEqual([]);
  });

  it("leaves unrelated pending ops untouched when cancelling", () => {
    const pending = [mark("a", 1), mark("b", 2)];
    const next = coalesce(pending, unmark("c", 1));
    expect(next.map((o) => o.itemKey)).toEqual(["episode:2"]);
  });
});
