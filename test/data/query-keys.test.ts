import { queryKeys } from "@data/query-keys";
import { describe, expect, it } from "vitest";

describe("queryKeys factory", () => {
  it("produces stable readonly tuples per section", () => {
    expect(queryKeys.watchlist("shows")).toEqual(["watchlist", "shows"]);
    expect(queryKeys.ratings("episodes")).toEqual(["ratings", "episodes"]);
    expect(queryKeys.calendar("2026-07-05", 7)).toEqual(["calendar", "my-shows", "2026-07-05", 7]);
    expect(queryKeys.calendarPrefix()).toEqual(["calendar", "my-shows"]);
    expect(queryKeys.search("dune", "show,movie")).toEqual(["search", "show,movie", "dune"]);
    expect(queryKeys.discover()).toEqual(["discover", "shows-movies"]);
    expect(queryKeys.lastActivities()).toEqual(["sync", "last_activities"]);
    expect(queryKeys.userStats()).toEqual(["users", "me", "stats"]);
    expect(queryKeys.library()).toEqual(["library"]);
    expect(queryKeys.movieLibrary()).toEqual(["movie-library"]);
    expect(queryKeys.movieRelated(5)).toEqual(["movie", "related", 5]);
    expect(queryKeys.showHeader(1)).toEqual(["show", "header", 1]);
    expect(queryKeys.showSeasons(1)).toEqual(["show", "seasons", 1]);
  });
});
