import {
  advancePastNext,
  assembleLibrary,
  type LibraryEntry,
  type LibraryInput,
  markLanded,
  showIdSet,
} from "@data/trakt/library";
import type { Progress, WatchedShow, WatchlistItem } from "@data/trakt/schemas";
import { describe, expect, it } from "vitest";

function watchlistItem(overrides: {
  trakt: number;
  title?: string;
  status?: string;
  posters?: string[];
  tmdb?: number;
}): WatchlistItem {
  return {
    type: "show",
    show: {
      title: overrides.title ?? "Watchlisted",
      status: overrides.status ?? "returning series",
      ids: { trakt: overrides.trakt, tmdb: overrides.tmdb },
      images: overrides.posters ? { poster: overrides.posters } : undefined,
    },
  };
}

function watchedShow(overrides: {
  trakt: number;
  title?: string;
  status?: string;
  lastWatchedAt?: string | null;
  posters?: string[];
  tmdb?: number;
  /** Watched-episode counts per season number (the bulk `/sync/watched/shows` breakdown). */
  seasons?: Record<number, number>;
}): WatchedShow {
  return {
    last_watched_at: overrides.lastWatchedAt ?? "2026-07-01T00:00:00.000Z",
    show: {
      title: overrides.title ?? "Show",
      status: overrides.status ?? "returning series",
      ids: { trakt: overrides.trakt, tmdb: overrides.tmdb },
      images: overrides.posters ? { poster: overrides.posters } : undefined,
    },
    ...(overrides.seasons === undefined
      ? {}
      : {
          seasons: Object.entries(overrides.seasons).map(([number, count]) => ({
            number: Number(number),
            episodes: Array.from({ length: count }, (_, i) => ({ number: i + 1 })),
          })),
        }),
  };
}

function progress(overrides: {
  aired?: number;
  completed?: number;
  next?: Progress["next_episode"];
}): Progress {
  return {
    aired: overrides.aired ?? 10,
    completed: overrides.completed ?? 3,
    next_episode:
      overrides.next === undefined
        ? {
            season: 1,
            number: 4,
            title: "Four",
            first_aired: "2026-06-01T00:00:00.000Z",
            ids: { trakt: 4004, tvdb: 9, imdb: "tt4", tmdb: 44 },
          }
        : overrides.next,
  };
}

const baseEntry: LibraryEntry = {
  showId: 1,
  title: "Show",
  status: "returning series",
  hidden: false,
  inWatchlist: false,
  lastWatchedAt: "2026-07-01T00:00:00.000Z",
  aired: 10,
  completed: 3,
  nextEpisode: {
    season: 1,
    number: 4,
    title: "Four",
    firstAired: "2026-06-01T00:00:00.000Z",
    ids: { trakt: 4004 },
  },
  posters: [],
  backdrops: [],
  network: null,
  genres: [],
  runtime: null,
  tmdbId: null,
  pendingAdvance: false,
};

