import {
  invalidateChangedShows,
  invalidationKeys,
  showProgressKeys,
} from "@cue/core/data/query-invalidation";
import { queryKeys } from "@cue/core/data/query-keys";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
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

describe("invalidationKeys maps last_activities targets to cached query keys", () => {
  it("routes an episode watch to the library, whose reload refreshes each changed show, and the Diary", () => {
    expect(invalidationKeys(["watched/shows", "progress/watched"])).toEqual([
      queryKeys.library(),
      queryKeys.historyPrefix(),
    ]);
  });

  it("routes a movie watch to the movie library + the Diary", () => {
    expect(invalidationKeys(["watched/movies", "movie-progress"])).toEqual([
      queryKeys.movieLibrary(),
      queryKeys.historyPrefix(),
    ]);
  });

  it("routes a show watchlist change to the library, which holds every watchlisted show", () => {
    expect(invalidationKeys(["watchlist/shows"])).toEqual([queryKeys.library()]);
  });

  it("routes a watchlist change to its own watchlist and to both followed piles", () => {
    expect(invalidationKeys(["watchlist/movies", "recompute:following"])).toEqual([
      queryKeys.movieLibrary(),
      queryKeys.movieWatchlist(),
      queryKeys.library(),
    ]);
    expect(
      invalidationKeys(["watchlist/shows", "recompute:following", "recompute:to-watch"]),
    ).toEqual([queryKeys.library(), queryKeys.movieLibrary()]);
  });

  it("routes a hidden change to the library and to the progress it drops hidden seasons from", () => {
    expect(invalidationKeys(["hidden/progress_watched", "recompute:buckets"])).toEqual([
      queryKeys.library(),
      queryKeys.showSection("progress"),
      queryKeys.showSection("seasons"),
      queryKeys.showSection("episode"),
    ]);
  });

  it("routes a dropped list change to the library on its own", () => {
    expect(invalidationKeys(["hidden/dropped"])).toEqual([queryKeys.library()]);
  });

  it("maps unsurfaced targets (episode watchlist, favorites, movie hidden) to nothing", () => {
    expect(
      invalidationKeys([
        "watchlist/episodes",
        "favorites/shows",
        "favorites/movies",
        "hidden/movies",
      ]),
    ).toEqual([]);
  });

  it("de-duplicates keys that several advanced targets share", () => {
    const keys = invalidationKeys([
      "watched/shows",
      "progress/watched",
      "watchlist/shows",
      "recompute:buckets",
    ]);
    const library = keys.filter((k) => JSON.stringify(k) === JSON.stringify(queryKeys.library()));
    const diary = keys.filter(
      (k) => JSON.stringify(k) === JSON.stringify(queryKeys.historyPrefix()),
    );
    expect(library).toHaveLength(1);
    expect(diary).toHaveLength(1);
  });

  it("returns nothing for an empty diff", () => {
    expect(invalidationKeys([])).toEqual([]);
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
