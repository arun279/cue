import { describe, expect, it } from "vitest";
import { airsLine, episodeStatus, sheetMetaLine } from "@/core/domain/episode-detail";
import {
  continuePosition,
  defaultSeason,
  earlierUnwatchedCount,
  episodeNavigation,
  orderSeasons,
  returnsLine,
  seasonConfirmation,
  watchedSummary,
} from "@/core/domain/show-detail";

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
    expect(continuePosition({ ...progress, completed: 24 }, now).kind).toBe("next");
    expect(continuePosition(progress, now)).toEqual({ kind: "returning", season: 3, days: 87 });
    expect(continuePosition({ ...progress, status: "ended" }, now).kind).toBe("finished");
    expect(continuePosition({ ...progress, nextEpisode: null }, now).kind).toBe("caught-up");
    expect(continuePosition({ ...progress, status: "ended", pendingAdvance: true }, now).kind).toBe(
      "next",
    );
    const at = (ms: number) => continuePosition(progress, ms);
    expect(at(Date.parse(next.firstAired) - 86_400_000)).toMatchObject({ days: 1 });
    expect(at(Date.parse(next.firstAired)).kind).toBe("caught-up");
    expect(returnsLine({ season: 3, days: 87 })).toBe("S3 returns in 87 days");
    expect(returnsLine({ season: 3, days: 1 })).toBe("S3 returns in 1 day");
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
    const pilot = { season: 1, number: 1 };
    const second = { season: 1, number: 2 };
    expect(episodeNavigation([{ episodes: [second, pilot] }], pilot).next).toBe(second);
    expect(episodeNavigation(seasons, { season: 9, number: 1 })).toEqual({
      prev: null,
      next: null,
    });
  });
});

describe("season confirmations", () => {
  it("offers remaining or rewatch against aired counts", () => {
    expect(seasonConfirmation({ number: 2, airedCount: 6, completedCount: 3 }, "multiple")).toEqual(
      {
        kind: "remaining",
        title: "Mark Season 2 watched?",
        message: "3 of 6 episodes are unwatched.",
        primary: "Mark 3 remaining",
        secondary: "Mark all 6 again (rewatch)",
      },
    );
  });
  it("names a single watched episode in the singular", () => {
    expect(
      seasonConfirmation({ number: 1, airedCount: 4, completedCount: 1 }, "unknown").message,
    ).toBe(
      "3 of 4 episodes are unwatched. If your Trakt account keeps one play per episode, this replaces the watch date of the 1 you've watched.",
    );
  });
  it("says before a rewatch that a one-play account loses the watch dates", () => {
    const season = { number: 2, airedCount: 6, completedCount: 3 };
    expect(seasonConfirmation(season, "one-play")).toMatchObject({
      message:
        "3 of 6 episodes are unwatched. Your Trakt account keeps one play per episode, so this replaces the watch dates of the 3 you've watched. You can change this in your Trakt settings.",
      secondary: "Mark all 6 again",
      secondaryDestructive: true,
    });
    expect(seasonConfirmation(season, "unknown")).toEqual({
      kind: "remaining",
      title: "Mark Season 2 watched?",
      message:
        "3 of 6 episodes are unwatched. If your Trakt account keeps one play per episode, this replaces the watch dates of the 3 you've watched.",
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

describe("watch summary", () => {
  const specials = (completedCount: number) => [
    { isSpecial: false, completedCount: 12 },
    { isSpecial: true, completedCount },
  ];

  it("adds the specials watched to the regular count, and leaves it alone without any", () => {
    expect(watchedSummary({ completed: 0, aired: 20, runtime: null }, specials(4))).toBe(
      "You've watched 0 of 20 · 4 specials",
    );
    expect(watchedSummary({ completed: 12, aired: 20, runtime: 45 }, specials(1))).toBe(
      "You've watched 12 of 20 · 1 special · 9 hr",
    );
    for (const seasons of [specials(0), []]) {
      expect(watchedSummary({ completed: 12, aired: 20, runtime: 45 }, seasons)).toBe(
        "You've watched 12 of 20 · 9 hr",
      );
    }
  });
});

describe("episode copy", () => {
  it("never describes a future air date as already aired", () => {
    const episode = {
      season: 3,
      number: 6,
      aired: false,
      firstAired: new Date(2026, 7, 27, 12).toISOString(),
      runtime: 58,
    };
    expect(sheetMetaLine(episode)).toBe("S3 E6 · 58 min");
    expect(sheetMetaLine({ ...episode, aired: true })).toBe("S3 E6 · Aired Aug 27, 2026 · 58 min");
    expect(sheetMetaLine({ ...episode, runtime: null })).toBe("S3 E6");
    expect(airsLine(episode.firstAired)).toMatch(/^Airs Thu Aug 27 · /);
  });
  it("keeps the watch-status grammar for each play count", () => {
    expect(episodeStatus(false, null, 0)).toBe("Not watched yet");
    expect(episodeStatus(true, new Date(2008, 2, 16, 12).toISOString(), 1)).toBe(
      "Watched Mar 16, 2008",
    );
    expect(episodeStatus(true, null, 1)).toBe("Watched");
    expect(episodeStatus(true, null, 2)).toBe("Watched twice");
    expect(episodeStatus(true, null, 3)).toBe("Watched 3 times");
  });
});
