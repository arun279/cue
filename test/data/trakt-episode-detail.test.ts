import { assembleEpisodeDetail } from "@data/trakt/episode-detail";
import type { EpisodeData, Progress } from "@data/trakt/schemas";
import { describe, expect, it } from "vitest";

const NOW = Date.UTC(2026, 6, 5);
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const episode: EpisodeData = {
  season: 1,
  number: 2,
  title: "Half Loop",
  overview: "The second episode.",
  runtime: 48,
  first_aired: iso(NOW - 2 * DAY),
  ids: { trakt: 41, tmdb: 900 },
  images: { screenshot: ["media.trakt.tv/still.webp"] },
};

const progress: Progress = {
  aired: 3,
  completed: 2,
  next_episode: null,
  seasons: [
    {
      number: 1,
      aired: 3,
      completed: 2,
      episodes: [
        { number: 1, completed: true, last_watched_at: iso(NOW - 3 * DAY) },
        { number: 2, completed: true, last_watched_at: iso(NOW - DAY) },
        { number: 3, completed: false },
      ],
    },
  ],
};

describe("assembleEpisodeDetail", () => {
  it("maps content, still candidates, watched flag + date, and aired flag", () => {
    const detail = assembleEpisodeDetail(1, episode, progress, NOW);
    expect(detail).toMatchObject({
      showId: 1,
      season: 1,
      number: 2,
      title: "Half Loop",
      overview: "The second episode.",
      runtime: 48,
      aired: true,
      watched: true,
      stills: ["media.trakt.tv/still.webp"],
    });
    expect(detail.watchedAt).toBe(iso(NOW - DAY));
    expect(detail.ids).toEqual({ trakt: 41, tmdb: 900 });
  });

  it("derives prev/next from the ordered progress episodes", () => {
    const detail = assembleEpisodeDetail(1, episode, progress, NOW);
    expect(detail.prev).toEqual({ season: 1, number: 1 });
    expect(detail.next).toEqual({ season: 1, number: 3 });
  });

  it("has no prev at the first episode and no next at the last", () => {
    const first = assembleEpisodeDetail(1, { ...episode, number: 1 }, progress, NOW);
    expect(first.prev).toBeNull();
    const last = assembleEpisodeDetail(1, { ...episode, number: 3 }, progress, NOW);
    expect(last.next).toBeNull();
  });

  it("inserts a target absent from progress into the ordering so it still gets neighbours", () => {
    // An unaired episode reached from Show detail is not in the progress tree.
    const future: EpisodeData = {
      season: 1,
      number: 4,
      title: null,
      first_aired: iso(NOW + DAY),
      ids: { trakt: 44 },
    };
    const detail = assembleEpisodeDetail(1, future, progress, NOW);
    expect(detail.aired).toBe(false);
    expect(detail.watched).toBe(false);
    expect(detail.watchedAt).toBeNull();
    expect(detail.prev).toEqual({ season: 1, number: 3 });
    expect(detail.next).toBeNull();
    expect(detail.overview).toBeNull();
  });

  it("falls back through screenshot → thumb → empty for stills", () => {
    const thumbOnly = { ...episode, images: { thumb: ["media.trakt.tv/thumb.webp"] } };
    expect(assembleEpisodeDetail(1, thumbOnly, progress, NOW).stills).toEqual([
      "media.trakt.tv/thumb.webp",
    ]);
    const noArt = { ...episode, images: undefined };
    expect(assembleEpisodeDetail(1, noArt, progress, NOW).stills).toEqual([]);
  });

  it("tolerates progress with no seasons array", () => {
    const detail = assembleEpisodeDetail(
      1,
      episode,
      { aired: 0, completed: 0, next_episode: null },
      NOW,
    );
    expect(detail.watched).toBe(false);
    expect(detail.prev).toBeNull();
    expect(detail.next).toBeNull();
  });
});
