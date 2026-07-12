import type { HistoryDay, HistoryEntry, HistoryGroup } from "@domain/history";
import {
  buildBlocks,
  countItemPlays,
  entryDetail,
  jumpLabel,
} from "@ui/screens/history/history-view";
import { describe, expect, it } from "vitest";

let nextId = 1;

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  nextId += 1;
  return {
    historyId: nextId,
    watchedAt: "2026-07-09T21:00:00.000Z",
    type: "episode",
    mediaId: 1,
    ids: { trakt: 100 },
    title: "The Wire",
    year: null,
    season: 1,
    number: 4,
    episodeTitle: "Old Cases",
    posters: [],
    tmdbId: null,
    ...over,
  };
}

function day(dayKey: string, entries: readonly HistoryEntry[]): HistoryDay {
  const groups: HistoryGroup[] = entries.map((e) => ({
    key: `${e.type}:${e.historyId}`,
    entries: [e],
    loggedTogether: false,
  }));
  return {
    dayKey,
    label: "Thu, Jul 9",
    episodeCount: entries.filter((e) => e.type === "episode").length,
    movieCount: entries.filter((e) => e.type === "movie").length,
    groups,
  };
}

describe("buildBlocks", () => {
  it("collapses same-item plays in a day into one ×N row wearing the newest play", () => {
    const newest = entry({ historyId: 900, watchedAt: "2026-07-09T22:00:00.000Z" });
    const older = entry({ historyId: 899, watchedAt: "2026-07-09T20:00:00.000Z" });
    const other = entry({ mediaId: 2, title: "Severance", number: 5 });
    const blocks = buildBlocks([day("2026-07-09", [newest, older, other])], "");
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    if (block?.kind !== "day") throw new Error("expected a day block");
    expect(block.day.rows).toHaveLength(2);
    expect(block.day.rows[0]?.entry.historyId).toBe(900);
    expect(block.day.rows[0]?.plays).toBe(2);
    expect(block.day.rows[1]?.plays).toBe(1);
  });

  it("rolls up play counts per day, split by medium", () => {
    const movie = entry({
      type: "movie",
      mediaId: 7,
      title: "Heat",
      year: 1995,
      season: null,
      number: null,
    });
    const blocks = buildBlocks([day("2026-07-09", [entry(), entry({ number: 5 }), movie])], "");
    const block = blocks[0];
    if (block?.kind !== "day") throw new Error("expected a day block");
    expect(block.day.rollup).toBe("2 episodes · 1 movie");
  });

  it("filters by title case-insensitively and drops emptied days", () => {
    const wire = day("2026-07-09", [entry()]);
    const severance = day("2026-07-08", [entry({ mediaId: 2, title: "Severance" })]);
    const blocks = buildBlocks([wire, severance], "sever");
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    if (block?.kind !== "day") throw new Error("expected a day block");
    expect(block.day.rows[0]?.entry.title).toBe("Severance");
  });

  it("inserts a year separator only at year boundaries", () => {
    const blocks = buildBlocks(
      [
        day("2026-01-01", [entry()]),
        day("2025-12-31", [entry({ number: 5 })]),
        day("2025-12-30", [entry({ number: 6 })]),
      ],
      "",
    );
    expect(blocks.map((b) => b.kind)).toEqual(["day", "year", "day", "day"]);
    const separator = blocks[1];
    if (separator?.kind !== "year") throw new Error("expected a year block");
    expect(separator.year).toBe(2025);
  });
});

describe("countItemPlays", () => {
  it("counts an item's plays across every loaded day", () => {
    const target = entry({ historyId: 500 });
    const all = [
      day("2026-07-09", [target, entry({ historyId: 501 })]),
      day("2026-07-01", [entry({ historyId: 502 })]),
      day("2026-06-20", [entry({ mediaId: 2, title: "Severance" })]),
    ];
    expect(countItemPlays(all, target)).toBe(3);
  });
});

describe("jumpLabel", () => {
  const now = Date.UTC(2026, 6, 12, 12, 0, 0);
  it("shows the current month for the unscoped recent feed", () => {
    expect(jumpLabel(undefined, undefined, now)).toMatch(/^(Jun|Jul) 2026$/);
  });
  it("shows the scoped year, and month within it", () => {
    expect(jumpLabel(2019, undefined, now)).toBe("2019");
    expect(jumpLabel(2019, 3, now)).toBe("Mar 2019");
  });
});

describe("entryDetail", () => {
  it("reads `S1 E4 Old Cases` for episodes and the release year for movies", () => {
    expect(entryDetail(entry())).toBe("S1 E4 Old Cases");
    expect(entryDetail(entry({ episodeTitle: null }))).toBe("S1 E4");
    expect(entryDetail(entry({ type: "movie", year: 1995, season: null, number: null }))).toBe(
      "1995",
    );
    expect(entryDetail(entry({ type: "movie", year: null, season: null, number: null }))).toBe(
      "Movie",
    );
  });
});
