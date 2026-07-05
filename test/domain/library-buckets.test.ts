import { groupLibrary } from "@domain/library-buckets";
import type { WatchStatus } from "@domain/watch-status";
import { describe, expect, it } from "vitest";
import { DAY, iso, makeEpisode, makeShow, NOW } from "./_helpers";

const futureNext = makeEpisode({ firstAired: iso(NOW + DAY) });

/** One show per aired-based bucket, plus a hidden show that must land in Stopped only. */
function mixedLibrary() {
  return [
    makeShow({ showId: 1, title: "Bravo", completed: 5, aired: 10, lastWatchedAt: iso(NOW - DAY) }),
    makeShow({
      showId: 2,
      title: "Alpha",
      completed: 10,
      aired: 10,
      status: "returning series",
      nextEpisode: null,
      lastWatchedAt: iso(NOW - 3 * DAY),
    }),
    makeShow({
      showId: 3,
      title: "Charlie",
      completed: 10,
      aired: 10,
      status: "returning series",
      nextEpisode: futureNext,
    }),
    makeShow({
      showId: 4,
      title: "Delta",
      completed: 10,
      aired: 10,
      status: "ended",
      nextEpisode: null,
    }),
    makeShow({ showId: 5, title: "Echo", hidden: true, completed: 3, aired: 10, status: "ended" }),
  ];
}

function statusesOf(shows: ReturnType<typeof mixedLibrary>): WatchStatus[] {
  return groupLibrary(shows, NOW, "recently-watched").map((bucket) => bucket.status);
}

describe("groupLibrary", () => {
  it("groups a mixed library into the canonical display order, omitting empty buckets", () => {
    expect(statusesOf(mixedLibrary())).toEqual([
      "watching",
      "up-to-date",
      "coming-soon",
      "ended",
      "stopped",
    ]);
  });

  it("places a hidden show only in Stopped and nowhere else", () => {
    const buckets = groupLibrary(mixedLibrary(), NOW, "recently-watched");
    const stopped = buckets.find((bucket) => bucket.status === "stopped");
    expect(stopped?.shows.map((s) => s.showId)).toEqual([5]);
    for (const bucket of buckets) {
      if (bucket.status === "stopped") continue;
      expect(bucket.shows.some((s) => s.showId === 5)).toBe(false);
    }
  });

  it("sorts alphabetically within a bucket, case-insensitively", () => {
    const shows = [
      makeShow({ showId: 1, title: "banana", completed: 1, aired: 5 }),
      makeShow({ showId: 2, title: "Apple", completed: 1, aired: 5 }),
      makeShow({ showId: 3, title: "cherry", completed: 1, aired: 5 }),
    ];
    const watching = groupLibrary(shows, NOW, "alphabetical")[0];
    expect(watching?.shows.map((s) => s.title)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("sorts by progress ratio descending", () => {
    const shows = [
      makeShow({ showId: 1, title: "Low", completed: 1, aired: 10 }),
      makeShow({ showId: 2, title: "High", completed: 9, aired: 10 }),
      makeShow({ showId: 3, title: "Mid", completed: 5, aired: 10 }),
    ];
    const watching = groupLibrary(shows, NOW, "progress")[0];
    expect(watching?.shows.map((s) => s.title)).toEqual(["High", "Mid", "Low"]);
  });

  it("sorts by most-recently-watched, treating an unknown last-watch as oldest", () => {
    const shows = [
      makeShow({
        showId: 1,
        title: "Old",
        completed: 1,
        aired: 5,
        lastWatchedAt: iso(NOW - 5 * DAY),
      }),
      makeShow({ showId: 2, title: "New", completed: 1, aired: 5, lastWatchedAt: iso(NOW - DAY) }),
      makeShow({ showId: 3, title: "Never", completed: 1, aired: 5, lastWatchedAt: null }),
    ];
    const watching = groupLibrary(shows, NOW, "recently-watched")[0];
    expect(watching?.shows.map((s) => s.title)).toEqual(["New", "Old", "Never"]);
  });

  it("returns no buckets for an empty library", () => {
    expect(groupLibrary([], NOW, "recently-watched")).toEqual([]);
  });
});
