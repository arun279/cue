import { selectUpNext } from "@domain/up-next";
import { computeWatchStatus } from "@domain/watch-status";
import { describe, expect, it } from "vitest";
import { DAY, iso, makeEpisode, makeShow, NOW, THRESHOLD } from "./_helpers";

const airedYesterday = makeEpisode({ firstAired: iso(NOW - DAY) });
const airedWeekAgo = makeEpisode({ firstAired: iso(NOW - 7 * DAY) });
const future = makeEpisode({ firstAired: iso(NOW + DAY) });

describe("selectUpNext filtering", () => {
  it("excludes hidden, caught-up (null), and future next episodes", () => {
    const shows = [
      makeShow({ showId: 1, title: "Aired", nextEpisode: airedYesterday }),
      makeShow({ showId: 2, title: "Hidden", hidden: true, nextEpisode: airedYesterday }),
      makeShow({ showId: 3, title: "CaughtUp", nextEpisode: null }),
      makeShow({ showId: 4, title: "Future", nextEpisode: future }),
    ];
    const queue = selectUpNext(shows, NOW, THRESHOLD);
    expect(queue.map((i) => i.showId)).toEqual([1]);
  });

  it("treats an unknown air date as not-yet-aired (excluded)", () => {
    const shows = [makeShow({ nextEpisode: makeEpisode({ firstAired: null }) })];
    expect(selectUpNext(shows, NOW, THRESHOLD)).toHaveLength(0);
  });

  it("reports backlog as aired minus completed, floored at 0", () => {
    const shows = [
      makeShow({ showId: 1, aired: 10, completed: 3, nextEpisode: airedYesterday }),
      makeShow({ showId: 2, aired: 4, completed: 9, nextEpisode: airedYesterday }),
    ];
    const queue = selectUpNext(shows, NOW, THRESHOLD);
    expect(queue.find((i) => i.showId === 1)?.backlog).toBe(7);
    expect(queue.find((i) => i.showId === 2)?.backlog).toBe(0);
  });

  it("matches the watch-status watching set", () => {
    const shows = [
      makeShow({ showId: 1, hidden: true, completed: 10, aired: 10, nextEpisode: airedYesterday }),
      makeShow({ showId: 2, completed: 0, inWatchlist: true, nextEpisode: airedYesterday }),
      makeShow({
        showId: 3,
        completed: 10,
        aired: 10,
        status: "Ended",
        nextEpisode: airedYesterday,
      }),
      makeShow({
        showId: 4,
        completed: 10,
        aired: 10,
        status: "returning series",
        nextEpisode: future,
      }),
      makeShow({
        showId: 5,
        completed: 5,
        aired: 10,
        nextEpisode: airedYesterday,
        lastWatchedAt: iso(NOW - THRESHOLD - 1),
      }),
      makeShow({
        showId: 6,
        completed: 5,
        aired: 10,
        nextEpisode: airedYesterday,
        lastWatchedAt: null,
      }),
      makeShow({
        showId: 7,
        completed: 5,
        aired: 10,
        nextEpisode: airedYesterday,
        lastWatchedAt: iso(NOW - DAY),
      }),
    ];
    expect(new Set(selectUpNext(shows, NOW, THRESHOLD).map((i) => i.showId))).toEqual(
      new Set(
        shows
          .filter((show) => computeWatchStatus(show, NOW, THRESHOLD) === "watching")
          .map((show) => show.showId),
      ),
    );
  });
});

describe("selectUpNext ordering", () => {
  const shows = [
    makeShow({
      showId: 1,
      title: "Charlie",
      lastWatchedAt: iso(NOW - 2 * DAY),
      nextEpisode: airedWeekAgo,
    }),
    makeShow({
      showId: 2,
      title: "Alpha",
      lastWatchedAt: iso(NOW - DAY),
      nextEpisode: airedYesterday,
    }),
    makeShow({
      showId: 3,
      title: "Bravo",
      lastWatchedAt: iso(NOW - 3 * DAY),
      nextEpisode: airedYesterday,
    }),
  ];

  it("recently-watched: most recent first, tiebreak air date asc", () => {
    expect(selectUpNext(shows, NOW, THRESHOLD, "recently-watched").map((i) => i.showId)).toEqual([
      2, 1, 3,
    ]);
  });

  it("air-date: first_aired ascending", () => {
    expect(selectUpNext(shows, NOW, THRESHOLD, "air-date").map((i) => i.showId)).toEqual([1, 2, 3]);
  });

  it("alphabetical: by title, case-insensitive", () => {
    expect(selectUpNext(shows, NOW, THRESHOLD, "alphabetical").map((i) => i.title)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  it("recently-watched tiebreak falls through to air date when both dates equal", () => {
    const tied = [
      makeShow({ showId: 1, lastWatchedAt: iso(NOW - DAY), nextEpisode: airedYesterday }),
      makeShow({ showId: 2, lastWatchedAt: iso(NOW - DAY), nextEpisode: airedWeekAgo }),
    ];
    expect(selectUpNext(tied, NOW, THRESHOLD, "recently-watched").map((i) => i.showId)).toEqual([
      2, 1,
    ]);
  });
});
