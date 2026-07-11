import { invalidationKeys, showProgressKeys } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import { describe, expect, it } from "vitest";

describe("showProgressKeys: the keys a local mark on show X must refresh", () => {
  it("invalidates the library aggregate AND the show's own detail views, not just library", () => {
    const keys = showProgressKeys(42);
    expect(keys).toEqual([
      queryKeys.library(),
      queryKeys.showHeader(42),
      queryKeys.showSeasons(42),
    ]);
    // The regression this guards: a mark that touched only `library` left the
    // show-detail header/seasons persisted cache stale across reloads.
    expect(keys).toContainEqual(queryKeys.showHeader(42));
    expect(keys).toContainEqual(queryKeys.showSeasons(42));
  });

  it("adds the marked episode's detail read when an episode coordinate is given", () => {
    expect(showProgressKeys(42, { season: 1, number: 5 })).toEqual([
      queryKeys.library(),
      queryKeys.showHeader(42),
      queryKeys.showSeasons(42),
      queryKeys.episode(42, 1, 5),
    ]);
  });

  it("omits the episode key for a whole-season / range mark (no single coordinate)", () => {
    expect(showProgressKeys(7)).not.toContainEqual(queryKeys.episode(7, 0, 0));
    expect(showProgressKeys(7)).toHaveLength(3);
  });

  it("adds the whole-show episode prefix for a bulk/range mark ('all')", () => {
    // A bulk mark/undo touches an unknown set of episodes, so it invalidates the
    // episode prefix, which TanStack prefix-matches every cached episode of the show
    // rather than one coordinate, so no pre-cached standalone episode page is stale.
    const keys = showProgressKeys(42, "all");
    expect(keys).toEqual([
      queryKeys.library(),
      queryKeys.showHeader(42),
      queryKeys.showSeasons(42),
      queryKeys.episodePrefix(42),
    ]);
    // The prefix is a strict prefix of any concrete episode key of that show.
    expect(queryKeys.episode(42, 3, 9).slice(0, 3)).toEqual(queryKeys.episodePrefix(42));
  });

  it("scopes the show-detail keys to the marked show id", () => {
    const keys = showProgressKeys(99, { season: 2, number: 3 });
    expect(keys).toContainEqual(queryKeys.showHeader(99));
    expect(keys).not.toContainEqual(queryKeys.showHeader(42));
    expect(keys).toContainEqual(queryKeys.episode(99, 2, 3));
  });
});

describe("invalidationKeys maps last_activities targets to cached query keys", () => {
  it("routes an episode watch to the library + user stats + the Diary", () => {
    expect(invalidationKeys(["watched/shows", "progress/watched"])).toEqual([
      queryKeys.library(),
      queryKeys.userStats(),
      queryKeys.historyPrefix(),
    ]);
  });

  it("routes a movie watch to the movie library + user stats + the Diary", () => {
    expect(invalidationKeys(["watched/movies", "movie-progress"])).toEqual([
      queryKeys.movieLibrary(),
      queryKeys.userStats(),
      queryKeys.historyPrefix(),
    ]);
  });

  it("routes a show watchlist change to library + the shows watchlist", () => {
    expect(invalidationKeys(["watchlist/shows"])).toEqual([
      queryKeys.library(),
      queryKeys.watchlist("shows"),
    ]);
  });

  it("routes each ratings section to only its own key", () => {
    expect(invalidationKeys(["ratings/shows"])).toEqual([queryKeys.ratings("shows")]);
    expect(invalidationKeys(["ratings/episodes"])).toEqual([queryKeys.ratings("episodes")]);
  });

  it("routes an abandon (hidden) change and bucket recompute to the library", () => {
    expect(invalidationKeys(["hidden/progress_watched", "recompute:buckets"])).toEqual([
      queryKeys.library(),
    ]);
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
    const stats = keys.filter((k) => JSON.stringify(k) === JSON.stringify(queryKeys.userStats()));
    expect(library).toHaveLength(1);
    expect(stats).toHaveLength(1);
  });

  it("returns nothing for an empty diff", () => {
    expect(invalidationKeys([])).toEqual([]);
  });
});
