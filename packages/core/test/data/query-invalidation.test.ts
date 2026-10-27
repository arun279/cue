import {
  changedActivityKeys,
  invalidateChangedShows,
  showProgressKeys,
} from "@cue/core/data/query-invalidation";
import { queryKeys } from "@cue/core/data/query-keys";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { LastActivities } from "@cue/core/domain/sync-activities";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { makeShow } from "../domain/_helpers";

describe("showProgressKeys: the keys a local mark on show X must refresh", () => {
  it("invalidates only the marked show's detail views", () => {
    const keys = showProgressKeys(42);
    expect(keys).toEqual([queryKeys.showProgress(42), queryKeys.showSeasons(42)]);
    // The regression this guards: a mark that touched only `library` left the
    // show-detail progress/seasons persisted cache stale across reloads.
    expect(keys).toContainEqual(queryKeys.showProgress(42));
    expect(keys).toContainEqual(queryKeys.showSeasons(42));
    // A mark moves the viewer's progress, never the show's own facts, so the
    // `/shows/:id` entry the card art and the hero share is left alone.
    expect(keys).not.toContainEqual(queryKeys.showInfo(42));
    expect(keys).not.toContainEqual(queryKeys.library());
  });

  it("adds the marked episode's detail read when an episode coordinate is given", () => {
    expect(showProgressKeys(42, { season: 1, number: 5 })).toEqual([
      queryKeys.showProgress(42),
      queryKeys.showSeasons(42),
      queryKeys.episode(42, 1, 5),
    ]);
  });

  it("omits the episode key for a whole-season / range mark (no single coordinate)", () => {
    expect(showProgressKeys(7)).not.toContainEqual(queryKeys.episode(7, 0, 0));
    expect(showProgressKeys(7)).toHaveLength(2);
  });

  it("adds the whole-show episode prefix for a bulk/range mark ('all')", () => {
    // A bulk mark/undo touches an unknown set of episodes, so it invalidates the
    // episode prefix, which TanStack prefix-matches every cached episode of the show
    // rather than one coordinate, so no pre-cached standalone episode page is stale.
    const keys = showProgressKeys(42, "all");
    expect(keys).toEqual([
      queryKeys.showProgress(42),
      queryKeys.showSeasons(42),
      queryKeys.episodePrefix(42),
    ]);
    // The prefix is a strict prefix of any concrete episode key of that show.
    expect(queryKeys.episode(42, 3, 9).slice(0, 3)).toEqual(queryKeys.episodePrefix(42));
  });

  it("scopes the show-detail keys to the marked show id", () => {
    const keys = showProgressKeys(99, { season: 2, number: 3 });
    expect(keys).toContainEqual(queryKeys.showProgress(99));
    expect(keys).not.toContainEqual(queryKeys.showProgress(42));
    expect(keys).toContainEqual(queryKeys.episode(99, 2, 3));
  });
});

