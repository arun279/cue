import type { UpNextItem } from "@domain/up-next";
import { sortLapsed, sortQueue, stabilizePendingAdvance } from "@ui/hooks/queue-order";
import { describe, expect, it } from "vitest";

function item(
  showId: number,
  firstAired: string | null,
  lastWatchedAt: string | null,
  provisional = false,
): UpNextItem {
  return {
    showId,
    title: `Show ${showId}`,
    episode: {
      season: 1,
      number: 1,
      title: null,
      firstAired,
      still: null,
      ids: { trakt: provisional ? 0 : showId },
    },
    lastWatchedAt,
    backlog: 1,
  };
}

const oldest = item(1, "2026-01-01T00:00:00Z", "2026-07-01T00:00:00Z");
const middle = item(2, "2026-05-01T00:00:00Z", "2026-07-10T00:00:00Z");
const newest = item(3, "2026-07-10T00:00:00Z", "2026-06-01T00:00:00Z");

describe("sortQueue", () => {
  it("oldest-unwatched leads with the longest-waiting next episode", () => {
    const sorted = sortQueue([newest, oldest, middle], "oldest-unwatched");
    expect(sorted.map((i) => i.showId)).toEqual([1, 2, 3]);
  });

  it("after-last-watched leads with the user's own recency", () => {
    const sorted = sortQueue([newest, oldest, middle], "after-last-watched");
    expect(sorted.map((i) => i.showId)).toEqual([2, 1, 3]);
  });

  it("keeps a just-marked provisional projection (no air date) at the head of oldest-unwatched", () => {
    const provisional = item(4, null, "2026-07-12T00:00:00Z", true);
    const sorted = sortQueue([newest, provisional, oldest], "oldest-unwatched");
    expect(sorted[0]?.showId).toBe(4);
  });

  it("never mutates its input", () => {
    const input = [newest, oldest];
    sortQueue(input, "oldest-unwatched");
    expect(input.map((i) => i.showId)).toEqual([3, 1]);
  });
});

describe("sortLapsed", () => {
  const unknown = item(4, "2026-03-01T00:00:00Z", null);

  it("orders recently watched first by default preference", () => {
    expect(sortLapsed([oldest, middle, unknown], "recently-watched").map((i) => i.showId)).toEqual([
      2, 1, 4,
    ]);
  });

  it("orders longest idle first", () => {
    expect(sortLapsed([oldest, middle, unknown], "longest-idle").map((i) => i.showId)).toEqual([
      4, 1, 2,
    ]);
  });

  it("places unknown last watched last for recently watched and first for longest idle", () => {
    expect(sortLapsed([oldest, unknown], "recently-watched")[1]?.showId).toBe(4);
    expect(sortLapsed([oldest, unknown], "longest-idle")[0]?.showId).toBe(4);
  });

  it("does not mutate its input", () => {
    const input = [middle, oldest];
    sortLapsed(input, "longest-idle");
    expect(input.map((i) => i.showId)).toEqual([2, 1]);
  });
});

describe("stabilizePendingAdvance", () => {
  it("pins a just-marked row to the slot it held before the mark", () => {
    const marked = item(2, null, "2026-07-12T00:00:00Z", true);
    const isPending = (showId: number): boolean => showId === marked.showId;
    // The sort would promote the provisional row to the head…
    const sorted = [marked, oldest, newest];
    // …but it held slot 1 before the mark, so it stays there.
    const stable = stabilizePendingAdvance(sorted, [1, 2, 3], isPending);
    expect(stable.map((i) => i.showId)).toEqual([1, 2, 3]);
  });

  it("keeps the sorted slot when the previous order is unknown", () => {
    const marked = item(4, null, "2026-07-12T00:00:00Z", true);
    const stable = stabilizePendingAdvance(
      [oldest, marked, newest],
      [],
      (showId) => showId === marked.showId,
    );
    expect(stable.map((i) => i.showId)).toEqual([1, 4, 3]);
  });

  it("leaves an all-authoritative queue untouched", () => {
    const stable = stabilizePendingAdvance([oldest, middle], [2, 1], () => false);
    expect(stable.map((i) => i.showId)).toEqual([1, 2]);
  });

  it("pins a pending row whose season tree already supplied a real episode id", () => {
    const marked = item(2, "2026-07-12T00:00:00Z", "2026-07-12T00:00:00Z");
    const stable = stabilizePendingAdvance(
      [oldest, newest, marked],
      [1, 2, 3],
      (showId) => showId === marked.showId,
    );
    expect(stable.map((i) => i.showId)).toEqual([1, 2, 3]);
  });
});