describe("assembleLibrary", () => {
  it("merges watched + progress + hidden + watchlist + images into entries", () => {
    const input: LibraryInput = {
      watchedShows: [
        watchedShow({ trakt: 1, title: "A", posters: ["media.trakt.tv/a.webp"], tmdb: 55 }),
        watchedShow({ trakt: 2, title: "B" }),
      ],
      progress: new Map([[1, progress({})]]),
      hiddenShowIds: new Set([2]),
      watchlistShows: [watchlistItem({ trakt: 1, title: "A" })],
    };
    const entries = assembleLibrary(input);
    expect(entries).toHaveLength(2);

    const a = entries[0];
    expect(a?.showId).toBe(1);
    expect(a?.inWatchlist).toBe(true);
    expect(a?.hidden).toBe(false);
    expect(a?.posters).toEqual(["media.trakt.tv/a.webp"]);
    expect(a?.tmdbId).toBe(55);
    expect(a?.nextEpisode).toEqual({
      season: 1,
      number: 4,
      title: "Four",
      firstAired: "2026-06-01T00:00:00.000Z",
      ids: { trakt: 4004, tvdb: 9, imdb: "tt4", tmdb: 44 },
    });
  });

  it("degrades a show with no fetched progress to zero-progress + no next episode", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 7 })],
      progress: new Map(),
      hiddenShowIds: new Set(),
      watchlistShows: [],
    });
    expect(entries[0]).toMatchObject({
      aired: 0,
      completed: 0,
      nextEpisode: null,
      tmdbId: null,
      status: "returning series",
    });
  });

  it("baselines an un-fetched watched show to its watched-episode count as caught-up", () => {
    // Beyond the cold-sync progress budget: no progress entry, but the bulk watched
    // breakdown carries the season/episode tree — so completed === aired (caught up,
    // no next), NOT zero (which would misfile it as never-started). Specials excluded.
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 12, seasons: { 0: 2, 1: 8, 2: 6 } })],
      progress: new Map(),
      hiddenShowIds: new Set(),
      watchlistShows: [],
    });
    expect(entries[0]).toMatchObject({ completed: 14, aired: 14, nextEpisode: null });
  });

  it("maps a next episode carrying only a trakt id (optional ids omitted)", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 8 })],
      progress: new Map([
        [
          8,
          progress({
            next: {
              season: 2,
              number: 1,
              title: null,
              first_aired: "2026-05-01T00:00:00.000Z",
              ids: { trakt: 8001 },
            },
          }),
        ],
      ]),
      hiddenShowIds: new Set(),
      watchlistShows: [],
    });
    expect(entries[0]?.nextEpisode?.ids).toEqual({ trakt: 8001 });
    expect(entries[0]?.nextEpisode?.title).toBeNull();
  });

  it("carries a null next_episode through (caught-up show)", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 3 })],
      progress: new Map([[3, progress({ next: null })]]),
      hiddenShowIds: new Set(),
      watchlistShows: [],
    });
    expect(entries[0]?.nextEpisode).toBeNull();
  });

  it("materializes a never-watched watchlisted show as a zero-progress to-watch entry", () => {
    const entries = assembleLibrary({
      watchedShows: [],
      progress: new Map(),
      hiddenShowIds: new Set(),
      watchlistShows: [watchlistItem({ trakt: 9, title: "Queued", posters: ["p.webp"], tmdb: 77 })],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      showId: 9,
      title: "Queued",
      inWatchlist: true,
      aired: 0,
      completed: 0,
      nextEpisode: null,
      lastWatchedAt: null,
      posters: ["p.webp"],
      tmdbId: 77,
    });
  });

  it("merges show-detail art (poster/backdrop/network/genres/runtime) over the inline list", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 5, title: "Detailed", posters: ["inline.webp"] })],
      progress: new Map([[5, progress({})]]),
      hiddenShowIds: new Set(),
      watchlistShows: [],
      details: new Map([
        [
          5,
          {
            posters: ["detail-poster.webp"],
            backdrops: ["detail-fanart.webp"],
            network: "AMC",
            genres: ["drama", "crime"],
            runtime: 47,
          },
        ],
      ]),
    });
    expect(entries[0]).toMatchObject({
      posters: ["detail-poster.webp"],
      backdrops: ["detail-fanart.webp"],
      network: "AMC",
      genres: ["drama", "crime"],
      runtime: 47,
    });
  });

  it("falls back to the inline poster and empty metadata when no detail art is provided", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 6, posters: ["inline.webp"] })],
      progress: new Map([[6, progress({})]]),
      hiddenShowIds: new Set(),
      watchlistShows: [],
    });
    expect(entries[0]).toMatchObject({
      posters: ["inline.webp"],
      backdrops: [],
      network: null,
      genres: [],
      runtime: null,
    });
  });

  it("does not duplicate a watchlisted show that is also watched", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 4, title: "Both" })],
      progress: new Map([[4, progress({})]]),
      hiddenShowIds: new Set(),
      watchlistShows: [watchlistItem({ trakt: 4, title: "Both" })],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.inWatchlist).toBe(true);
    expect(entries[0]?.completed).toBe(3);
  });
});

describe("showIdSet", () => {
  it("collects show trakt ids and ignores movie-only entries", () => {
    const set = showIdSet([
      { type: "show", show: { title: "A", ids: { trakt: 10 } } },
      { type: "movie", movie: { title: "M", ids: { trakt: 99 } } },
    ]);
    expect([...set]).toEqual([10]);
  });
});

describe("advancePastNext", () => {
  it("projects the following episode with an unknown air date, bumps completed, flags pendingAdvance", () => {
    const advanced = advancePastNext(baseEntry, "2026-07-05T12:00:00.000Z");
    expect(advanced.completed).toBe(4);
    expect(advanced.lastWatchedAt).toBe("2026-07-05T12:00:00.000Z");
    expect(advanced.pendingAdvance).toBe(true);
    expect(advanced.nextEpisode).toEqual({
      season: 1,
      number: 5,
      title: null,
      firstAired: null,
      ids: { trakt: 0 },
    });
  });

  it("never inherits the watched episode's air date (no season-finale phantom in New)", () => {
    // A recent air date on the source episode must NOT flow onto the projection —
    // that is exactly what made a marked finale cling to the fresh/lead slot.
    const entry: LibraryEntry = {
      ...baseEntry,
      nextEpisode: {
        season: 1,
        number: 4,
        title: "Finale",
        firstAired: "2026-07-04T00:00:00.000Z",
        ids: { trakt: 4004 },
      },
    };
    expect(advancePastNext(entry, "2026-07-05T12:00:00.000Z").nextEpisode?.firstAired).toBeNull();
  });

  it("leaves a caught-up entry (null next) with no projected episode", () => {
    const entry = { ...baseEntry, nextEpisode: null };
    const advanced = advancePastNext(entry, "2026-07-05T12:00:00.000Z");
    expect(advanced.nextEpisode).toBeNull();
    expect(advanced.completed).toBe(4);
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
