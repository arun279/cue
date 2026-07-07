import { invalidationKeys } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import { describe, expect, it } from "vitest";

describe("invalidationKeys maps last_activities targets to cached query keys", () => {
  it("routes an episode watch to the library + user stats", () => {
    expect(invalidationKeys(["watched/shows", "progress/watched"])).toEqual([
      queryKeys.library(),
      queryKeys.userStats(),
    ]);
  });

  it("routes a movie watch to the movie library + user stats", () => {
    expect(invalidationKeys(["watched/movies", "movie-progress"])).toEqual([
      queryKeys.movieLibrary(),
      queryKeys.userStats(),
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
