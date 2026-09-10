import type { UserStats } from "@cue/core/data/trakt/schemas";
import { countTiles, isAllZero, watchTimeMinutes } from "@ui/screens/profile/stats";
import { describe, expect, it } from "vitest";

const stats: UserStats = {
  movies: { watched: 12, minutes: 1440 },
  episodes: { watched: 214, minutes: 6420 },
  shows: { watched: 11 },
};

const both = { showsEnabled: true, moviesEnabled: true } as const;
const tvOnly = { showsEnabled: true, moviesEnabled: false } as const;
const moviesOnly = { showsEnabled: false, moviesEnabled: true } as const;

describe("countTiles", () => {
  it("keeps the canonical Episodes / Movies / Shows order with both media on", () => {
    expect(countTiles(stats, both).map((tile) => tile.label)).toEqual([
      "Episodes",
      "Movies",
      "Shows",
    ]);
  });

  it("sheds the disabled medium's tiles", () => {
    expect(countTiles(stats, tvOnly).map((tile) => tile.label)).toEqual(["Episodes", "Shows"]);
    expect(countTiles(stats, moviesOnly).map((tile) => tile.label)).toEqual(["Movies"]);
  });
});

describe("watchTimeMinutes", () => {
  it("moves the hero total together with the tiles: hidden media add no minutes", () => {
    expect(watchTimeMinutes(stats, both)).toBe(7860);
    expect(watchTimeMinutes(stats, tvOnly)).toBe(6420);
    expect(watchTimeMinutes(stats, moviesOnly)).toBe(1440);
  });
});

describe("isAllZero", () => {
  it("judges emptiness over the enabled media only", () => {
    const tvHistoryOnly: UserStats = {
      movies: { watched: 0, minutes: 0 },
      episodes: { watched: 40, minutes: 1200 },
      shows: { watched: 3 },
    };
    expect(isAllZero(tvHistoryOnly, both)).toBe(false);
    expect(isAllZero(tvHistoryOnly, moviesOnly)).toBe(true);
    expect(
      isAllZero(
        {
          movies: { watched: 0, minutes: 0 },
          episodes: { watched: 0, minutes: 0 },
          shows: { watched: 0 },
        },
        both,
      ),
    ).toBe(true);
  });
});
