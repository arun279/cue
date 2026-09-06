import type { CalendarDay, CalendarRow } from "@cue/core/domain/calendar";
import { buildOnTheWay } from "@cue/core/domain/on-the-way";
import { describe, expect, it } from "vitest";

const row = (firstAired: string, aired = false): CalendarRow => ({
  showId: 1,
  showTitle: "Silo",
  season: 3,
  number: 3,
  episodeTitle: "A Dark Web",
  firstAired,
  ids: { trakt: 42 },
  posters: [],
  network: null,
  tmdbId: null,
  aired,
});

const day = (dayKey: string, label: string, rows: readonly CalendarRow[]): CalendarDay => ({
  dayKey,
  label,
  rows,
});

/** The web screen's cap; the native screen passes 3 (P3 B2). */
const MAX_ROWS = 6;

describe("buildOnTheWay", () => {
  // Fixtures pin America/New_York (vitest TZ); 2026-07-12T12:00-04:00 noon.
  const now = Date.parse("2026-07-12T16:00:00Z");

  it("counts day offsets from the clock when nothing airs today", () => {
    const days = [day("2026-07-14", "Tue, Jul 14", [row("2026-07-15T00:00:00Z")])];
    const built = buildOnTheWay(days, now, MAX_ROWS);
    expect(built).toHaveLength(1);
    expect(built[0]?.offset).toBe(2);
  });

  it("labels today's group Tonight at offset 0", () => {
    const days = [day("2026-07-12", "Today", [row("2026-07-13T00:00:00Z")])];
    const built = buildOnTheWay(days, now, MAX_ROWS);
    expect(built[0]?.label).toBe("Tonight");
    expect(built[0]?.offset).toBe(0);
  });

  it("drops rows beyond the 72-hour scope", () => {
    const days = [day("2026-07-16", "Thu, Jul 16", [row("2026-07-16T23:00:00Z")])];
    expect(buildOnTheWay(days, now, MAX_ROWS)).toHaveLength(0);
  });

  it("drops rows flagged aired", () => {
    const days = [day("2026-07-12", "Today", [row("2026-07-12T01:00:00Z", true)])];
    expect(buildOnTheWay(days, now, MAX_ROWS)).toHaveLength(0);
  });

  it("drops a row that aired even when its stale flag still says unaired", () => {
    // The `aired` stamp comes from the calendar grouping's own clock, which
    // only re-anchors on a day flip: the direct firstAired <= now check is
    // what drops an episode that airs while the screen sits open.
    const days = [
      day("2026-07-12", "Today", [
        row("2026-07-12T15:00:00Z"), // aired an hour ago; flag stale-false
        row("2026-07-13T00:00:00Z"), // tonight, still ahead
      ]),
    ];
    const built = buildOnTheWay(days, now, MAX_ROWS);
    expect(built).toHaveLength(1);
    expect(built[0]?.rows.map((r) => r.firstAired)).toEqual(["2026-07-13T00:00:00Z"]);
  });
  it("stops at the caller's cap, and stops mid-day when the cap falls inside a group", () => {
    const days = [
      day("2026-07-12", "Today", [
        row("2026-07-13T00:00:00Z"),
        row("2026-07-13T01:00:00Z"),
        row("2026-07-13T02:00:00Z"),
      ]),
      day("2026-07-13", "Tomorrow", [row("2026-07-14T00:00:00Z")]),
    ];
    const built = buildOnTheWay(days, now, 2);
    expect(built).toHaveLength(1);
    expect(built[0]?.rows).toHaveLength(2);
  });
});
