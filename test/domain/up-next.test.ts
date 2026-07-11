import { groupUpNext } from "@domain/up-next";
import { DEFAULT_NEW_EPISODE_WINDOW_MS } from "@domain/watch-status";
import { describe, expect, it } from "vitest";
import { DAY, iso, makeEpisode, makeShow, NOW, THRESHOLD } from "./_helpers";

const NEW_WINDOW = DEFAULT_NEW_EPISODE_WINDOW_MS;

/** Aired 1 day ago: inside the 7-day New window. */
const airedRecent = makeEpisode({ firstAired: iso(NOW - DAY) });
/** Aired 10 days ago: past the New window, so it never counts as "New". */
const airedOld = makeEpisode({ firstAired: iso(NOW - 10 * DAY) });
const future = makeEpisode({ firstAired: iso(NOW + DAY) });

function group(shows: Parameters<typeof groupUpNext>[0]) {
  return groupUpNext(shows, NOW, THRESHOLD, NEW_WINDOW);
}

describe("groupUpNext partitioning", () => {
  it("splits in-progress shows into fresh / continued / lapsed and excludes the rest", () => {
    const shows = [
      // fresh: recent activity + this week's newly-aired next.
      makeShow({
        showId: 1,
        title: "Fresh",
        nextEpisode: airedRecent,
        lastWatchedAt: iso(NOW - 2 * DAY),
      }),
      // continued: recent activity but the next episode aired outside the window.
      makeShow({
        showId: 2,
        title: "Continue",
        nextEpisode: airedOld,
        lastWatchedAt: iso(NOW - 2 * DAY),
      }),
      // lapsed: idle past the threshold, next aired outside the window.
      makeShow({
        showId: 3,
        title: "Lapsed",
        nextEpisode: airedOld,
        lastWatchedAt: iso(NOW - 30 * DAY),
      }),
      // excluded: hidden / not-started / caught-up / ended / future-next.
      makeShow({ showId: 4, title: "Hidden", hidden: true, nextEpisode: airedRecent }),
      makeShow({ showId: 5, title: "NotStarted", completed: 0, nextEpisode: airedRecent }),
      makeShow({ showId: 6, title: "CaughtUp", nextEpisode: null }),
      makeShow({
        showId: 7,
        title: "Ended",
        completed: 10,
        aired: 10,
        status: "ended",
        nextEpisode: null,
      }),
      makeShow({ showId: 8, title: "Future", nextEpisode: future }),
    ];
    const { fresh, continued, lapsed } = group(shows);
    expect(fresh.map((i) => i.showId)).toEqual([1]);
    expect(continued.map((i) => i.showId)).toEqual([2]);
    expect(lapsed.map((i) => i.showId)).toEqual([3]);
    expect(fresh[0]?.group).toBe("fresh");
    expect(continued[0]?.group).toBe("continued");
    expect(lapsed[0]?.group).toBe("lapsed");
  });

  it("a freshly-aired episode pulls a long-idle show into New, not the drawer", () => {
    const returning = makeShow({
      showId: 1,
      nextEpisode: airedRecent,
      lastWatchedAt: iso(NOW - 30 * DAY),
    });
    const { fresh, lapsed } = group([returning]);
    expect(fresh.map((i) => i.showId)).toEqual([1]);
    expect(lapsed).toHaveLength(0);
  });

  it("reports backlog as aired minus completed, floored at 0", () => {
    const shows = [
      makeShow({ showId: 1, aired: 10, completed: 3, nextEpisode: airedRecent }),
      makeShow({ showId: 2, aired: 4, completed: 9, nextEpisode: airedRecent }),
    ];
    const { fresh } = group(shows);
    expect(fresh.find((i) => i.showId === 1)?.backlog).toBe(7);
    expect(fresh.find((i) => i.showId === 2)?.backlog).toBe(0);
  });

  it("treats an unknown air date as not-yet-aired (excluded)", () => {
    const shows = [makeShow({ nextEpisode: makeEpisode({ firstAired: null }) })];
    const { fresh, continued, lapsed } = group(shows);
    expect([...fresh, ...continued, ...lapsed]).toHaveLength(0);
  });

  it("keeps a provisional post-mark projection in Continue, never New", () => {
    // A just-marked show still showing its optimistic next-episode projection
    // (ids.trakt === 0). Even with a recent-looking air date it must not surface
    // as New/lead, the season-finale phantom bug, and must stay visible (Continue).
    const provisional = makeShow({
      showId: 1,
      nextEpisode: makeEpisode({ firstAired: iso(NOW - DAY), ids: { trakt: 0 } }),
      lastWatchedAt: iso(NOW),
    });
    const { fresh, continued, lapsed } = group([provisional]);
    expect(fresh).toHaveLength(0);
    expect(continued.map((i) => i.showId)).toEqual([1]);
    expect(lapsed).toHaveLength(0);
  });

  it("keeps a provisional projection with an unknown air date visible (not dropped as caught-up)", () => {
    // The real projection carries firstAired: null; it must still show mid-binge,
    // locked, rather than vanish until the authoritative progress refetch lands.
    const provisional = makeShow({
      showId: 2,
      nextEpisode: makeEpisode({ firstAired: null, ids: { trakt: 0 } }),
      lastWatchedAt: iso(NOW),
    });
    expect(group([provisional]).continued.map((i) => i.showId)).toEqual([2]);
  });

  it("drops a provisional projection whose show is ended or hidden from every group", () => {
    // Marking a series finale leaves an optimistic phantom next (ids.trakt === 0) on
    // an `ended`, fully-watched show; a hidden show can carry one mid-unhide. Neither
    // has a real next: the provisional flag must not resurrect it into the queue.
    const endedFinale = makeShow({
      showId: 1,
      status: "ended",
      aired: 10,
      completed: 10,
      nextEpisode: makeEpisode({ firstAired: null, ids: { trakt: 0 } }),
      lastWatchedAt: iso(NOW),
    });
    const hidden = makeShow({
      showId: 2,
      hidden: true,
      nextEpisode: makeEpisode({ firstAired: iso(NOW - DAY), ids: { trakt: 0 } }),
      lastWatchedAt: iso(NOW),
    });
    const { fresh, continued, lapsed } = group([endedFinale, hidden]);
    expect([...fresh, ...continued, ...lapsed]).toHaveLength(0);
  });
});

