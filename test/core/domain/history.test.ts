import { describe, expect, it } from "vitest";
import {
  groupHistory,
  type HistoryEntry,
  historyRange,
  historyScopeKey,
  jumpMonths,
  jumpRange,
  jumpYears,
} from "@/core/domain/history";

/** Fixed instant: 2026-07-05T16:00Z = 12:00 in America/New_York (EDT, UTC-4). */
const NOW = Date.parse("2026-07-05T16:00:00.000Z");
const NY = "America/New_York";

let seq = 0;

function ep(
  watchedAt: string,
  showId: number,
  number: number,
  title = "Show",
  season = 1,
): HistoryEntry {
  seq += 1;
  return {
    historyId: seq,
    watchedAt,
    type: "episode",
    mediaId: showId,
    ids: { trakt: 1000 + seq },
    title,
    year: null,
    season,
    number,
    episodeTitle: `E${number}`,
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
    const ids = days[0]?.entries.map((e) => e.mediaId);
    expect(ids).toEqual([2, 1]);
  });

  it("breaks a tie in play time by show, then latest season and episode first", () => {
    const stamp = "2026-07-05T15:00:00.000Z";
    const tied = [
      ep(stamp, 1, 1, "Show", 2),
      ep(stamp, 2, 1),
      ep(stamp, 1, 2),
      ep(stamp, 1, 2, "Show", 2),
      ep(stamp, 2, 2),
      ep(stamp, 1, 1),
    ];
    const order = (entries: readonly HistoryEntry[]) =>
      groupHistory(entries, OPTS)[0]?.entries.map((e) => `${e.mediaId} S${e.season}E${e.number}`);
    const expected = ["1 S2E2", "1 S2E1", "1 S1E2", "1 S1E1", "2 S1E2", "2 S1E1"];
    expect(order(tied)).toEqual(expected);
    expect(order([...tied].reverse())).toEqual(expected);
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
    expect(days[0]?.entries[0]?.mediaId).toBe(2);
  });

  it("returns no days for an empty feed", () => {
    expect(groupHistory([], OPTS)).toEqual([]);
  });
});

describe("historyRange (the decade-jump window)", () => {
  it("bounds a whole year in UTC, first ms to last", () => {
    expect(historyRange(2019, undefined, "UTC")).toEqual({
      startAt: "2019-01-01T00:00:00.000Z",
      endAt: "2019-12-31T23:59:59.999Z",
    });
  });

  it("narrows to a single month, ending on the last ms before the next month", () => {
    // March 2019: 01 00:00:00.000 → 31 23:59:59.999 (April 1 minus 1ms).
    expect(historyRange(2019, 3, "UTC")).toEqual({
      startAt: "2019-03-01T00:00:00.000Z",
      endAt: "2019-03-31T23:59:59.999Z",
    });
  });

  it("handles February in a leap year (29 days)", () => {
    expect(historyRange(2020, 2, "UTC").endAt).toBe("2020-02-29T23:59:59.999Z");
  });

  it("handles December, rolling the exclusive bound into the next year", () => {
    expect(historyRange(2021, 12, "UTC").endAt).toBe("2021-12-31T23:59:59.999Z");
  });
});

describe("the month jump's periods", () => {
  it("runs from the month of the first play to the current month, newest year first", () => {
    const range = jumpRange("2024-03-10T12:00:00.000Z", NOW, NY);
    expect(jumpYears(range)).toEqual([2026, 2025, 2024]);
    expect(jumpMonths(range, 2024)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(jumpMonths(range, 2025)).toHaveLength(12);
    expect(jumpMonths(range, 2026)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("reads both ends in the given time zone", () => {
    const play = "2024-02-29T23:30:00.000Z";
    const lateUtc = Date.parse("2026-06-30T23:30:00.000Z");
    expect(jumpRange(play, lateUtc, "Pacific/Kiritimati")).toEqual({
      first: { year: 2024, month: 3 },
      last: { year: 2026, month: 7 },
    });
    expect(jumpRange(play, lateUtc, "Pacific/Pago_Pago")).toEqual({
      first: { year: 2024, month: 2 },
      last: { year: 2026, month: 6 },
    });
  });

  it("offers only the current month when there is no play, or none before now", () => {
    for (const firstPlayAt of [null, "2027-01-01T00:00:00.000Z"]) {
      const range = jumpRange(firstPlayAt, NOW, NY);
      expect(jumpYears(range)).toEqual([2026]);
      expect(jumpMonths(range, 2026)).toEqual([7]);
    }
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
