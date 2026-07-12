import type { EpisodeView, SeasonView } from "@data/trakt/show-detail";
import {
  airedUnwatchedCount,
  backfillRangeLabel,
  continueKind,
  currentSeasonValue,
  earlierUnwatchedCount,
  lastAiredBound,
  metaLine,
  monthDayChip,
  seasonCheckFacts,
  traktEpisodeUrl,
  traktMovieUrl,
  traktShowUrl,
  watchRecordLine,
} from "@ui/screens/show-detail/detail-logic";
import { describe, expect, it } from "vitest";

function ep(season: number, number: number, overrides: Partial<EpisodeView> = {}): EpisodeView {
  return {
    season,
    number,
    title: `Ep ${number}`,
    firstAired: "2020-01-01T00:00:00.000Z",
    ids: { trakt: season * 100 + number },
    stills: [],
    watched: false,
    watchedAt: null,
    aired: true,
    ...overrides,
  };
}

function seasonOf(number: number, episodes: EpisodeView[]): SeasonView {
  return {
    number,
    title: null,
    isSpecial: number === 0,
    episodes,
    airedCount: episodes.filter((e) => e.aired).length,
    completedCount: episodes.filter((e) => e.watched).length,
  };
}

describe("metaLine", () => {
  it("joins truthy fragments with the quiet separator", () => {
    expect(metaLine(["2002", null, "Ended", undefined, "", "HBO"])).toBe("2002 · Ended · HBO");
  });
  it("is empty when nothing is known", () => {
    expect(metaLine([null, undefined, ""])).toBe("");
  });
});

describe("monthDayChip", () => {
  it("renders the UTC month + day", () => {
    expect(monthDayChip("2026-07-16T00:00:00.000Z")).toBe("Jul 16");
  });
  it("reads TBA for unknown or invalid dates", () => {
    expect(monthDayChip(null)).toBe("TBA");
    expect(monthDayChip("not-a-date")).toBe("TBA");
  });
});

describe("continueKind", () => {
  it("is next when the next episode has aired", () => {
    expect(
      continueKind({ season: 1, aired: true, firstAired: null }, "returning series", 10, 5),
    ).toEqual({ kind: "next" });
  });
  it("is returning when the next episode is scheduled", () => {
    expect(
      continueKind(
        { season: 3, aired: false, firstAired: "2026-08-01T00:00:00.000Z" },
        "returning series",
        10,
        10,
      ),
    ).toEqual({ kind: "returning", season: 3, date: "2026-08-01T00:00:00.000Z" });
  });
  it("is finished only for a completed ended/canceled show", () => {
    expect(continueKind(null, "ended", 62, 62)).toEqual({ kind: "finished" });
    expect(continueKind(null, "canceled", 8, 8)).toEqual({ kind: "finished" });
    expect(continueKind(null, "ended", 62, 40)).toEqual({ kind: "caught-up" });
  });
  it("is caught-up for a returning show between seasons with no date", () => {
    expect(continueKind(null, "returning series", 10, 10)).toEqual({ kind: "caught-up" });
  });
});

describe("bulk counts and bounds", () => {
  const seasons = [
    seasonOf(0, [ep(0, 1)]),
    seasonOf(1, [ep(1, 1, { watched: true }), ep(1, 2)]),
    seasonOf(2, [ep(2, 1), ep(2, 2, { watched: true }), ep(2, 3), ep(2, 4, { aired: false })]),
  ];

  it("counts aired unwatched episodes, skipping specials by default", () => {
    expect(airedUnwatchedCount(seasons)).toBe(3);
    expect(airedUnwatchedCount(seasons, true)).toBe(4);
  });

  it("bounds a whole-show mark at the last aired regular episode", () => {
    expect(lastAiredBound(seasons)).toEqual({ season: 2, number: 3 });
    expect(lastAiredBound([seasonOf(1, [ep(1, 1, { aired: false })])])).toBeNull();
  });

  it("counts the backfill gap strictly before the bound", () => {
    expect(earlierUnwatchedCount(seasons, { season: 2, number: 3 })).toBe(2);
    expect(earlierUnwatchedCount(seasons, { season: 1, number: 2 })).toBe(0);
    expect(earlierUnwatchedCount(seasons, { season: 0, number: 1 })).toBe(0);
  });
});

