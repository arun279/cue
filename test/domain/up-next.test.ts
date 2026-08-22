import { groupUpNext } from "@domain/up-next";
import { describe, expect, it } from "vitest";
import { DAY, iso, makeEpisode, makeShow, NOW, THRESHOLD } from "./_helpers";

const airedRecent = makeEpisode({ firstAired: iso(NOW - DAY) });
const airedOld = makeEpisode({ firstAired: iso(NOW - 25 * DAY) });
const future = makeEpisode({ firstAired: iso(NOW + DAY) });

function group(shows: Parameters<typeof groupUpNext>[0]) {
  return groupUpNext(shows, NOW, THRESHOLD);
}

describe("groupUpNext partitioning", () => {
  it("partitions watching and lapsed shows and excludes states with no next to queue", () => {
    const shows = [
      makeShow({ showId: 1, nextEpisode: airedRecent }),
      makeShow({ showId: 2, nextEpisode: airedOld, lastWatchedAt: iso(NOW - 30 * DAY) }),
      makeShow({ showId: 3, hidden: true }),
      makeShow({ showId: 4, completed: 0 }),
      makeShow({ showId: 5, nextEpisode: null }),
      makeShow({ showId: 6, completed: 10, aired: 10, status: "ended", nextEpisode: null }),
      makeShow({ showId: 7, nextEpisode: future }),
    ];
    const { queue, lapsed } = group(shows);
    expect(queue.map((item) => item.showId)).toEqual([1]);
    expect(lapsed.map((item) => item.showId)).toEqual([2]);
  });

  it("queues a show watched 30 days ago whose next aired 1 day ago", () => {
    const show = makeShow({ nextEpisode: airedRecent, lastWatchedAt: iso(NOW - 30 * DAY) });
    expect(group([show])).toEqual({ queue: [expect.objectContaining({ showId: 1 })], lapsed: [] });
  });

  it("lapses a show watched 30 days ago whose next aired 25 days ago", () => {
    const show = makeShow({ nextEpisode: airedOld, lastWatchedAt: iso(NOW - 30 * DAY) });
    expect(group([show])).toEqual({ queue: [], lapsed: [expect.objectContaining({ showId: 1 })] });
  });

  it("queues a recently watched show whose next episode aired 60 days ago", () => {
    const show = makeShow({
      nextEpisode: makeEpisode({ firstAired: iso(NOW - 60 * DAY) }),
      lastWatchedAt: iso(NOW - DAY),
    });
    expect(group([show])).toEqual({ queue: [expect.objectContaining({ showId: 1 })], lapsed: [] });
  });

  it("reports backlog as aired minus completed, floored at 0", () => {
    const shows = [
      makeShow({ showId: 1, aired: 10, completed: 3, nextEpisode: airedRecent }),
      makeShow({ showId: 2, aired: 4, completed: 9, nextEpisode: airedRecent }),
    ];
    const { queue } = group(shows);
    expect(queue.find((item) => item.showId === 1)?.backlog).toBe(7);
    expect(queue.find((item) => item.showId === 2)?.backlog).toBe(0);
  });

  it("excludes an unknown authoritative air date", () => {
    expect(group([makeShow({ nextEpisode: makeEpisode({ firstAired: null }) })])).toEqual({
      queue: [],
      lapsed: [],
    });
  });

  it("keeps a provisional projection in the queue", () => {
    const provisional = makeShow({
      nextEpisode: makeEpisode({ firstAired: null, ids: { trakt: 0 } }),
      lastWatchedAt: iso(NOW),
    });
    expect(group([provisional]).queue.map((item) => item.showId)).toEqual([1]);
  });

  it("keeps a provisional projection out of the lapsed drawer even with an old air date", () => {
    const provisional = makeShow({
      nextEpisode: makeEpisode({ firstAired: airedOld.firstAired, ids: { trakt: 0 } }),
      lastWatchedAt: iso(NOW - 30 * DAY),
    });
    expect(group([provisional])).toEqual({
      queue: [expect.objectContaining({ showId: 1 })],
      lapsed: [],
    });
  });

  it("does not let provisional projections resurrect ended, hidden, or never-started shows", () => {
    const nextEpisode = makeEpisode({ firstAired: null, ids: { trakt: 0 } });
    const shows = [
      makeShow({ status: "ended", aired: 10, completed: 10, nextEpisode }),
      makeShow({ showId: 2, hidden: true, nextEpisode }),
      makeShow({ showId: 3, completed: 0, nextEpisode }),
    ];
    expect(group(shows)).toEqual({ queue: [], lapsed: [] });
  });
});
