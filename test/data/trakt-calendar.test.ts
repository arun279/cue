import { assembleCalendarEntries } from "@data/trakt/calendar";
import type { CalendarItem } from "@data/trakt/schemas";
import { describe, expect, it } from "vitest";

function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    first_aired: "2026-07-05T01:00:00.000Z",
    episode: {
      season: 2,
      number: 3,
      title: "The One",
      ids: { trakt: 42, tvdb: 7, tmdb: 900 },
    },
    show: {
      title: "Example",
      ids: { trakt: 5 },
      images: { poster: ["media.trakt.tv/p.webp"] },
    },
    ...overrides,
  };
}

describe("assembleCalendarEntries", () => {
  it("flattens a calendar row into a domain entry", () => {
    const [entry] = assembleCalendarEntries([item()]);
    expect(entry).toEqual({
      showId: 5,
      showTitle: "Example",
      season: 2,
      number: 3,
      episodeTitle: "The One",
      firstAired: "2026-07-05T01:00:00.000Z",
      ids: { trakt: 42, tvdb: 7, imdb: undefined, tmdb: 900 },
      posters: ["media.trakt.tv/p.webp"],
      tmdbId: 900,
    });
  });

  it("uses the row-level first_aired as the authoritative air instant", () => {
    const [entry] = assembleCalendarEntries([item({ first_aired: "2026-08-01T12:00:00.000Z" })]);
    expect(entry?.firstAired).toBe("2026-08-01T12:00:00.000Z");
  });

  it("defaults missing images and tmdb id", () => {
    const [entry] = assembleCalendarEntries([
      item({
        episode: { season: 1, number: 1, title: null, ids: { trakt: 1 } },
        show: { title: "Bare", ids: { trakt: 2 } },
      }),
    ]);
    expect(entry?.posters).toEqual([]);
    expect(entry?.tmdbId).toBeNull();
    expect(entry?.episodeTitle).toBeNull();
  });
});
