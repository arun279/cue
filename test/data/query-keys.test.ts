import { queryKeys } from "@data/query-keys";
import { describe, expect, it } from "vitest";

describe("queryKeys factory", () => {
  it("produces stable readonly tuples per section", () => {
    expect(queryKeys.watchedShows()).toEqual(["watched", "shows"]);
    expect(queryKeys.watchedMovies()).toEqual(["watched", "movies"]);
    expect(queryKeys.progress(42)).toEqual(["progress", "watched", 42]);
    expect(queryKeys.watchlist("shows")).toEqual(["watchlist", "shows"]);
    expect(queryKeys.ratings("episodes")).toEqual(["ratings", "episodes"]);
    expect(queryKeys.hidden()).toEqual(["hidden", "progress_watched"]);
    expect(queryKeys.calendar("2026-07-05", 7)).toEqual(["calendar", "my-shows", "2026-07-05", 7]);
    expect(queryKeys.search("dune", "show,movie")).toEqual(["search", "show,movie", "dune"]);
    expect(queryKeys.lastActivities()).toEqual(["sync", "last_activities"]);
    expect(queryKeys.tmdbConfiguration()).toEqual(["tmdb", "configuration"]);
    expect(queryKeys.tmdbTv(95396)).toEqual(["tmdb", "tv", 95396]);
    expect(queryKeys.library()).toEqual(["library"]);
  });
});
