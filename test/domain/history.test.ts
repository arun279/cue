import { groupHistory, type HistoryEntry, historyRange, historyScopeKey } from "@domain/history";
import { describe, expect, it } from "vitest";

/** Fixed instant: 2026-07-05T16:00Z = 12:00 in America/New_York (EDT, UTC-4). */
const NOW = Date.parse("2026-07-05T16:00:00.000Z");
const NY = "America/New_York";

let seq = 0;

function ep(watchedAt: string, showId: number, number: number, title = "Show"): HistoryEntry {
  seq += 1;
  return {
    historyId: seq,
    watchedAt,
    type: "episode",
    mediaId: showId,
    ids: { trakt: 1000 + seq },
    title,
    year: null,
    season: 1,
    number,
    episodeTitle: `E${number}`,
    posters: [],
    tmdbId: null,
  };
}

function movie(watchedAt: string, movieId: number, title = "Film"): HistoryEntry {
  seq += 1;
  return {
    historyId: seq,
    watchedAt,
    type: "movie",
    mediaId: movieId,
    ids: { trakt: 2000 + seq },
    title,
    year: 2014,
    season: null,
    number: null,
    episodeTitle: null,
    posters: [],
    tmdbId: null,
  };
}

const OPTS = { now: NOW, timeZone: NY };

describe("groupHistory", () => {
  it("groups by local day, labels Today / Yesterday / date, newest day first", () => {
    const days = groupHistory(
      [
        ep("2026-07-05T15:00:00.000Z", 1, 1), // NY 11:00 today
        ep("2026-07-04T20:00:00.000Z", 2, 1), // NY 16:00 yesterday
        ep("2026-07-01T15:00:00.000Z", 3, 1), // older → dated
      ],
      OPTS,
    );
    expect(days.map((d) => d.dayKey)).toEqual(["2026-07-05", "2026-07-04", "2026-07-01"]);
    expect(days[0]?.label).toBe("Today");
    expect(days[1]?.label).toBe("Yesterday");
    expect(days[2]?.label).toMatch(/Jul 1/);
    expect(days[2]?.label).not.toMatch(/Today|Yesterday/);
  });

  it("orders plays within a day newest-first regardless of input order", () => {
    const days = groupHistory(
      [ep("2026-07-05T13:00:00.000Z", 1, 1), ep("2026-07-05T15:00:00.000Z", 2, 1)],
      OPTS,
    );
    const ids = days[0]?.groups.flatMap((g) => g.entries.map((e) => e.mediaId));
    expect(ids).toEqual([2, 1]);
  });

  it("collapses consecutive same-show episodes; a movie breaks the run", () => {
    // Newest-first within the day: A-e8, A-e7, movie, A-e5. The movie between the
    // A episodes means A-e5 is a SEPARATE single group (not merged into the cluster).
    const days = groupHistory(
      [
        ep("2026-07-05T15:00:00.000Z", 1, 8, "The Bear"),
        ep("2026-07-05T14:50:00.000Z", 1, 7, "The Bear"),
        movie("2026-07-05T14:00:00.000Z", 9),
        ep("2026-07-05T13:00:00.000Z", 1, 5, "The Bear"),
      ],
      OPTS,
    );
    const groups = days[0]?.groups ?? [];
    expect(groups.map((g) => g.entries.length)).toEqual([2, 1, 1]);
    expect(groups[0]?.entries.map((e) => e.number)).toEqual([8, 7]);
    expect(groups[1]?.entries[0]?.type).toBe("movie");
    expect(groups[2]?.entries.map((e) => e.number)).toEqual([5]);
  });

  it("flags a same-minute cluster as Logged together (a bulk mark), not a real binge", () => {
    // Four episodes of one show sharing one minute → a bulk "mark season" stamp.
    const stamp = "2026-07-05T15:00:00.000Z";
    const days = groupHistory(
      [
        ep(stamp, 1, 8, "The Bear"),
        ep(stamp, 1, 7, "The Bear"),
        ep(stamp, 1, 6, "The Bear"),
        ep(stamp, 1, 5, "The Bear"),
      ],
      OPTS,
    );
    const group = days[0]?.groups[0];
    expect(group?.entries).toHaveLength(4);
    expect(group?.loggedTogether).toBe(true);
  });

  it("does NOT flag a real binge (same show, spread across minutes) as logged together", () => {
    const days = groupHistory(
      [
        ep("2026-07-05T15:00:00.000Z", 1, 8, "The Bear"),
        ep("2026-07-05T14:20:00.000Z", 1, 7, "The Bear"),
      ],
      OPTS,
    );
    const group = days[0]?.groups[0];
    expect(group?.entries).toHaveLength(2);
    expect(group?.loggedTogether).toBe(false);
  });

  it("never marks a lone play as logged together", () => {
    const days = groupHistory([ep("2026-07-05T15:00:00.000Z", 1, 1)], OPTS);
    expect(days[0]?.groups[0]?.loggedTogether).toBe(false);
  });

  it("localizes to the timezone: a late-UTC play lands on the previous local day", () => {
    // 02:00Z on 07-05 is 22:00 on 07-04 in New York: a UTC grouping would mis-file it.
    const days = groupHistory([ep("2026-07-05T02:00:00.000Z", 1, 1)], OPTS);
    expect(days).toHaveLength(1);
    expect(days[0]?.dayKey).toBe("2026-07-04");
  });

  it("drops plays with an unparseable watched_at instead of mis-dating them", () => {
    const days = groupHistory([ep("not-a-date", 1, 1), ep("2026-07-05T15:00:00.000Z", 2, 1)], OPTS);
    expect(days).toHaveLength(1);
    expect(days[0]?.groups[0]?.entries[0]?.mediaId).toBe(2);
  });

  it("returns no days for an empty feed", () => {
    expect(groupHistory([], OPTS)).toEqual([]);
  });
});

describe("historyRange (the decade-jump window)", () => {
  it("bounds a whole year in UTC, first ms to last", () => {
    expect(historyRange(2019)).toEqual({
      startAt: "2019-01-01T00:00:00.000Z",
      endAt: "2019-12-31T23:59:59.999Z",
    });
  });

  it("narrows to a single month, ending on the last ms before the next month", () => {
    // March 2019: 01 00:00:00.000 → 31 23:59:59.999 (April 1 minus 1ms).
    expect(historyRange(2019, 3)).toEqual({
      startAt: "2019-03-01T00:00:00.000Z",
      endAt: "2019-03-31T23:59:59.999Z",
    });
  });

  it("handles February in a leap year (29 days)", () => {
    expect(historyRange(2020, 2).endAt).toBe("2020-02-29T23:59:59.999Z");
  });

  it("handles December, rolling the exclusive bound into the next year", () => {
    expect(historyRange(2021, 12).endAt).toBe("2021-12-31T23:59:59.999Z");
  });
});

describe("historyScopeKey (the cache-key + URL scope segment)", () => {
  it("is 'recent' for the unbounded feed", () => {
    expect(historyScopeKey()).toBe("recent");
    expect(historyScopeKey(undefined, 3)).toBe("recent");
  });

  it("is the bare year when only a year is scoped", () => {
    expect(historyScopeKey(2019)).toBe("2019");
  });

  it("is year-month, zero-padded, when a month is scoped", () => {
    expect(historyScopeKey(2019, 3)).toBe("2019-03");
    expect(historyScopeKey(2019, 12)).toBe("2019-12");
  });
});