describe("groupUpNext ordering", () => {
  it("New: newest air date first", () => {
    const shows = [
      makeShow({
        showId: 1,
        nextEpisode: makeEpisode({ firstAired: iso(NOW - 3 * DAY) }),
        lastWatchedAt: iso(NOW - 2 * DAY),
      }),
      makeShow({
        showId: 2,
        nextEpisode: makeEpisode({ firstAired: iso(NOW - DAY) }),
        lastWatchedAt: iso(NOW - 2 * DAY),
      }),
      makeShow({
        showId: 3,
        nextEpisode: makeEpisode({ firstAired: iso(NOW - 6 * DAY) }),
        lastWatchedAt: iso(NOW - 2 * DAY),
      }),
    ];
    expect(group(shows).fresh.map((i) => i.showId)).toEqual([2, 1, 3]);
  });

  it("Continue: most-recently-watched first, tiebreak oldest air date", () => {
    const shows = [
      makeShow({ showId: 1, nextEpisode: airedOld, lastWatchedAt: iso(NOW - 2 * DAY) }),
      makeShow({ showId: 2, nextEpisode: airedOld, lastWatchedAt: iso(NOW - DAY) }),
      makeShow({ showId: 3, nextEpisode: airedOld, lastWatchedAt: iso(NOW - 3 * DAY) }),
    ];
    expect(group(shows).continued.map((i) => i.showId)).toEqual([2, 1, 3]);
  });

  it("Continue tiebreak falls through to air date (older first) when recency ties", () => {
    const shows = [
      makeShow({
        showId: 1,
        nextEpisode: makeEpisode({ firstAired: iso(NOW - 10 * DAY) }),
        lastWatchedAt: iso(NOW - 2 * DAY),
      }),
      makeShow({
        showId: 2,
        nextEpisode: makeEpisode({ firstAired: iso(NOW - 15 * DAY) }),
        lastWatchedAt: iso(NOW - 2 * DAY),
      }),
    ];
    expect(group(shows).continued.map((i) => i.showId)).toEqual([2, 1]);
  });

  it("drawer: longest-idle first, an unknown last-watch counting as oldest", () => {
    const shows = [
      makeShow({ showId: 1, nextEpisode: airedOld, lastWatchedAt: iso(NOW - 30 * DAY) }),
      makeShow({ showId: 2, nextEpisode: airedOld, lastWatchedAt: iso(NOW - 40 * DAY) }),
      makeShow({ showId: 3, nextEpisode: airedOld, lastWatchedAt: null }),
    ];
    expect(group(shows).lapsed.map((i) => i.showId)).toEqual([3, 2, 1]);
  });
});
