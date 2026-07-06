import { groupLibrary } from "@domain/library-buckets";
import type { WatchStatus } from "@domain/watch-status";
import { describe, expect, it } from "vitest";
import { airedNext, DAY, futureNext, iso, makeShow, NOW, THRESHOLD } from "./_helpers";

/** One show per status; hidden must land in Abandoned only. */
function mixedLibrary() {
  return [
    makeShow({
      showId: 1,
      title: "Bravo",
      completed: 5,
      aired: 10,
      nextEpisode: airedNext,
      lastWatchedAt: iso(NOW - DAY),
    }),
    makeShow({
      showId: 2,
      title: "Alpha",
      completed: 5,
      aired: 10,
      nextEpisode: airedNext,
      lastWatchedAt: iso(NOW - THRESHOLD - 1),
    }),
    makeShow({ showId: 3, title: "Charlie", completed: 0, aired: 10, nextEpisode: airedNext }),
    makeShow({
      showId: 4,
      title: "Delta",
      completed: 10,
      aired: 10,
      status: "returning series",
      nextEpisode: futureNext,
    }),
    makeShow({
      showId: 5,
      title: "Echo",
      completed: 10,
      aired: 10,
      status: "ended",
      nextEpisode: null,
    }),
    makeShow({ showId: 6, title: "Foxtrot", hidden: true, completed: 3, aired: 10 }),
  ];
}

function statusesOf(shows: ReturnType<typeof mixedLibrary>): WatchStatus[] {
  return groupLibrary(shows, NOW, THRESHOLD, "recently-watched").map((bucket) => bucket.status);
}

describe("groupLibrary", () => {
  it("groups a mixed library into the canonical display order, omitting empty buckets", () => {
    expect(statusesOf(mixedLibrary())).toEqual([
      "watching",
      "lapsed",
      "not-started",
      "caught-up",
      "ended",
      "abandoned",
    ]);
  });

  it("places a hidden show only in Abandoned and nowhere else", () => {
    const buckets = groupLibrary(mixedLibrary(), NOW, THRESHOLD, "recently-watched");
    const abandoned = buckets.find((bucket) => bucket.status === "abandoned");
    expect(abandoned?.shows.map((s) => s.showId)).toEqual([6]);
    for (const bucket of buckets) {
      if (bucket.status === "abandoned") continue;
      expect(bucket.shows.some((s) => s.showId === 6)).toBe(false);
    }
  });

  it("sorts alphabetically within a bucket, case-insensitively", () => {
    const shows = [
      makeShow({ showId: 1, title: "banana", completed: 1, aired: 5 }),
      makeShow({ showId: 2, title: "Apple", completed: 1, aired: 5 }),
      makeShow({ showId: 3, title: "cherry", completed: 1, aired: 5 }),
    ];
    const watching = groupLibrary(shows, NOW, THRESHOLD, "alphabetical")[0];
    expect(watching?.shows.map((s) => s.title)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("sorts by progress ratio descending", () => {
    const shows = [
      makeShow({ showId: 1, title: "Low", completed: 1, aired: 10 }),
      makeShow({ showId: 2, title: "High", completed: 9, aired: 10 }),
      makeShow({ showId: 3, title: "Mid", completed: 5, aired: 10 }),
    ];
    const watching = groupLibrary(shows, NOW, THRESHOLD, "progress")[0];
    expect(watching?.shows.map((s) => s.title)).toEqual(["High", "Mid", "Low"]);
  });

  it("sorts by most-recently-watched, treating an unknown last-watch as oldest", () => {
    const shows = [
      makeShow({
        showId: 1,
        title: "Old",
        completed: 10,
        aired: 10,
        nextEpisode: null,
        lastWatchedAt: iso(NOW - 5 * DAY),
      }),
      makeShow({
        showId: 2,
        title: "New",
        completed: 10,
        aired: 10,
        nextEpisode: null,
        lastWatchedAt: iso(NOW - DAY),
      }),
      makeShow({
        showId: 3,
        title: "Never",
        completed: 10,
        aired: 10,
        nextEpisode: null,
        lastWatchedAt: null,
      }),
    ];
    const caughtUp = groupLibrary(shows, NOW, THRESHOLD, "recently-watched")[0];
    expect(caughtUp?.shows.map((s) => s.title)).toEqual(["New", "Old", "Never"]);
  });

  it("sorts lapsed most-lapsed-first regardless of the global sort", () => {
    const shows = [
      makeShow({
        showId: 1,
        title: "Alpha",
        nextEpisode: airedNext,
        lastWatchedAt: iso(NOW - 30 * DAY),
      }),
      makeShow({
        showId: 2,
        title: "Bravo",
        nextEpisode: airedNext,
        lastWatchedAt: iso(NOW - 40 * DAY),
      }),
      makeShow({
        showId: 3,
        title: "Charlie",
        nextEpisode: airedNext,
        lastWatchedAt: null,
      }),
    ];
    const lapsed = groupLibrary(shows, NOW, THRESHOLD, "alphabetical")[0];
    expect(lapsed?.status).toBe("lapsed");
    expect(lapsed?.shows.map((s) => s.showId)).toEqual([3, 2, 1]);
  });

  it("returns no buckets for an empty library", () => {
    expect(groupLibrary([], NOW, THRESHOLD, "recently-watched")).toEqual([]);
  });
});
