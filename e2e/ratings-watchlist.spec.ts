import { expect, test } from "@playwright/test";
import {
  type EpisodeFixture,
  installHermeticRoutes,
  installLibraryRoutes,
  type ShowFixture,
  seedAuth,
} from "./helpers";

const AIRED = "2026-01-01T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";

function ep(season: number, number: number, firstAired: string, traktId: number): EpisodeFixture {
  return { season, number, title: `Episode ${number}`, firstAired, traktId };
}

function ratedShow(): ShowFixture {
  return {
    trakt: 1,
    tmdb: 500,
    title: "The Detail Show",
    status: "returning series",
    posters: ["media.trakt.tv/p.webp"],
    lastWatchedAt: "2026-06-05T00:00:00.000Z",
    aired: 3,
    completed: 2,
    episodes: [ep(1, 1, AIRED, 11), ep(1, 2, AIRED, 12), ep(1, 3, AIRED, 13)],
  };
}

/** A not-yet-started show (aired 0, completed 0) — buckets as Watchlist until watchlisted. */
function notStartedShow(): ShowFixture {
  return {
    trakt: 2,
    title: "Watchlist Show",
    status: "returning series",
    posters: ["media.trakt.tv/p.webp"],
    lastWatchedAt: null,
    aired: 0,
    completed: 0,
    inWatchlist: false,
    episodes: [ep(1, 1, FUTURE, 21)],
  };
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("rating a show fires POST /sync/ratings optimistically and can be removed", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [ratedShow()]);
  await page.goto("/show/1");

  const eight = page.getByTestId("show-rating-value-8");
  await expect(eight).toHaveAttribute("aria-pressed", "false");
  await eight.click();
  await expect(eight).toHaveAttribute("aria-pressed", "true"); // optimistic
  await expect(page.getByTestId("show-rating-current")).toContainText("8/10");

  await expect.poll(() => controls.ratingPosts().length).toBe(1);
  const posted = controls.ratingPosts()[0];
  expect(posted?.showIds).toEqual([1]);
  expect(posted?.rating).toBe(8);

  await page.getByTestId("show-rating-clear").click();
  await expect.poll(() => controls.ratingRemovePosts().length).toBe(1);
  expect(controls.ratingRemovePosts()[0]?.showIds).toEqual([1]);
  await expect(page.getByTestId("show-rating-current")).toContainText("Not rated");
});

test("rating an episode fires POST /sync/ratings with the episodes[] body", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [ratedShow()]);
  await page.goto("/show/1/episode/1/2");

  await page.getByTestId("episode-rating-value-7").click();
  await expect(page.getByTestId("episode-rating-current")).toContainText("7/10");

  await expect.poll(() => controls.ratingPosts().length).toBe(1);
  const posted = controls.ratingPosts()[0];
  expect(posted?.episodeIds).toEqual([12]);
  expect(posted?.rating).toBe(7);
});

test("adding a never-watched show to the watchlist surfaces it in the Library Watchlist segment", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [notStartedShow()]);
  await page.setViewportSize({ width: 1000, height: 1400 });

  // A never-watched, un-watchlisted show is absent from /sync/watched/shows and the
  // watchlist, so it does not appear in My Shows at all — the watchlist is its only
  // route into the library (regression guard for the watchlist-only refetch bug).
  await page.goto("/library");
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Watchlist" })).toHaveCount(0);
  await expect(page.getByTestId("library-card").filter({ hasText: "Watchlist Show" })).toHaveCount(
    0,
  );

  await page.goto("/show/2");
  const toggle = page.getByTestId("watchlist-toggle");
  await expect(toggle).toHaveText(/Add to watchlist/);
  await toggle.click();
  await expect(toggle).toHaveText(/On watchlist/); // optimistic

  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.showIds).toContain(2);

  // The Watchlist segment now holds the show, and it SURVIVES a full reload+refetch
  // (a watched-shows-only library would drop it here). The segment is collapsed by
  // default, so expand it to reveal the tile.
  await page.goto("/library");
  const notStarted = page.getByTestId("pile-heading").filter({ hasText: "Watchlist" });
  await expect(notStarted).toBeVisible();
  await notStarted.click();
  await expect(page.getByTestId("library-card").filter({ hasText: "Watchlist Show" })).toHaveCount(
    1,
  );
});

test("removing a show from the watchlist fires /sync/watchlist/remove and clears the Watchlist segment", async ({
  page,
}) => {
  const seeded: ShowFixture = { ...notStartedShow(), inWatchlist: true };
  const controls = await installLibraryRoutes(page.context(), [seeded]);
  await page.setViewportSize({ width: 1000, height: 1400 });

  await page.goto("/library");
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Watchlist" })).toBeVisible();

  await page.goto("/show/2");
  const toggle = page.getByTestId("watchlist-toggle");
  await expect(toggle).toHaveText(/On watchlist/);
  await toggle.click();
  await expect(toggle).toHaveText(/Add to watchlist/);

  await expect.poll(() => controls.watchlistRemovePosts().length).toBe(1);
  expect(controls.watchlistRemovePosts()[0]?.showIds).toContain(2);

  await page.goto("/library");
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Watchlist" })).toHaveCount(0);
});
