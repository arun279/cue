import { expect, test } from "@playwright/test";
import {
  type EpisodeFixture,
  installHermeticRoutes,
  installLibraryRoutes,
  type ShowFixture,
  seedAuth,
} from "./helpers";

// Ratings left the product (the check is the one verb); this suite keeps the
// WATCHLIST flows that shared the old file.

const FUTURE = "2027-01-01T00:00:00.000Z";

function ep(season: number, number: number, firstAired: string, traktId: number): EpisodeFixture {
  return { season, number, title: `Episode ${number}`, firstAired, traktId };
}

/** A not-yet-started show (aired 0, completed 0): buckets as Watchlist once watchlisted. */
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

test("no rating UI exists anywhere on the detail surfaces", async ({ page }) => {
  const show: ShowFixture = {
    ...notStartedShow(),
    trakt: 1,
    title: "The Detail Show",
    lastWatchedAt: "2026-06-05T00:00:00.000Z",
    aired: 3,
    completed: 2,
    episodes: [
      ep(1, 1, "2026-01-01T00:00:00.000Z", 11),
      ep(1, 2, "2026-01-01T00:00:00.000Z", 12),
      ep(1, 3, "2026-01-01T00:00:00.000Z", 13),
    ],
  };
  await installLibraryRoutes(page.context(), [show]);

  await page.goto("/show/1");
  await expect(page.getByTestId("detail-title")).toBeVisible();
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByText(/\/10/)).toHaveCount(0);

  await page.goto("/show/1/episode/1/2");
  await expect(page.getByTestId("episode-sheet")).toBeVisible();
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByText(/\/10/)).toHaveCount(0);
});

test("adding a never-watched show to the watchlist surfaces it under the Library Watchlist chip", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [notStartedShow()]);

  // A never-watched, un-watchlisted show is absent from /sync/watched/shows and
  // the watchlist, so it does not appear in the Library at all: the watchlist is
  // its only route in (regression guard for the watchlist-only refetch bug).
  await page.goto("/library");
  await page.getByTestId("chip-watchlist").click();
  await expect(page.getByTestId("library-card").filter({ hasText: "Watchlist Show" })).toHaveCount(
    0,
  );

  // The show detail's overflow offers "Move to Watchlist" for a show not yet started.
  await page.goto("/show/2");
  await page.getByTestId("detail-overflow").click();
  await page.getByTestId("overflow-watchlist").click();
  await expect(page.getByTestId("snackbar")).toContainText("Watchlist Show added to Watchlist");

  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.showIds).toContain(2);

  // The Watchlist chip now holds the show, and it SURVIVES a full reload+refetch
  // (a watched-shows-only library would drop it here).
  await page.goto("/library");
  await page.getByTestId("chip-watchlist").click();
  await expect(page.getByTestId("library-card").filter({ hasText: "Watchlist Show" })).toHaveCount(
    1,
  );
});

test("the watchlist add's snackbar Undo removes the membership again", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [notStartedShow()]);
  await page.goto("/show/2");

  await page.getByTestId("detail-overflow").click();
  await page.getByTestId("overflow-watchlist").click();
  await expect.poll(() => controls.watchlistPosts().length).toBe(1);

  await page.getByTestId("snackbar-undo").click();
  await expect.poll(() => controls.watchlistRemovePosts().length).toBe(1);
  expect(controls.watchlistRemovePosts()[0]?.showIds).toContain(2);

  // The membership is genuinely gone once the freshness gate reports the
  // watchlist change (the poll-driven signal a real Trakt write produces).
  controls.bumpActivity("watchlist", "updated_at");
  await page.goto("/library");
  await page.evaluate(() => globalThis.dispatchEvent(new Event("online")));
  await page.getByTestId("chip-watchlist").click();
  await expect(page.getByTestId("library-card").filter({ hasText: "Watchlist Show" })).toHaveCount(
    0,
  );
});