describe("backfillRangeLabel", () => {
  it("reads as a season range when the gap sits inside the bound's season", () => {
    const seasons = [
      seasonOf(2, [
        ep(2, 1),
        ep(2, 2),
        ep(2, 3),
        ep(2, 4, { watched: true }),
        ep(2, 5, { watched: true }),
      ]),
    ];
    expect(backfillRangeLabel(seasons, { season: 2, number: 5 }, 3)).toBe("S2 E1–E5 marked");
  });
  it("falls back to a coalesced count across seasons", () => {
    const seasons = [seasonOf(1, [ep(1, 1)]), seasonOf(2, [ep(2, 1), ep(2, 2, { watched: true })])];
    expect(backfillRangeLabel(seasons, { season: 2, number: 2 }, 2)).toBe("3 episodes marked");
  });
});

describe("currentSeasonValue", () => {
  const seasons = [
    seasonOf(1, [ep(1, 1, { watched: true })]),
    seasonOf(2, [ep(2, 1, { watched: true }), ep(2, 2)]),
    seasonOf(3, [ep(3, 1, { aired: false })]),
  ];
  it("prefers the next episode's season", () => {
    expect(currentSeasonValue(seasons, { season: 2 })).toBe("s2");
  });
  it("falls back to the first incomplete season, then the last", () => {
    expect(currentSeasonValue(seasons, null)).toBe("s2");
    const done = [
      seasonOf(1, [ep(1, 1, { watched: true })]),
      seasonOf(2, [ep(2, 1, { aired: false })]),
    ];
    expect(currentSeasonValue(done, null)).toBe("s2");
    expect(currentSeasonValue([], null)).toBeUndefined();
  });
});

describe("watchRecordLine", () => {
  it("is silent before any watch", () => {
    expect(watchRecordLine(0, 60, 45)).toBeNull();
  });
  it("carries hours only when the runtime is known", () => {
    expect(watchRecordLine(38, 60, null)).toBe("You've watched 38 of 60");
    expect(watchRecordLine(38, 60, 65)).toBe("You've watched 38 of 60 · 41 hr");
  });
});

describe("trakt urls", () => {
  it("prefers the slug and falls back to the trakt id", () => {
    expect(traktShowUrl({ trakt: 1390, slug: "the-wire" })).toBe("https://trakt.tv/shows/the-wire");
    expect(traktShowUrl({ trakt: 1390 })).toBe("https://trakt.tv/shows/1390");
    expect(traktEpisodeUrl({ trakt: 1390, slug: "the-wire" }, { season: 1, number: 5 })).toBe(
      "https://trakt.tv/shows/the-wire/seasons/1/episodes/5",
    );
    expect(traktMovieUrl({ trakt: 12, slug: "heat-1995" })).toBe(
      "https://trakt.tv/movies/heat-1995",
    );
  });
});

describe("seasonCheckFacts", () => {
  it("clamps to the aired basis so unaired specials never over-complete", () => {
    const season: SeasonView = {
      ...seasonOf(0, [ep(0, 1, { watched: true }), ep(0, 2, { watched: true, aired: false })]),
      completedCount: 2,
      airedCount: 1,
    };
    expect(seasonCheckFacts(season)).toEqual({ airedDone: 1, complete: true, partial: false });
  });
  it("reads partial for a half-watched season", () => {
    const season = seasonOf(2, [ep(2, 1, { watched: true }), ep(2, 2)]);
    expect(seasonCheckFacts(season)).toEqual({ airedDone: 1, complete: false, partial: true });
  });
  it("reads hollow for an untouched season", () => {
    const season = seasonOf(2, [ep(2, 1), ep(2, 2)]);
    expect(seasonCheckFacts(season)).toEqual({ airedDone: 0, complete: false, partial: false });
  });
});
