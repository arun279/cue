import { describe, expect, it } from "vitest";
import { airsLine, episodeStatus, sheetMetaLine } from "../../src/domain/episode-detail";
import {
  continueKind,
  defaultSeason,
  earlierUnwatchedCount,
  episodeNavigation,
  orderSeasons,
  returnsLine,
  seasonConfirmation,
} from "../../src/domain/show-detail";

const next = {
  season: 3,
  number: 1,
  title: null,
  ids: { trakt: 1 },
  still: null,
  firstAired: "2026-11-16T12:00:00Z",
};
const now = Date.parse("2026-08-21T12:00:00Z");
const progress = {
  status: "returning series",
  completed: 25,
  aired: 25,
  pendingAdvance: false,
  nextEpisode: next,
};
const season = (number: number) => ({
  number,
  isSpecial: number === 0,
  isHidden: false,
  episodes: [{ season: number, number: 1, aired: true, watched: false }],
});

describe("show position", () => {
  it("distinguishes backlog, returning, finished and caught up without calling a projection finished", () => {
    expect(continueKind({ ...progress, completed: 24 }, now)).toBe("next");
    expect(continueKind(progress, now)).toBe("returning");
    expect(continueKind({ ...progress, status: "ended" }, now)).toBe("finished");
    expect(continueKind({ ...progress, nextEpisode: null }, now)).toBe("caught-up");
    expect(continueKind({ ...progress, status: "ended", pendingAdvance: true }, now)).toBe("next");
    expect(returnsLine(next, now)).toBe("S3 returns in 87 days");
    expect(returnsLine(next, Date.parse(next.firstAired))).toBe("S3 returns today");
  });

  it("puts recent seasons first, Specials last, and opens the queued season", () => {
    const seasons = [season(0), season(1), season(3), season(2)];
    expect(orderSeasons(seasons).map((row) => row.number)).toEqual([3, 2, 1, 0]);
    expect(seasons[0]?.number).toBe(0);
    expect(defaultSeason(seasons, { season: 2, number: 1 })).toBe(2);
    expect(defaultSeason(seasons, null)).toBe(3);
    expect(defaultSeason([season(0)], null)).toBeNull();
  });

  it("counts only earlier aired, visible, unwatched regular episodes", () => {
    const seasons = [season(0), season(1), { ...season(2), isHidden: true }, season(3)];
    expect(earlierUnwatchedCount(seasons, { season: 3, number: 1 })).toBe(1);
    expect(
      earlierUnwatchedCount(
        [{ ...season(1), episodes: [{ season: 1, number: 1, aired: false, watched: false }] }],
        next,
      ),
    ).toBe(0);
  });

  it("pages through the full tree including future episodes, with Specials after the run", () => {
    const seasons = [
      season(0),
      season(1),
      { ...season(2), episodes: [{ season: 2, number: 1, aired: false, watched: false }] },
    ];
    expect(episodeNavigation(seasons, { season: 1, number: 1 })).toEqual({
      prev: null,
      next: seasons[2]?.episodes[0],
    });
    expect(episodeNavigation(seasons, { season: 0, number: 1 }).next).toBeNull();
    expect(episodeNavigation(seasons, { season: 9, number: 1 })).toEqual({
      prev: null,
      next: null,
    });
  });
});

describe("season confirmations", () => {
  it("offers remaining or rewatch against aired counts", () => {
    expect(seasonConfirmation({ number: 2, airedCount: 6, completedCount: 3 })).toEqual({
      kind: "remaining",
      title: "Mark Season 2 watched?",
      message: "3 of 6 episodes are unwatched.",
      primary: "Mark 3 remaining",
      secondary: "Mark all 6 again (rewatch)",
    });
  });
  it("names the consequence when none or all are watched", () => {
    expect(seasonConfirmation({ number: 2, airedCount: 1, completedCount: 0 })).toEqual({
      kind: "mark",
      title: "Mark Season 2 watched?",
      message: "1 episode will be added to your history.",
      primary: "Mark 1 episode",
    });
    expect(seasonConfirmation({ number: 1, airedCount: 8, completedCount: 8 })).toEqual({
      kind: "unmark",
      title: "Unmark Season 1?",
      message: "Removes 8 episodes from your history.",
      primary: "Remove 8 episodes",
    });
    expect(seasonConfirmation({ number: 0, airedCount: 2, completedCount: 0 }).title).toBe(
      "Mark Specials watched?",
    );
  });
});

describe("episode copy", () => {
  it("never describes a future air date as already aired", () => {
    const episode = {
      season: 3,
      number: 6,
      aired: false,
      firstAired: "2026-08-27T12:00:00Z",
      runtime: 58,
    };
    expect(sheetMetaLine(episode)).toBe("S3 E6 · 58 min");
    expect(sheetMetaLine({ ...episode, aired: true })).toBe("S3 E6 · Aired Aug 27, 2026 · 58 min");
    expect(sheetMetaLine({ ...episode, runtime: null })).toBe("S3 E6");
    expect(airsLine(episode.firstAired)).toMatch(/^Airs Thu Aug 27 · /);
  });
  it("keeps the watch-status grammar for each play count", () => {
    expect(episodeStatus(false, null, 0)).toBe("Not watched yet");
    expect(episodeStatus(true, "2008-03-16T12:00:00Z", 1)).toBe("Watched Mar 16, 2008");
    expect(episodeStatus(true, null, 1)).toBe("Watched");
    expect(episodeStatus(true, null, 2)).toBe("Watched twice");
    expect(episodeStatus(true, null, 3)).toBe("Watched 3 times");
  });
});
