import {
  advancePastNext,
  assembleLibrary,
  type LibraryEntry,
  type LibraryInput,
  markLanded,
  showIdSet,
} from "@data/trakt/library";
import type { Progress, WatchedShow } from "@data/trakt/schemas";
import { describe, expect, it } from "vitest";

function watchedShow(overrides: {
  trakt: number;
  title?: string;
  status?: string;
  lastWatchedAt?: string | null;
  posters?: string[];
  tmdb?: number;
}): WatchedShow {
  return {
    last_watched_at: overrides.lastWatchedAt ?? "2026-07-01T00:00:00.000Z",
    show: {
      title: overrides.title ?? "Show",
      status: overrides.status ?? "returning series",
      ids: { trakt: overrides.trakt, tmdb: overrides.tmdb },
      images: overrides.posters ? { poster: overrides.posters } : undefined,
    },
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
      watchlistShowIds: new Set([1]),
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
      watchlistShowIds: new Set(),
    });
    expect(entries[0]).toMatchObject({
      aired: 0,
      completed: 0,
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
      watchlistShowIds: new Set(),
    });
    expect(entries[0]?.nextEpisode?.ids).toEqual({ trakt: 8001 });
    expect(entries[0]?.nextEpisode?.title).toBeNull();
  });

  it("carries a null next_episode through (caught-up show)", () => {
    const entries = assembleLibrary({
      watchedShows: [watchedShow({ trakt: 3 })],
      progress: new Map([[3, progress({ next: null })]]),
      hiddenShowIds: new Set(),
      watchlistShowIds: new Set(),
    });
    expect(entries[0]?.nextEpisode).toBeNull();
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
  it("projects the following episode, bumps completed, and flags pendingAdvance", () => {
    const advanced = advancePastNext(baseEntry, "2026-07-05T12:00:00.000Z");
    expect(advanced.completed).toBe(4);
    expect(advanced.lastWatchedAt).toBe("2026-07-05T12:00:00.000Z");
    expect(advanced.pendingAdvance).toBe(true);
    expect(advanced.nextEpisode).toEqual({
      season: 1,
      number: 5,
      title: null,
      firstAired: "2026-06-01T00:00:00.000Z",
      ids: { trakt: 0 },
    });
  });

  it("falls back to watchedAt for the projected air date when the source lacks one", () => {
    const entry: LibraryEntry = {
      ...baseEntry,
      nextEpisode: {
        season: 1,
        number: 4,
        title: "Four",
        firstAired: null,
        ids: { trakt: 4004 },
      },
    };
    expect(advancePastNext(entry, "2026-07-05T12:00:00.000Z").nextEpisode?.firstAired).toBe(
      "2026-07-05T12:00:00.000Z",
    );
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