describe("changedActivityKeys: the reads each moved activity stamp refreshes", () => {
  const T0 = "2026-07-01T00:00:00.000Z";
  const T1 = "2026-07-05T00:00:00.000Z";
  const library = queryKeys.library();
  const movieLibrary = queryKeys.movieLibrary();
  const movieWatchlist = queryKeys.movieWatchlist();
  const history = queryKeys.historyPrefix();
  const showTrees = (["progress", "seasons", "episode"] as const).map(queryKeys.showSection);

  it.each<[string, LastActivities, readonly (readonly unknown[])[]]>([
    ["an episode watch", { episodes: { watched_at: T1 } }, [library, history]],
    ["a movie watch", { movies: { watched_at: T1 } }, [movieLibrary, history]],
    ["an episode collected", { episodes: { collected_at: T1 } }, [library]],
    ["a movie collected", { movies: { collected_at: T1 } }, [movieLibrary]],
    ["a show hidden", { shows: { hidden_at: T1 } }, [library, ...showTrees]],
    ["a show dropped", { shows: { dropped_at: T1 } }, [library]],
    ["a show watchlisted", { shows: { watchlisted_at: T1 } }, [library]],
    ["a movie watchlisted", { movies: { watchlisted_at: T1 } }, [movieLibrary, movieWatchlist]],
    [
      "the watchlist edited",
      { watchlist: { updated_at: T1 } },
      [library, movieLibrary, movieWatchlist],
    ],
    ["an episode watchlisted", { episodes: { watchlisted_at: T1 } }, []],
    ["a favorite", { shows: { favorited_at: T1 }, movies: { favorited_at: T1 } }, []],
    ["a movie hidden", { movies: { hidden_at: T1 } }, []],
    ["a rating", { episodes: { rated_at: T1 }, seasons: { rated_at: T1 } }, []],
    ["a list or account change", { lists: { updated_at: T1 }, account: { settings_at: T1 } }, []],
  ])("refreshes exactly what %s moves", (_, fresh, keys) => {
    expect(changedActivityKeys({}, fresh)).toEqual(keys);
  });

  it("refreshes nothing when no stamp moved", () => {
    const same: LastActivities = { episodes: { watched_at: T1 }, shows: { hidden_at: T1 } };
    expect(changedActivityKeys(same, same)).toEqual([]);
  });

  it("counts a stamp seen for the first time as moved", () => {
    expect(changedActivityKeys({}, { shows: { dropped_at: T1 } })).toEqual([library]);
  });

  it("ignores a stamp that moved backwards", () => {
    expect(
      changedActivityKeys({ episodes: { watched_at: T1 } }, { episodes: { watched_at: T0 } }),
    ).toEqual([]);
  });

  it("counts any change to a stamp it cannot read as moved", () => {
    const garbled: LastActivities = { episodes: { watched_at: "garbled" } };
    expect(changedActivityKeys(garbled, { episodes: { watched_at: T0 } })).toEqual([
      library,
      history,
    ]);
    expect(changedActivityKeys(garbled, garbled)).toEqual([]);
  });

  it("refreshes a key once when several moved stamps share it", () => {
    expect(
      changedActivityKeys(
        { episodes: { watched_at: T0 }, shows: { dropped_at: T0, watchlisted_at: T0 } },
        { episodes: { watched_at: T1 }, shows: { dropped_at: T1, watchlisted_at: T1 } },
      ),
    ).toEqual([library, history]);
  });
});

describe("invalidateChangedShows: what a library reload refreshes", () => {
  const AT = "2026-10-20T12:00:00.000Z";
  const entry = (
    showId: number,
    { completed = 5, plays = 5 as number | null, lastWatchedAt = AT } = {},
  ): LibraryEntry => ({
    ...makeShow({ showId, completed, plays, lastWatchedAt }),
    tmdbId: null,
    runtime: null,
    posters: [],
  });

  function stale(
    cached: readonly LibraryEntry[] | undefined,
    reloaded: readonly LibraryEntry[],
    skipped: ReadonlySet<number> = new Set(),
  ) {
    const qc = new QueryClient();
    for (const showId of [1, 2, 3, 4, 5, 6]) {
      qc.setQueryData(queryKeys.showSeasons(showId), []);
      qc.setQueryData(queryKeys.showProgress(showId), {});
      qc.setQueryData(queryKeys.episode(showId, 1, 1), {});
    }
    invalidateChangedShows(qc, cached, reloaded, skipped);
    return [
      ...new Set(
        qc
          .getQueryCache()
          .findAll({ predicate: (query) => query.state.isInvalidated })
          .map(({ queryKey }) => queryKey[2]),
      ),
    ];
  }

  it("refreshes a show whose count, plays or last play moved, or that left or joined the library", () => {
    const cached = [entry(1), entry(2), entry(3), entry(4), entry(5)];
    const reloaded = [
      entry(1, { completed: 6 }),
      entry(2, { lastWatchedAt: "2026-10-20T12:05:00.000Z" }),
      entry(3, { plays: 6 }),
      entry(4),
      entry(6),
    ];
    expect(stale(cached, reloaded)).toEqual([1, 2, 3, 5, 6]);
  });

  it("leaves a show alone whose write is still on its way", () => {
    expect(
      stale(
        [entry(1), entry(2)],
        [entry(1, { completed: 6 }), entry(2, { completed: 6 })],
        new Set([1]),
      ),
    ).toEqual([2]);
  });

  // Trakt keeps a play's time to the minute; the app's own mark carries the seconds it sent.
  it("leaves a show alone whose last play moved within the minute Trakt keeps", () => {
    expect(stale([entry(1, { lastWatchedAt: "2026-10-20T12:00:41.317Z" })], [entry(1)])).toEqual(
      [],
    );
  });

  it("compares plays only where both sides know them", () => {
    expect(stale([entry(1, { plays: null })], [entry(1, { plays: 9 })])).toEqual([]);
  });

  it("refreshes nothing on the library's first load, with nothing to compare", () => {
    expect(stale(undefined, [entry(1)])).toEqual([]);
  });
});
