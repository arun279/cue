import { describe, expect, it } from "vitest";
import {
  assembleLibrary,
  type LibraryInput,
  showIdSet,
  watchedEpisodeCount,
} from "@/core/data/trakt/library";
import type { Progress, WatchedShow, WatchlistItem } from "@/core/data/trakt/schemas";
import { baseEntry } from "../domain/_helpers";

function watchlistItem(overrides: {
  trakt: number;
  title?: string;
  status?: string;
  tmdb?: number;
}): WatchlistItem {
  return {
    type: "show",
    show: {
      title: overrides.title ?? "Watchlisted",
      status: overrides.status ?? "returning series",
      ids: { trakt: overrides.trakt, tmdb: overrides.tmdb },
    },
  };
}

function watchedShow(overrides: {
  trakt: number;
  title?: string;
  status?: string;
  lastWatchedAt?: string | null;
  tmdb?: number;
  runtime?: number;
  /** The row's `aired_episodes`: aired-to-date, the bulk `aired` every entry carries. */
  airedEpisodes?: number;
  /** Watched-episode counts per season number (the bulk `/sync/watched/shows` breakdown). */
  seasons?: Record<number, number>;
}): WatchedShow {
  return {
    last_watched_at: overrides.lastWatchedAt ?? "2026-07-01T00:00:00.000Z",
    show: {
      title: overrides.title ?? "Show",
      status: overrides.status ?? "returning series",
      aired_episodes: overrides.airedEpisodes ?? 0,
      ids: { trakt: overrides.trakt, tmdb: overrides.tmdb },
      runtime: overrides.runtime,
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
  seasons?: Progress["seasons"];
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
            images: { screenshot: ["media.trakt.tv/still.webp"] },
          }
        : overrides.next,
    seasons: overrides.seasons,
  };
}

