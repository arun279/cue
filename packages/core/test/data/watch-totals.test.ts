import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { MovieEntry } from "@cue/core/data/trakt/movie-library";
import { watchTotals } from "@cue/core/data/trakt/watch-totals";
import { describe, expect, it } from "vitest";

const show = (showId: number, completed: number, runtime: number | null): LibraryEntry => ({
  showId,
  title: `Show ${showId}`,
  status: "returning series",
  hidden: false,
  inWatchlist: completed === 0,
  lastWatchedAt: null,
  aired: 40,
  completed,
  nextEpisode: null,
  lastAired: null,
  tmdbId: null,
  runtime,
  pendingAdvance: false,
});

const movie = (movieId: number, watched: boolean, runtime: number | null): MovieEntry => ({
  movieId,
  ids: { trakt: movieId },
  title: `Movie ${movieId}`,
  year: 2024,
  watched,
  watchedAt: watched ? "2026-09-01T00:00:00.000Z" : null,
  inWatchlist: !watched,
  listedAt: null,
  posters: [],
  tmdbId: null,
  runtime,
});

describe("watchTotals", () => {
  const library = [show(1, 54, 60), show(2, 27, 54), show(3, 0, 45), show(4, 6, null)];
  const movies = [movie(10, true, 105), movie(11, true, null), movie(12, false, 120)];

  it("counts watched episodes, shows and movies from the synced library", () => {
    expect(watchTotals(library, movies)).toMatchObject({ episodes: 87, shows: 3, movies: 2 });
  });

  it("sums known runtimes and leaves out the items without one", () => {
    expect(watchTotals(library, movies).minutes).toBe(54 * 60 + 27 * 54 + 105);
  });

  it("has no watch time when no watched item carries a runtime", () => {
    expect(watchTotals([show(4, 6, null)], [movie(11, true, null)]).minutes).toBeNull();
    expect(watchTotals([], []).minutes).toBeNull();
  });
});
