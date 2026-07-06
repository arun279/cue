import { expect, test } from "@playwright/test";
import { installHermeticRoutes, installMovieRoutes, type MovieFixture, seedAuth } from "./helpers";

const POSTER = "media.trakt.tv/p.webp";
const BACKDROP = "media.trakt.tv/b.webp";

/** A watched movie and a watchlist-only movie — one per My Shows movie shelf. */
function movies(): MovieFixture[] {
  return [
    {
      trakt: 100,
      tmdb: 500,
      title: "Watched Movie",
      year: 2021,
      overview: "A duke's son leads desert warriors.",
      runtime: 155,
      released: "2021-10-22",
      posters: [POSTER],
      backdrops: [BACKDROP],
      watched: true,
    },
    {
      trakt: 200,
      tmdb: 600,
      title: "Queued Movie",
      year: 2020,
      overview: "A heist across dream layers.",
      runtime: 148,
      released: "2020-07-16",
      posters: [POSTER],
      backdrops: [BACKDROP],
      watched: false,
      inWatchlist: true,
    },
  ];
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("the Library Movies tab lists Watchlist and Watched poster shelves", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library");
  await page.getByTestId("type-movies").click();

  const headings = page.getByTestId("movie-shelf-heading");
  await expect(headings).toHaveCount(2);
  // Watchlist first (the "want to watch" pool), then Watched.
  await expect(headings.nth(0)).toHaveAttribute("data-shelf", "watchlist");
  await expect(headings.nth(1)).toHaveAttribute("data-shelf", "watched");

  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Watched Movie" }),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Queued Movie" }),
  ).toHaveCount(1);
});

test("a movie card routes to the movie detail page", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library");
  await page.getByTestId("type-movies").click();

  await page.getByTestId("movie-library-card").filter({ hasText: "Watched Movie" }).click();
  await expect(page.getByTestId("movie-detail-title")).toContainText("Watched Movie");
  await expect(page.getByTestId("movie-detail-overview")).toBeVisible();
  await expect(page.getByTestId("movie-runtime")).toContainText("155 min");
});

test("shows an empty state when the movie library is empty", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), []);
  await page.goto("/library");
  await page.getByTestId("type-movies").click();
  await expect(page.getByTestId("movies-empty")).toBeVisible();
});

test("marks a movie watched with the movies[] history body and undoes it", async ({ page }) => {
  const controls = await installMovieRoutes(page.context(), movies());
  await page.goto("/movie/200"); // the watchlist-only (unwatched) movie

  const toggle = page.getByTestId("movie-watched-toggle");
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked(); // optimistic

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  const posted = controls.historyPosts()[0];
  expect(posted?.movieIds).toEqual([200]);
  expect(posted?.watchedAt).not.toBeNull();
  // The mark body is `{ movies: [{ ids, watched_at }] }` — the movie history shape.
  expect(posted?.movieItemKeys).toEqual(["ids", "watched_at"]);

  // Undo re-sends the stored movies[] remove-by-item inverse.
  await page.getByTestId("movie-undo-action").click();
  await expect.poll(() => controls.historyRemovePosts().length).toBe(1);
  expect(controls.historyRemovePosts()[0]?.movieIds).toEqual([200]);
});

test("adds a movie to the watchlist with the movies[] body", async ({ page }) => {
  const controls = await installMovieRoutes(page.context(), [
    { trakt: 100, tmdb: 500, title: "Watched Movie", year: 2021, posters: [POSTER], watched: true },
  ]);
  await page.goto("/movie/100");

  const watchlist = page.getByTestId("movie-watchlist-toggle");
  await expect(watchlist).toHaveText(/Add to watchlist/);
  await watchlist.click();
  await expect(watchlist).toHaveText(/On watchlist/); // optimistic

  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.movieIds).toEqual([100]);
});