describe("assembleLibrary", () => {
  it("carries each watched show's runtime and leaves a watchlist-only show's unknown", () => {
    const entries = assembleLibrary({
      watchedShows: [
        watchedShow({ trakt: 1, runtime: 42, seasons: { 1: 2 } }),
        watchedShow({ trakt: 2 }),
      ],
      progress: new Map(),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [{ type: "show", show: { title: "Later", ids: { trakt: 3 } } }],
    });
    expect(entries.map((entry) => [entry.showId, entry.runtime])).toEqual([
      [1, 42],
      [2, null],
      [3, null],
    ]);
  });

  it("merges watched + progress + hidden + watchlist into entries", () => {
    const input: LibraryInput = {
      watchedShows: [watchedShow({ trakt: 1, title: "A", tmdb: 55 }), watchedShow({ trakt: 2 })],
      progress: new Map([
        [
          1,
          progress({
            seasons: [
              {
                number: 0,
                aired: 2,
                completed: 2,
                episodes: [{ number: 9, completed: true, last_watched_at: null }],
              },
              {
                number: 1,
                aired: 8,
                completed: 8,
                episodes: [{ number: 8, completed: true, last_watched_at: null }],
              },
              {
                number: 2,
                aired: 3,
                completed: 1,
                episodes: [{ number: 3, completed: false, last_watched_at: null }],
              },
            ],
          }),
        ],
      ]),
      hiddenShowIds: new Set([2]),
      collectionShows: [],
      watchlistShows: [watchlistItem({ trakt: 1, title: "A" })],
    };
    const entries = assembleLibrary(input);
    expect(entries).toHaveLength(2);

    const a = entries[0];
    expect(a?.showId).toBe(1);
    expect(a?.inWatchlist).toBe(true);
    expect(a?.hidden).toBe(false);
    // A has fetched progress, so it overrides the bulk counts.
    expect(a).toMatchObject({ aired: 10, completed: 3 });
    expect(a?.lastAired).toEqual({ season: 2, number: 3 });
    expect(entries[1]?.lastAired).toBeNull();
    expect(a?.tmdbId).toBe(55);
    expect(a?.nextEpisode).toEqual({
      season: 1,
      number: 4,
      title: "Four",
      firstAired: "2026-06-01T00:00:00.000Z",
      still: "https://media.trakt.tv/still.webp",
      ids: { trakt: 4004, tvdb: 9, imdb: "tt4", tmdb: 44 },
    });
  });

  it("gives an un-fetched watched show its real bulk counts, specials excluded, and no aired frontier while episodes are left", () => {
    // Beyond the cold-sync progress budget: no progress entry, so `aired` is the row's
    // `aired_episodes` and `completed` is its watched breakdown with season 0 dropped
    // (matching progress semantics). The backlog is real; only the next episode's
    // identity is missing, and the show is never asserted caught-up to cover that.
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 12, airedEpisodes: 20, seasons: { 0: 2, 1: 8, 2: 6 } })],
      progress: new Map(),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [],
    });
    expect(entries[0]).toMatchObject({
      aired: 20,
      completed: 14,
      nextEpisode: null,
      tmdbId: null,
      runtime: null,
      status: "returning series",
      lastAired: null,
    });
  });

  it("uses the last regular watched episode when the fallback includes a later special", () => {
    const watched: WatchedShow = {
      last_watched_at: "2026-07-01T00:00:00.000Z",
      show: { title: "Show", aired_episodes: 1, ids: { trakt: 13 } },
      seasons: [
        { number: 0, episodes: [{ number: 99 }] },
        { number: 1, episodes: [{ number: 8 }] },
      ],
    };
    const entries = assembleLibrary({
      watchedShows: [
        watched,
        {
          last_watched_at: "2026-07-01T00:00:00.000Z",
          show: { title: "Special only", aired_episodes: 0, ids: { trakt: 14 } },
          seasons: [{ number: 0, episodes: [{ number: 99 }] }],
        },
      ],
      progress: new Map(),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [],
    });
    expect(entries[0]?.lastAired).toEqual({ season: 1, number: 8 });
    expect(entries[1]?.lastAired).toBeNull();
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
      collectionShows: [],
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
      collectionShows: [],
      watchlistShows: [],
    });
    expect(entries[0]?.nextEpisode).toBeNull();
  });

  it("counts what is left from the next-up episode, not the seasons skipped before it", () => {
    const episodes = (count: number, watched: (number: number) => boolean) =>
      Array.from({ length: count }, (_, index) => ({
        number: index + 1,
        completed: watched(index + 1),
      }));
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 7, seasons: { 2: 7 } })],
      progress: new Map([
        [
          7,
          progress({
            aired: 30,
            completed: 7,
            next: { season: 2, number: 7, ids: { trakt: 207 } },
            seasons: [
              { number: 0, aired: 2, completed: 0, episodes: episodes(2, () => false) },
              { number: 1, aired: 10, completed: 0, episodes: episodes(10, () => false) },
              {
                number: 2,
                aired: 10,
                completed: 7,
                episodes: episodes(10, (number) => number < 7 || number === 9),
              },
              { number: 3, aired: 10, completed: 0, episodes: episodes(10, () => false) },
            ],
          }),
        ],
      ]),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [],
    });
    expect(entries[0]).toMatchObject({ aired: 30, completed: 7, left: 13 });
  });

  it("counts every unwatched aired episode as left when progress has no breakdown or was not read", () => {
    const entries = assembleLibrary({
      watchedShows: [
        watchedShow({ trakt: 8, seasons: { 1: 3 } }),
        watchedShow({ trakt: 9, airedEpisodes: 10, seasons: { 1: 4 } }),
      ],
      progress: new Map([[8, progress({ aired: 10, completed: 3, seasons: undefined })]]),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [],
    });
    expect(entries.map(({ showId, left }) => [showId, left])).toEqual([
      [8, 7],
      [9, 6],
    ]);
  });

  it("does not fall back to the watched frontier when fetched progress has no breakdown", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 6, seasons: { 1: 3 } })],
      progress: new Map([[6, progress({ seasons: undefined })]]),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [],
    });
    expect(entries[0]?.lastAired).toBeNull();
  });

  it("materializes a never-watched watchlisted show as a zero-progress to-watch entry", () => {
    const entries = assembleLibrary({
      watchedShows: [],
      progress: new Map(),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [watchlistItem({ trakt: 9, title: "Queued", tmdb: 77 })],
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
      plays: 0,
      lastAired: null,
      tmdbId: 77,
    });
  });

  it("carries no art for a watched show the list sent none for", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 5, title: "Detailed" })],
      progress: new Map([[5, progress({})]]),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [],
    });
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual(Object.keys(baseEntry).sort());
    expect(entries[0]?.posters).toEqual([]);
  });

  it("starts nothing for a collected show with no plays, and carries its list poster", () => {
    const entries = assembleLibrary({
      watchedShows: [],
      progress: new Map(),
      hiddenShowIds: new Set(),
      watchlistShows: [],
      collectionShows: [
        {
          last_collected_at: "2026-05-01T00:00:00.000Z",
          show: {
            title: "Shelved",
            year: 2019,
            ids: { trakt: 31 },
            images: { poster: ["walter-r2.trakt.tv/shelved.webp"] },
          },
        },
      ],
    });
    expect(entries).toEqual([
      expect.objectContaining({
        showId: 31,
        year: 2019,
        completed: 0,
        inWatchlist: false,
        addedAt: "2026-05-01T00:00:00.000Z",
        posters: ["walter-r2.trakt.tv/shelved.webp"],
      }),
    ]);
  });

  it("merges a show in both the watchlist and the collection into one entry added at the later date", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 41, seasons: { 1: 2 } })],
      progress: new Map(),
      hiddenShowIds: new Set(),
      watchlistShows: [{ ...watchlistItem({ trakt: 42 }), listed_at: "2026-01-01T00:00:00.000Z" }],
      collectionShows: [
        { last_collected_at: "2026-03-01T00:00:00.000Z", show: { title: "S", ids: { trakt: 42 } } },
        { last_collected_at: "2026-02-01T00:00:00.000Z", show: { title: "W", ids: { trakt: 41 } } },
      ],
    });
    expect(entries.map((entry) => [entry.showId, entry.inWatchlist, entry.addedAt])).toEqual([
      [41, false, "2026-02-01T00:00:00.000Z"],
      [42, true, "2026-03-01T00:00:00.000Z"],
    ]);
    expect(entries[0]?.completed).toBe(2);
  });

  it("reads what a sparse Trakt row leaves out as unknown", () => {
    const { last_watched_at: _, ...neverStamped } = watchedShow({ trakt: 21 });
    const undated = { season: 1, number: 4, ids: { trakt: 4004 } };
    const entries = assembleLibrary({
      watchedShows: [neverStamped],
      progress: new Map([[21, progress({ next: undated })]]),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [
        { type: "show", show: { title: "Bare", ids: { trakt: 22 } } },
        { type: "movie" },
      ],
    });
    expect(entries).toMatchObject([
      { showId: 21, lastWatchedAt: null, nextEpisode: { firstAired: null } },
      { showId: 22, status: "", tmdbId: null },
    ]);
    expect(entries).toHaveLength(2);
  });

  it("does not duplicate a watchlisted show that is also watched", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 4, title: "Both" })],
      progress: new Map([[4, progress({})]]),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [watchlistItem({ trakt: 4, title: "Both" })],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.inWatchlist).toBe(true);
    expect(entries[0]?.completed).toBe(3);
  });
});

