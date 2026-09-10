import { groupLibrary } from "@cue/core/domain/library-buckets";
import type { WatchStatus } from "@cue/core/domain/watch-status";
import { describe, expect, it } from "vitest";
import { airedNext, DAY, futureNext, iso, makeShow, NOW, THRESHOLD } from "./_helpers";

/** One show per bucket; the idle (formerly "lapsed") show folds into Watching, and
 * hidden must land in Stopped (abandoned) only. */
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
    // Watchlist(not-started) first; the idle show folds into a single Watching segment.
    expect(statusesOf(mixedLibrary())).toEqual([
      "not-started",
      "watching",
      "caught-up",
      "ended",
      "abandoned",
    ]);
  });

  it("folds an idle (lapsed) show into the single Watching segment", () => {
    const buckets = groupLibrary(mixedLibrary(), NOW, THRESHOLD, "recently-watched");
    const watching = buckets.find((bucket) => bucket.status === "watching");
    expect(watching?.shows.map((s) => s.showId).sort()).toEqual([1, 2]);
    expect(buckets.some((bucket) => bucket.status === "lapsed")).toBe(false);
  });

  it("places a hidden show only in the Stopped (abandoned) bucket and nowhere else", () => {
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

  it("buckets a fully-watched ended show as Finished, never Watching or Stopped", () => {
    const finished = makeShow({
      showId: 42,
      title: "Wrapped",
      status: "ended",
      completed: 10,
      aired: 10,
      nextEpisode: null,
      lastWatchedAt: iso(NOW - DAY),
    });
    const buckets = groupLibrary([finished], NOW, THRESHOLD, "recently-watched");
    expect(buckets.map((b) => b.status)).toEqual(["ended"]);
    expect(buckets[0]?.shows.map((s) => s.showId)).toEqual([42]);
    for (const bucket of buckets) {
      if (bucket.status === "ended") continue;
      expect(bucket.shows.some((s) => s.showId === 42)).toBe(false);
    }
  });

  it("buckets a beyond-budget show with backlog into Watching, never Caught up", () => {
    // A tail show the progress budget skipped: real counts from the bulk read but
    // no next episode named. Unwatched aired episodes make it in-progress; the
    // missing next episode must not fabricate it into the caught-up pile.
    const tail = makeShow({
      showId: 99,
      title: "Tail",
      completed: 3,
      aired: 10,
      nextEpisode: null,
    });
    const caughtUp = makeShow({
      showId: 7,
      title: "Done",
      completed: 10,
      aired: 10,
      status: "returning series",
      nextEpisode: null,
    });
    const buckets = groupLibrary([tail, caughtUp], NOW, THRESHOLD, "recently-watched");
    expect(buckets.map((b) => b.status)).toEqual(["watching", "caught-up"]);
    const watching = buckets.find((b) => b.status === "watching");
    expect(watching?.shows.map((s) => s.showId)).toEqual([99]);
    const done = buckets.find((b) => b.status === "caught-up");
    expect(done?.shows.some((s) => s.showId === 99)).toBe(false);
  });

  it("returns no buckets for an empty library", () => {
    expect(groupLibrary([], NOW, THRESHOLD, "recently-watched")).toEqual([]);
  });
});
