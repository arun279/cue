import { describe, expect, it } from "vitest";
import {
  additiveLanded,
  type EpisodePlay,
  markLanded,
  planEpisodeUnmark,
  planSeasonUnmark,
} from "@/core/domain/reversal";

const WATCHED_AT = "2026-06-01T00:00:00.000Z";

function play(
  historyId: number,
  season: number,
  number: number,
  episodeTrakt: number,
  watchedAt = WATCHED_AT,
): EpisodePlay {
  return { historyId, episodeTrakt, season, number, watchedAt };
}

describe("planSeasonUnmark", () => {
  it("removes each delta episode's single play by its exact history id, sorted by coordinate", () => {
    const plays = [play(131, 1, 3, 13), play(111, 1, 1, 11), play(121, 1, 2, 12)];
    const plan = planSeasonUnmark(plays, 1, false, new Set([1, 2, 3]));
    expect(plan.removeIds).toEqual([111, 121, 131]);
    expect(plan.restore).toEqual([
      { trakt: 11, season: 1, number: 1, watchedAt: WATCHED_AT },
      { trakt: 12, season: 1, number: 2, watchedAt: WATCHED_AT },
      { trakt: 13, season: 1, number: 3, watchedAt: WATCHED_AT },
    ]);
    expect(plan.keptRewatch).toEqual([]);
  });

  it("NEVER removes a play outside the mark delta: a pre-existing watch is left intact", () => {
    // E01/E02 were watched before the mark; the mark added only E03. The unmark must
    // touch E03 alone: removing E01/E02 would destroy history the mark never created.
    const plays = [play(111, 1, 1, 11), play(121, 1, 2, 12), play(131, 1, 3, 13)];
    const plan = planSeasonUnmark(plays, 1, false, new Set([3]));
    expect(plan.removeIds).toEqual([131]);
    expect(plan.removeIds).not.toContain(111);
    expect(plan.removeIds).not.toContain(121);
    expect(plan.restore).toEqual([{ trakt: 13, season: 1, number: 3, watchedAt: WATCHED_AT }]);
  });

  it("KEEPS a delta episode that gained a rewatch: its plays are never in the removal set", () => {
    const plays = [
      play(111, 1, 1, 11), // E01 watched once (from the mark)
      play(112, 1, 1, 11), // E01 watched again → rewatch after the mark
      play(121, 1, 2, 12), // E02 single play
      play(131, 1, 3, 13), // E03 single play
    ];
    const plan = planSeasonUnmark(plays, 1, false, new Set([1, 2, 3]));
    // Only the single-play episodes are removed; NEITHER of E01's history ids appears.
    expect(plan.removeIds).toEqual([121, 131]);
    expect(plan.removeIds).not.toContain(111);
    expect(plan.removeIds).not.toContain(112);
    expect(plan.keptRewatch).toEqual([{ season: 1, number: 1 }]);
  });

  it("scopes strictly to the target season: other seasons' plays are untouched", () => {
    const plays = [play(111, 1, 1, 11), play(211, 2, 1, 21)];
    const plan = planSeasonUnmark(plays, 2, false, new Set([1]));
    expect(plan.removeIds).toEqual([211]);
  });

  it("skips specials (season 0) unless opted in", () => {
    const plays = [play(911, 0, 1, 91)];
    expect(planSeasonUnmark(plays, 0, false, new Set([1])).removeIds).toEqual([]);
    expect(planSeasonUnmark(plays, 0, true, new Set([1])).removeIds).toEqual([911]);
  });

  it("returns an empty plan when nothing safe remains (all rewatches)", () => {
    const plays = [play(111, 1, 1, 11), play(112, 1, 1, 11)];
    const plan = planSeasonUnmark(plays, 1, false, new Set([1]));
    expect(plan.removeIds).toEqual([]);
    expect(plan.keptRewatch).toEqual([{ season: 1, number: 1 }]);
  });
});

describe("planEpisodeUnmark", () => {
  it("removes the single play by id", () => {
    const plan = planEpisodeUnmark([play(121, 1, 2, 12)], 12);
    expect(plan.removeIds).toEqual([121]);
    expect(plan.restore).toEqual([{ trakt: 12, season: 1, number: 2, watchedAt: WATCHED_AT }]);
    expect(plan.keptRewatch).toEqual([]);
  });

  it("refuses a rewatch: reports it kept, removes nothing", () => {
    const plan = planEpisodeUnmark([play(121, 1, 2, 12), play(122, 1, 2, 12)], 12);
    expect(plan.removeIds).toEqual([]);
    expect(plan.keptRewatch).toEqual([{ season: 1, number: 2 }]);
  });

  it("is a no-op when the episode has no plays", () => {
    const plan = planEpisodeUnmark([play(111, 1, 1, 11)], 99);
    expect(plan).toEqual({ removeIds: [], restore: [], keptRewatch: [] });
  });
});

describe("markLanded", () => {
  it("a mark landed once completed advanced past the pre-op count", () => {
    expect(markLanded("present", 3, 4)).toBe(true);
    expect(markLanded("present", 3, 3)).toBe(false);
  });

  it("an unmark landed once completed fell below the pre-op count", () => {
    expect(markLanded("absent", 4, 3)).toBe(true);
    expect(markLanded("absent", 4, 4)).toBe(false);
  });
});

describe("additiveLanded", () => {
  const watchedAt = "2026-07-05T12:34:00.000Z";
  const play = (overrides: Partial<EpisodePlay> = {}): EpisodePlay => ({
    historyId: 1,
    episodeTrakt: 4004,
    season: 4,
    number: 4,
    watchedAt,
    ...overrides,
  });

  it("hits an episode play at the exact watched-at minute", () => {
    expect(additiveLanded([play()], { episodeTrakt: 4004 }, watchedAt)).toBe(true);
  });

  it("hits a season probe Trakt stored up to 59 seconds earlier, as it truncates to the minute", () => {
    expect(additiveLanded([play()], { season: 4, number: 4 }, "2026-07-05T12:34:59.000Z")).toBe(
      true,
    );
  });

  it("misses a play stored after the sent time, or more than a minute before it", () => {
    expect(
      additiveLanded(
        [play({ watchedAt: "2026-07-05T12:34:30.000Z" })],
        { episodeTrakt: 4004 },
        watchedAt,
      ),
    ).toBe(false);
    expect(additiveLanded([play()], { episodeTrakt: 4004 }, "2026-07-05T12:35:01.000Z")).toBe(
      false,
    );
  });

  it("misses the wrong episode id or season probe", () => {
    expect(additiveLanded([play()], { episodeTrakt: 4005 }, watchedAt)).toBe(false);
    expect(additiveLanded([play()], { season: 5, number: 4 }, watchedAt)).toBe(false);
    expect(additiveLanded([play()], { season: 4, number: 5 }, watchedAt)).toBe(false);
  });
});
