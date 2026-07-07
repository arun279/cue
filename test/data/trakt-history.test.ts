import { assembleHistoryEntries } from "@data/trakt/history";
import type { HistoryItem } from "@data/trakt/schemas";
import { describe, expect, it } from "vitest";

const WATCHED_AT = "2026-07-05T21:24:00.000Z";

const episodeItem: HistoryItem = {
  id: 100,
  watched_at: WATCHED_AT,
  type: "episode",
  episode: { season: 1, number: 5, title: "Sheridan", ids: { trakt: 55, tmdb: 5 } },
  show: { title: "The Bear", ids: { trakt: 9, tmdb: 99 }, images: { poster: ["p.webp"] } },
};

const movieItem: HistoryItem = {
  id: 101,
  watched_at: WATCHED_AT,
  type: "movie",
  movie: { title: "Dune", year: 2021, ids: { trakt: 7, tmdb: 77 }, images: { poster: ["m.webp"] } },
};

describe("assembleHistoryEntries", () => {
  it("flattens an episode play: show is the poster subject, episode the SxEy + item id", () => {
    const [entry] = assembleHistoryEntries([episodeItem]);
    expect(entry).toMatchObject({
      historyId: 100,
      watchedAt: WATCHED_AT,
      type: "episode",
      mediaId: 9, // the SHOW id — the poster + detail-link subject
      title: "The Bear",
      season: 1,
      number: 5,
      episodeTitle: "Sheridan",
      year: null,
      posters: ["p.webp"],
      tmdbId: 99,
    });
    // The per-play restore needs the EPISODE's own ids, not the show's.
    expect(entry?.ids.trakt).toBe(55);
  });

  it("flattens a movie play with its year and its own ids", () => {
    const [entry] = assembleHistoryEntries([movieItem]);
    expect(entry).toMatchObject({
      historyId: 101,
      type: "movie",
      mediaId: 7,
      title: "Dune",
      year: 2021,
      season: null,
      number: null,
      posters: ["m.webp"],
      tmdbId: 77,
    });
    expect(entry?.ids.trakt).toBe(7);
  });

  it("drops rows whose declared type is missing its item (malformed / unsupported season play)", () => {
    const entries = assembleHistoryEntries([
      episodeItem,
      { id: 102, watched_at: WATCHED_AT, type: "season" },
      { id: 103, watched_at: WATCHED_AT, type: "episode" }, // no episode/show
      movieItem,
    ]);
    expect(entries.map((e) => e.historyId)).toEqual([100, 101]);
  });

  it("preserves the feed order (newest-first from Trakt) so day grouping stays correct", () => {
    const entries = assembleHistoryEntries([movieItem, episodeItem]);
    expect(entries.map((e) => e.historyId)).toEqual([101, 100]);
  });
});
