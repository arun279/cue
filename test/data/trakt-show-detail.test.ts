import type { Progress, SeasonData, ShowDetailData } from "@data/trakt/schemas";
import { assembleHeader, assembleSeasons } from "@data/trakt/show-detail";
import { describe, expect, it } from "vitest";

const NOW = Date.UTC(2026, 6, 5);
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const showData: ShowDetailData = {
  title: "Severance",
  year: 2022,
  status: "returning series",
  overview: "Work-life balance, taken literally.",
  network: "Apple TV+",
  first_aired: iso(NOW - 400 * DAY),
  ids: { trakt: 1, slug: "severance", tmdb: 95396 },
  images: { poster: ["media.trakt.tv/p.webp"], fanart: ["media.trakt.tv/b.webp"] },
};

const WATCHED_AT = "2026-07-03T21:30:00.000Z";

const progress: Progress = {
  aired: 3,
  completed: 2,
  last_watched_at: WATCHED_AT,
  next_episode: {
    season: 1,
    number: 3,
    title: "In Perpetuity",
    first_aired: iso(NOW - DAY),
    ids: { trakt: 42 },
  },
  seasons: [
    {
      number: 0,
      aired: 1,
      completed: 0,
      episodes: [{ number: 1, completed: false }],
    },
    {
      number: 1,
      aired: 2,
      completed: 2,
      episodes: [
        { number: 1, completed: true, last_watched_at: WATCHED_AT },
        { number: 2, completed: true, last_watched_at: WATCHED_AT },
        { number: 3, completed: false },
      ],
    },
  ],
};

const seasons: SeasonData[] = [
  {
    number: 1,
    title: "Season 1",
    episodes: [
      {
        season: 1,
        number: 2,
        title: "Half Loop",
        first_aired: iso(NOW - 2 * DAY),
        ids: { trakt: 41 },
      },
      {
        season: 1,
        number: 1,
        title: "Good News",
        first_aired: iso(NOW - 3 * DAY),
        ids: { trakt: 40 },
      },
      {
        season: 1,
        number: 3,
        title: "In Perpetuity",
        first_aired: iso(NOW + DAY),
        ids: { trakt: 42 },
      },
    ],
  },
  {
    number: 0,
    title: "Specials",
    episodes: [
      { season: 0, number: 1, title: "BTS", first_aired: iso(NOW - DAY), ids: { trakt: 90 } },
    ],
  },
];

describe("assembleHeader", () => {
  it("maps the extended show payload + progress into the hero model", () => {
    const header = assembleHeader(showData, progress, NOW);
    expect(header).toMatchObject({
      showId: 1,
      title: "Severance",
      year: 2022,
      network: "Apple TV+",
      overview: "Work-life balance, taken literally.",
      posters: ["media.trakt.tv/p.webp"],
      backdrops: ["media.trakt.tv/b.webp"],
      tmdbId: 95396,
      aired: 3,
      completed: 2,
    });
    expect(header.ids).toEqual({ trakt: 1, slug: "severance", tmdb: 95396 });
  });

  it("derives the next-episode callout with its aired flag", () => {
    expect(assembleHeader(showData, progress, NOW).nextEpisode).toMatchObject({
      season: 1,
      number: 3,
      aired: true,
      watched: false,
    });
  });

  it("surfaces the show's last-watched date (recognition over recall)", () => {
    expect(assembleHeader(showData, progress, NOW).lastWatchedAt).toBe(WATCHED_AT);
  });

  it("nulls last-watched for a never-watched show", () => {
    const bare: ShowDetailData = { title: "Bare", ids: { trakt: 9 } };
    const header = assembleHeader(bare, { aired: 0, completed: 0, next_episode: null }, NOW);
    expect(header.lastWatchedAt).toBeNull();
  });

  it("nulls the callout when caught up and tolerates missing optional fields", () => {
    const bare: ShowDetailData = { title: "Bare", ids: { trakt: 9 } };
    const header = assembleHeader(bare, { aired: 0, completed: 0, next_episode: null }, NOW);
    expect(header.nextEpisode).toBeNull();
    expect(header).toMatchObject({
      year: null,
      network: null,
      overview: null,
      posters: [],
      backdrops: [],
    });
  });
});

describe("assembleSeasons", () => {
  it("merges per-episode watched flags, sorts seasons + episodes, and derives aired", () => {
    const views = assembleSeasons(seasons, progress, NOW);
    expect(views.map((s) => s.number)).toEqual([1, 0]);
    const s1 = views[0];
    expect(s1?.episodes.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(s1?.episodes.map((e) => e.watched)).toEqual([true, true, false]);
    expect(s1?.episodes.map((e) => e.aired)).toEqual([true, true, false]);
    expect(s1).toMatchObject({ airedCount: 2, completedCount: 2, isSpecial: false });
  });

  it("surfaces each watched episode's date and leaves unwatched ones null", () => {
    const s1 = assembleSeasons(seasons, progress, NOW)[0];
    expect(s1?.episodes.map((e) => e.watchedAt)).toEqual([WATCHED_AT, WATCHED_AT, null]);
  });

  it("flags season 0 as specials and sorts it after the numbered run", () => {
    const specials = assembleSeasons(seasons, progress, NOW)[1];
    expect(specials).toMatchObject({ number: 0, isSpecial: true });
    expect(specials?.episodes[0]?.watched).toBe(false);
  });

  it("treats a season with no progress entry as fully unwatched", () => {
    const views = assembleSeasons(seasons, { aired: 0, completed: 0, next_episode: null }, NOW);
    expect(views.every((s) => s.completedCount === 0)).toBe(true);
  });

  it("tolerates a season with no episodes array", () => {
    const views = assembleSeasons([{ number: 4, title: "Upcoming" }], progress, NOW);
    expect(views[0]).toMatchObject({ number: 4, episodes: [], airedCount: 0, completedCount: 0 });
  });
});
