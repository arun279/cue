import type { CalendarEntry } from "@cue/core/domain/calendar";
import { needsNextEpisode, reconcileRecentlyAired } from "@cue/core/domain/recently-aired";
import { describe, expect, it } from "vitest";
import { DAY, iso, makeEpisode, makeShow, NOW } from "./_helpers";

function calendar(
  season: number,
  number: number,
  overrides: Partial<CalendarEntry> = {},
): CalendarEntry {
  return {
    showId: 1,
    showTitle: "Show",
    season,
    number,
    episodeTitle: `Episode ${number}`,
    firstAired: iso(NOW - DAY),
    ids: { trakt: season * 100 + number },
    posters: [],
    network: null,
    tmdbId: null,
    ...overrides,
  };
}

describe("reconcileRecentlyAired", () => {
  it("detects unknown aired episodes without assigning the next episode", () => {
    const show = makeShow({
      aired: 2,
      completed: 2,
      nextEpisode: null,
      lastAired: { season: 1, number: 2 },
    });
    const [result] = reconcileRecentlyAired([show], [calendar(2, 1)], NOW);
    expect(result).toMatchObject({
      aired: 3,
      nextEpisode: null,
      lastAired: { season: 2, number: 1 },
    });
  });

  it("keeps the snapshot next while raising aired", () => {
    const nextEpisode = makeEpisode({ season: 1, number: 9, firstAired: iso(NOW - 5 * DAY) });
    const show = makeShow({ aired: 10, nextEpisode, lastAired: { season: 1, number: 10 } });
    const [result] = reconcileRecentlyAired([show], [calendar(2, 1)], NOW);
    expect(result?.aired).toBe(11);
    expect(result?.nextEpisode).toBe(nextEpisode);
  });

  it("ignores calendar episodes at or below the frontier", () => {
    const show = makeShow({ lastAired: { season: 2, number: 3 } });
    const [result] = reconcileRecentlyAired([show], [calendar(1, 9), calendar(2, 3)], NOW);
    expect(result).toBe(show);
  });

  it("ignores specials and unaired episodes", () => {
    const show = makeShow({ nextEpisode: null, lastAired: { season: 1, number: 10 } });
    const [result] = reconcileRecentlyAired(
      [show],
      [calendar(0, 1), calendar(2, 1, { firstAired: iso(NOW + DAY) })],
      NOW,
    );
    expect(result).toBe(show);
  });

  it("ignores specials when the frontier is null", () => {
    const show = makeShow({ nextEpisode: null, lastAired: null });
    expect(reconcileRecentlyAired([show], [calendar(0, 1)], NOW)[0]).toBe(show);
  });

  it("does not guess which regular episodes are new when the frontier is unknown", () => {
    const show = makeShow({ nextEpisode: null, lastAired: null });
    expect(reconcileRecentlyAired([show], [calendar(2, 1)], NOW)[0]).toBe(show);
  });

  it("leaves a never-watched watchlist placeholder untouched", () => {
    const show = makeShow({
      completed: 0,
      aired: 0,
      nextEpisode: null,
      lastAired: null,
      lastWatchedAt: null,
      inWatchlist: true,
    });
    expect(reconcileRecentlyAired([show], [calendar(5, 7)], NOW)[0]).toBe(show);
  });

  it("keeps a provisional next while raising aired", () => {
    const nextEpisode = makeEpisode({
      season: 2,
      number: 2,
      firstAired: null,
      ids: { trakt: 0 },
    });
    const show = makeShow({ nextEpisode, lastAired: { season: 2, number: 1 } });
    const [result] = reconcileRecentlyAired([show], [calendar(2, 2)], NOW);
    expect(result?.nextEpisode).toBe(nextEpisode);
    expect(result?.aired).toBe(show.aired + 1);
  });

  it("moves lastAired to the newest unknown without replacing nextEpisode", () => {
    const show = makeShow({ nextEpisode: null, lastAired: { season: 1, number: 10 } });
    const [result] = reconcileRecentlyAired(
      [show],
      [calendar(2, 3), calendar(2, 1), calendar(2, 2)],
      NOW,
    );
    expect(result?.nextEpisode).toBeNull();
    expect(result?.lastAired).toEqual({ season: 2, number: 3 });
    expect(result?.aired).toBe(show.aired + 3);
  });

  it("returns a show without calendar rows as the same object", () => {
    const show = makeShow({ showId: 2 });
    expect(reconcileRecentlyAired([show], [calendar(2, 1)], NOW)[0]).toBe(show);
  });
});

describe("needsNextEpisode", () => {
  it("flags a caught-up snapshot after newly aired episodes are detected", () => {
    expect(needsNextEpisode(makeShow({ completed: 2, aired: 4, nextEpisode: null }), NOW)).toBe(
      true,
    );
  });

  it("does not flag a show whose next episode is aired", () => {
    expect(needsNextEpisode(makeShow({ completed: 2, aired: 4 }), NOW)).toBe(false);
  });

  it("flags an unaired next when aired episodes remain", () => {
    const nextEpisode = makeEpisode({ firstAired: iso(NOW + DAY) });
    expect(needsNextEpisode(makeShow({ completed: 2, aired: 4, nextEpisode }), NOW)).toBe(true);
  });

  it("does not flag a provisional post-mark next", () => {
    const nextEpisode = makeEpisode({ ids: { trakt: 0 }, firstAired: null });
    expect(needsNextEpisode(makeShow({ completed: 2, aired: 4, nextEpisode }), NOW)).toBe(false);
  });

  it("does not flag a never-started show", () => {
    expect(needsNextEpisode(makeShow({ completed: 0, aired: 4, nextEpisode: null }), NOW)).toBe(
      false,
    );
  });

  it("does not flag a caught-up show without newly aired episodes", () => {
    expect(needsNextEpisode(makeShow({ completed: 2, aired: 2, nextEpisode: null }), NOW)).toBe(
      false,
    );
  });
});
