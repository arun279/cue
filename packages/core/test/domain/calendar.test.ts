import {
  airingGrammar,
  type CalendarEntry,
  type CalendarRow,
  groupCalendar,
} from "@cue/core/domain/calendar";
import { describe, expect, it } from "vitest";

/** Fixed instant: 2026-07-05T16:00Z = 12:00 in America/New_York (EDT, UTC-4). */
const NOW = Date.parse("2026-07-05T16:00:00.000Z");
const NY = "America/New_York";

function entry(
  overrides: Partial<CalendarEntry> & { firstAired: string; showId: number },
): CalendarEntry {
  return {
    showTitle: `Show ${overrides.showId}`,
    season: 1,
    number: 1,
    episodeTitle: "Pilot",
    ids: { trakt: overrides.showId * 100 },
    posters: [],
    network: null,
    tmdbId: null,
    ...overrides,
  };
}

const NO_HIDDEN = new Set<number>();

function row(overrides: Partial<CalendarRow> = {}): CalendarRow {
  return {
    ...entry({ showId: 1, firstAired: "2026-07-05T18:00:00.000Z" }),
    aired: false,
    ...overrides,
  };
}

describe("groupCalendar", () => {
  it("groups by the local calendar day and labels Today / Tomorrow / date", () => {
    const days = groupCalendar(
      [
        entry({ showId: 1, firstAired: "2026-07-05T14:00:00.000Z" }), // NY 10:00 → Today
        entry({ showId: 2, firstAired: "2026-07-06T15:00:00.000Z" }), // NY 11:00 07-06 → Tomorrow
        entry({ showId: 3, firstAired: "2026-07-10T15:00:00.000Z" }), // NY 07-10 → dated
      ],
      { now: NOW, timeZone: NY, hiddenShowIds: NO_HIDDEN },
    );

    expect(days.map((d) => d.dayKey)).toEqual(["2026-07-05", "2026-07-06", "2026-07-10"]);
    expect(days[0]?.label).toBe("Today");
    expect(days[1]?.label).toBe("Tomorrow");
    expect(days[2]?.label).toMatch(/Jul 10/);
    expect(days[2]?.label).not.toMatch(/Today|Tomorrow/);
  });

  it("localizes to the timezone: a late-UTC air time lands on the previous local day", () => {
    // 02:00Z on 07-05 is 22:00 on 07-04 in New York: a UTC grouping would mis-file it.
    const days = groupCalendar([entry({ showId: 1, firstAired: "2026-07-05T02:00:00.000Z" })], {
      now: NOW,
      timeZone: NY,
      hiddenShowIds: NO_HIDDEN,
    });
    expect(days).toHaveLength(1);
    expect(days[0]?.dayKey).toBe("2026-07-04");
  });

  it("flags rows aired at/-before now and leaves future rows unaired", () => {
    const days = groupCalendar(
      [
        entry({ showId: 1, firstAired: "2026-07-05T14:00:00.000Z" }), // before now → aired
        entry({ showId: 2, firstAired: "2026-07-06T15:00:00.000Z" }), // after now → not aired
      ],
      { now: NOW, timeZone: NY, hiddenShowIds: NO_HIDDEN },
    );
    expect(days[0]?.rows[0]?.aired).toBe(true);
    expect(days[1]?.rows[0]?.aired).toBe(false);
  });

  it("excludes hidden shows even when the feed still lists them", () => {
    const days = groupCalendar(
      [
        entry({ showId: 1, firstAired: "2026-07-05T14:00:00.000Z" }),
        entry({ showId: 9, firstAired: "2026-07-05T15:00:00.000Z" }),
      ],
      { now: NOW, timeZone: NY, hiddenShowIds: new Set([9]) },
    );
    const showIds = days.flatMap((d) => d.rows.map((r) => r.showId));
    expect(showIds).toEqual([1]);
  });

  it("orders episodes within a day by air time", () => {
    const days = groupCalendar(
      [
        entry({ showId: 1, firstAired: "2026-07-05T20:00:00.000Z" }),
        entry({ showId: 2, firstAired: "2026-07-05T13:00:00.000Z" }),
      ],
      { now: NOW, timeZone: NY, hiddenShowIds: NO_HIDDEN },
    );
    expect(days[0]?.rows.map((r) => r.showId)).toEqual([2, 1]);
  });

  it("drops rows with an unparseable air date instead of mis-grouping them", () => {
    const days = groupCalendar(
      [
        entry({ showId: 1, firstAired: "not-a-date" }),
        entry({ showId: 2, firstAired: "2026-07-05T14:00:00.000Z" }),
      ],
      { now: NOW, timeZone: NY, hiddenShowIds: NO_HIDDEN },
    );
    expect(days).toHaveLength(1);
    expect(days[0]?.rows.map((r) => r.showId)).toEqual([2]);
  });

  it("returns no days for an empty feed", () => {
    expect(groupCalendar([], { now: NOW, timeZone: NY, hiddenShowIds: NO_HIDDEN })).toEqual([]);
  });
});

describe("airingGrammar", () => {
  it("puts today's time in the chip and keeps the network in the line", () => {
    const grammar = airingGrammar(row({ network: "HBO" }), 0);

    expect(grammar.chip).toMatch(/\d/);
    expect(grammar.line).toBe("HBO");
    expect(grammar.spoken).toBe(`${grammar.chip} · HBO`);
  });

  it("puts a later-day countdown in the chip and keeps time in the line", () => {
    const grammar = airingGrammar(row({ network: null }), 2);

    expect(grammar.chip).toBe("2d");
    expect(grammar.line).toBe(grammar.spoken);
    expect(grammar.spoken).toMatch(/\d/);
  });

  it("describes aired episodes without a countdown", () => {
    const grammar = airingGrammar(row({ aired: true, firstAired: "invalid" }), 0);

    expect(grammar.chip).toBeNull();
    expect(grammar.line).toBe(grammar.spoken);
    expect(grammar.spoken).toMatch(/^Aired /);
  });
});
