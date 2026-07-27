import {
  additiveLanded,
  advancePastNext,
  assembleLibrary,
  type LibraryEntry,
  type LibraryInput,
  markLanded,
  showIdSet,
  watchedEpisodeCount,
} from "@data/trakt/library";
import type { Progress, WatchedShow, WatchlistItem } from "@data/trakt/schemas";
import type { EpisodePlay } from "@domain/reversal";
import { describe, expect, it } from "vitest";

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
            images: { screenshot: ["media.trakt.tv/still.webp"] },
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
    still: null,
    ids: { trakt: 4004 },
  },
  tmdbId: null,
  pendingAdvance: false,
};

describe("assembleLibrary", () => {
  it("merges watched + progress + hidden + watchlist into entries", () => {
    const input: LibraryInput = {
      watchedShows: [watchedShow({ trakt: 1, title: "A", tmdb: 55 }), watchedShow({ trakt: 2 })],
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
    // A has fetched progress, so it overrides the bulk counts.
    expect(a).toMatchObject({ aired: 10, completed: 3 });
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

  it("gives an un-fetched watched show its real bulk counts, specials excluded", () => {
    // Beyond the cold-sync progress budget: no progress entry, so `aired` is the row's
    // `aired_episodes` and `completed` is its watched breakdown with season 0 dropped
    // (matching progress semantics). The backlog is real; only the next episode's
    // identity is missing, and the show is never asserted caught-up to cover that.
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 12, airedEpisodes: 20, seasons: { 0: 2, 1: 8, 2: 6 } })],
      progress: new Map(),
      hiddenShowIds: new Set(),
      watchlistShows: [],
    });
    expect(entries[0]).toMatchObject({
      aired: 20,
      completed: 14,
      nextEpisode: null,
      tmdbId: null,
      status: "returning series",
    });
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
      tmdbId: 77,
    });
  });

  it("carries no art: every card reads its own from `/shows/:id`", () => {
    // `/sync/watched/shows` returns no `images` block at all (the app does not even
    // ask for one), so an entry could only ever carry a null poster. The whole
    // field set is gone rather than shipped structurally empty.
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 5, title: "Detailed" })],
      progress: new Map([[5, progress({})]]),
      hiddenShowIds: new Set(),
      watchlistShows: [],
    });
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual(Object.keys(baseEntry).sort());
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
      still: null,
      ids: { trakt: 0 },
    });
  });

  it("never inherits the watched episode's air date (no season-finale phantom in New)", () => {
    // A recent air date on the source episode must NOT flow onto the projection:
    // that is exactly what made a marked finale cling to the fresh/lead slot.
    const entry: LibraryEntry = {
      ...baseEntry,
      nextEpisode: {
        season: 1,
        number: 4,
        title: "Finale",
        firstAired: "2026-07-04T00:00:00.000Z",
        still: null,
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

  it("hits a season probe with 59 seconds of watched-at skew", () => {
    expect(
      additiveLanded(
        [play({ watchedAt: "2026-07-05T12:34:59.000Z" })],
        { season: 4, number: 4 },
        watchedAt,
      ),
    ).toBe(true);
  });

  it("misses a matching play with 61 seconds of watched-at skew", () => {
    expect(
      additiveLanded(
        [play({ watchedAt: "2026-07-05T12:35:01.000Z" })],
        { episodeTrakt: 4004 },
        watchedAt,
      ),
    ).toBe(false);
  });

  it("misses the wrong episode id or season probe", () => {
    expect(additiveLanded([play()], { episodeTrakt: 4005 }, watchedAt)).toBe(false);
    expect(additiveLanded([play()], { season: 5, number: 4 }, watchedAt)).toBe(false);
    expect(additiveLanded([play()], { season: 4, number: 5 }, watchedAt)).toBe(false);
  });
});
