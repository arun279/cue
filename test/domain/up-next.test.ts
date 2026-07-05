import { countToWatch, selectUpNext } from "@domain/up-next";
import { describe, expect, it } from "vitest";
import { DAY, iso, makeEpisode, makeShow, NOW } from "./_helpers";

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
    const queue = selectUpNext(shows, NOW);
    expect(queue.map((i) => i.showId)).toEqual([1]);
  });

  it("treats an unknown air date as not-yet-aired (excluded)", () => {
    const shows = [makeShow({ nextEpisode: makeEpisode({ firstAired: null }) })];
    expect(selectUpNext(shows, NOW)).toHaveLength(0);
  });

  it("reports backlog as aired minus completed, floored at 0", () => {
    const shows = [
      makeShow({ showId: 1, aired: 10, completed: 3, nextEpisode: airedYesterday }),
      makeShow({ showId: 2, aired: 4, completed: 9, nextEpisode: airedYesterday }),
    ];
    const queue = selectUpNext(shows, NOW);
    expect(queue.find((i) => i.showId === 1)?.backlog).toBe(7);
    expect(queue.find((i) => i.showId === 2)?.backlog).toBe(0);
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
    makeShow({ showId: 3, title: "Bravo", lastWatchedAt: null, nextEpisode: airedYesterday }),
  ];

  it("recently-watched: most recent first, null last, tiebreak air date asc", () => {
    expect(selectUpNext(shows, NOW, "recently-watched").map((i) => i.showId)).toEqual([2, 1, 3]);
  });

  it("air-date: first_aired ascending", () => {
    expect(selectUpNext(shows, NOW, "air-date").map((i) => i.showId)).toEqual([1, 2, 3]);
  });

  it("alphabetical: by title, case-insensitive", () => {
    expect(selectUpNext(shows, NOW, "alphabetical").map((i) => i.title)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  it("recently-watched tiebreak falls through to air date when both dates equal", () => {
    const tied = [
      makeShow({ showId: 1, lastWatchedAt: null, nextEpisode: airedYesterday }),
      makeShow({ showId: 2, lastWatchedAt: null, nextEpisode: airedWeekAgo }),
    ];
    expect(selectUpNext(tied, NOW, "recently-watched").map((i) => i.showId)).toEqual([2, 1]);
  });
});

describe("countToWatch", () => {
  it("sums aired-unwatched over non-hidden shows only", () => {
    const shows = [
      makeShow({ aired: 10, completed: 4, hidden: false }),
      makeShow({ aired: 10, completed: 10, hidden: false }),
      makeShow({ aired: 20, completed: 0, hidden: true }),
    ];
    expect(countToWatch(shows)).toBe(6);
  });
});