describe("watchedEpisodeCount", () => {
  it("counts Doctor Who's 78 non-special episodes, never the 159 that include specials", () => {
    // Measured against the live API on 2026-07-26: 78 watched excluding season 0,
    // 159 including it, against an `aired_episodes` of 153. Trakt's `aired_episodes`
    // is the season sum EXCLUDING season 0, so counting specials would put this show
    // 6 episodes past its own aired count, read it as caught-up, and drop it out of
    // the queue. The exclusion is load-bearing, not cosmetic.
    const show = watchedShow({ trakt: 56, airedEpisodes: 153, seasons: { 0: 81, 1: 78 } });
    expect(watchedEpisodeCount(show)).toBe(78);

    const entries = assembleLibrary({
      watchedShows: [show],
      progress: new Map(),
      hiddenShowIds: new Set(),
      collectionShows: [],
      watchlistShows: [],
    });
    expect(entries[0]).toMatchObject({ aired: 153, completed: 78 });
  });

  it("drops plays from before a restart, so no progress read is needed to make the cut", () => {
    const restarted: WatchedShow = {
      last_watched_at: "2026-07-01T00:00:00.000Z",
      reset_at: "2026-06-01T00:00:00.000Z",
      show: { title: "Restarted", aired_episodes: 10, ids: { trakt: 1 } },
      seasons: [
        {
          number: 1,
          episodes: [
            { number: 1, last_watched_at: "2026-05-01T00:00:00.000Z" },
            { number: 2, last_watched_at: "2026-07-01T00:00:00.000Z" },
            // No stamp: counted as pre-reset, which understates `completed` and
            // leaves the show in the queue rather than fabricating it caught-up.
            { number: 3, last_watched_at: null },
          ],
        },
      ],
    };
    expect(watchedEpisodeCount(restarted)).toBe(1);
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
