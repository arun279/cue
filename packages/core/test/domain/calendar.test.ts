import {
  airingGrammar,
  type CalendarEntry,
  type CalendarRow,
  episodeLine,
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
    episodes: [{ season: 1, number: 1 }],
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

describe("a drop: one show's episodes airing at the same instant", () => {
  const AT = "2026-07-06T04:00:00.000Z";
  const episodes = (showId: number, season: number, numbers: readonly number[], at = AT) =>
    numbers.map((number) =>
      entry({ showId, season, number, firstAired: at, ids: { trakt: showId * 100 + number } }),
    );
  const rowsOf = (entries: readonly CalendarEntry[]) =>
    groupCalendar(entries, { now: NOW, timeZone: NY, hiddenShowIds: NO_HIDDEN }).flatMap(
      (day) => day.rows,
    );
  const linesOf = (entries: readonly CalendarEntry[]) => rowsOf(entries).map(episodeLine);

  it("is one row that opens at its lowest episode, while other shows and times keep theirs", () => {
    const rows = rowsOf([
      ...episodes(1, 2, [3, 1, 2]),
      ...episodes(2, 1, [5]),
      ...episodes(1, 2, [4], "2026-07-06T05:00:00.000Z"),
    ]);
    expect(
      rows.map((row) => ({
        showId: row.showId,
        line: episodeLine(row).code,
        trakt: row.ids.trakt,
      })),
    ).toEqual([
      { showId: 1, line: "S2 E1–E3", trakt: 101 },
      { showId: 2, line: "S1 E5", trakt: 205 },
      { showId: 1, line: "S2 E4", trakt: 104 },
    ]);
  });

  it("names a run in one season by its range, and counts the episodes", () => {
    expect(linesOf(episodes(1, 2, [1, 2, 3, 4, 5, 6, 7, 8]))).toEqual([
      { code: "S2 E1–E8", spoken: "season 2, episodes 1 to 8", detail: "8 episodes" },
    ]);
  });

  it("names only the season when the episodes skip, and both seasons when they span two", () => {
    expect(
      linesOf([...episodes(1, 2, [1, 3, 4]), ...episodes(2, 1, [10]), ...episodes(2, 2, [1])]),
    ).toEqual([
      { code: "S2", spoken: "season 2", detail: "3 episodes" },
      { code: "S1–S2", spoken: "seasons 1 to 2", detail: "2 episodes" },
    ]);
  });

  it("leaves a lone episode as it was: its code and its title", () => {
    const lone = entry({
      showId: 1,
      season: 3,
      number: 6,
      episodeTitle: "The Long Dark",
      firstAired: AT,
    });
    expect(linesOf([lone])).toEqual([{ code: "S3 E6", spoken: "S3 E6", detail: "The Long Dark" }]);
  });
});

describe("the shows-you-watch focus", () => {
  const WATCHED = 1;
  const WATCHLISTED = 2;
  const feed = [
    entry({ showId: WATCHED, season: 4, number: 6, firstAired: "2026-07-06T01:00:00.000Z" }),
    entry({ showId: WATCHLISTED, season: 3, number: 1, firstAired: "2026-07-07T01:00:00.000Z" }),
    entry({ showId: WATCHLISTED, season: 3, number: 2, firstAired: "2026-07-08T01:00:00.000Z" }),
  ];
  const kept = (playedShowIds?: ReadonlySet<number>) =>
    groupCalendar(feed, { now: NOW, timeZone: NY, hiddenShowIds: NO_HIDDEN, playedShowIds })
      .flatMap((day) => day.rows)
      .map((row) => `${row.showId} S${row.season}E${row.number}`);

  it("keeps every episode of a played show and only the premieres of the rest", () => {
    expect(kept(new Set([WATCHED]))).toEqual(["1 S4E6", "2 S3E1"]);
  });

  it("keeps everything while there is no focus", () => {
    expect(kept()).toEqual(["1 S4E6", "2 S3E1", "2 S3E2"]);
  });

  it("keeps a whole season drop when its premiere is in it", () => {
    const drop = [1, 2, 3].map((number) =>
      entry({ showId: WATCHLISTED, season: 2, number, firstAired: "2026-07-06T04:00:00.000Z" }),
    );
    const days = groupCalendar(drop, {
      now: NOW,
      timeZone: NY,
      hiddenShowIds: NO_HIDDEN,
      playedShowIds: new Set(),
    });
    expect(days[0]?.rows.map((row) => row.episodes.length)).toEqual([3]);
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
