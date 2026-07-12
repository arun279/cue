import type { CalendarDay, CalendarRow } from "@domain/calendar";
import { buildAgenda, trailingChip } from "@ui/screens/upcoming/agenda";
import { describe, expect, it } from "vitest";

/** Noon UTC on 2026-07-05, evaluated in the UTC zone: tz-deterministic. */
const NOW = Date.UTC(2026, 6, 5, 12);

function row(id: number, aired = false): CalendarRow {
  return {
    showId: id,
    showTitle: `Show ${id}`,
    season: 1,
    number: id,
    episodeTitle: null,
    firstAired: new Date(NOW).toISOString(),
    ids: { trakt: id },
    posters: [],
    network: null,
    tmdbId: null,
    aired,
  };
}

function day(dayKey: string, label: string, rows: readonly CalendarRow[]): CalendarDay {
  return { dayKey, label, rows };
}

describe("buildAgenda", () => {
  it("flattens days into headers with counts followed by their rows", () => {
    const items = buildAgenda(
      [day("2026-07-05", "Today", [row(1, true), row(2)]), day("2026-07-06", "Tomorrow", [row(3)])],
      NOW,
      "UTC",
    );
    expect(items.map((item) => item.kind)).toEqual([
      "header",
      "episode",
      "episode",
      "header",
      "episode",
    ]);
    expect(items[0]).toMatchObject({ label: "Today", count: 2 });
    expect(items[3]).toMatchObject({ label: "Tomorrow", count: 1 });
  });

  it("carries each day's whole-day distance from today onto its rows", () => {
    const items = buildAgenda(
      [
        day("2026-07-05", "Today", [row(1)]),
        day("2026-07-06", "Tomorrow", [row(2)]),
        day("2026-07-12", "Sun, Jul 12", [row(3)]),
      ],
      NOW,
      "UTC",
    );
    const offsets = items.flatMap((item) => (item.kind === "episode" ? [item.offset] : []));
    expect(offsets).toEqual([0, 1, 7]);
  });

  it("skips days with no rows", () => {
    const items = buildAgenda([day("2026-07-05", "Today", [])], NOW, "UTC");
    expect(items).toEqual([]);
  });
});

describe("trailingChip", () => {
  it("shows nothing once aired (the text line takes over)", () => {
    expect(trailingChip(0, true, "8:00 PM")).toBeNull();
  });

  it("shows the air time for today's still-unaired episodes", () => {
    expect(trailingChip(0, false, "8:00 PM")).toBe("8:00 PM");
  });

  it("shows whole days away for future days", () => {
    expect(trailingChip(2, false, "8:00 PM")).toBe("2d");
  });
});
