import { expect, test } from "@playwright/test";
import {
  agoIso,
  installDiscoverRoutes,
  installHermeticRoutes,
  installLibraryRoutes,
  installSearchRoutes,
  type SearchHitFixture,
  type ShowFixture,
  seedAuth,
  seedMediaVisibility,
} from "./helpers";

const SEVERANCE: SearchHitFixture = { type: "show", traktId: 1, title: "Severance", year: 2022 };
const DUNE: SearchHitFixture = { type: "movie", traktId: 9, title: "Dune", year: 2021 };

/** Resolve non-empty for anything but the sentinel no-match term. */
function defaultResolve(query: string): readonly SearchHitFixture[] {
  if (query.toLowerCase() === "widget") return [];
  return [SEVERANCE, DUNE];
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("idle shows the browse grids, never auto-focuses, and issues no request before typing", async ({
  page,
}) => {
  const controls = await installSearchRoutes(page.context(), defaultResolve);
  await installDiscoverRoutes(page.context(), {
    shows: [{ traktId: 1, title: "Severance", year: 2022 }],
    movies: [{ traktId: 9, title: "Dune", year: 2021, tmdb: 438631 }],
  });
  await page.goto("/search");

  await expect(page.getByTestId("screen-search")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();

  // The keyboard never pops uninvited: the field is not auto-focused.
  const focused = await page
    .getByTestId("search-input")
    .evaluate((el) => el === document.activeElement);
  expect(focused).toBe(false);

  // Idle = the trending/popular poster GRIDS (not rails) by medium.
  await expect(page.getByTestId("search-browse")).toBeVisible();
  await expect(page.getByTestId("search-trending-shows")).toBeVisible();
  await expect(page.getByTestId("search-popular-movies")).toBeVisible();
  await expect(page.getByTestId("search-trending-shows").getByTestId("browse-tile")).toHaveCount(1);

  // Give any errant debounce a chance to fire, then assert nothing was requested.
  await page.waitForTimeout(600);
  expect(controls.searchQueries()).toEqual([]);
});

test("debounces to exactly one request after the user settles, then renders result rows", async ({
  page,
}) => {
  const controls = await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  // Type char-by-char faster than the debounce window so the burst collapses to one request.
  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });

  await expect(page.getByTestId("search-results")).toBeVisible();
  const results = page.getByTestId("search-result");
  await expect(results).toHaveCount(2);
  // Each row carries its media-type badge + year; the trailing control is the
  // deterministic "+ Watchlist" (no control ever covers poster art).
  await expect(results.first().getByTestId("search-result-type")).toHaveText(/Show|Movie/);
  await expect(results.first().getByTestId("search-add")).toHaveText("+ Watchlist");

  // Advance a full debounce window past the settle: a late duplicate would have
  // landed by now. One request, not one per keystroke, and no tail.
  await page.waitForTimeout(600);
  expect(controls.searchQueries()).toEqual(["severance"]);
});

test("renders the no-results empty state for a query with no matches", async ({ page }) => {
  await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  await page.getByTestId("search-input").pressSequentially("widget", { delay: 40 });

  const empty = page.getByTestId("search-no-results");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Nothing for "widget".');
  await expect(empty).toContainText("Check spelling or try the year.");
});

test("single-medium: a query matching only the hidden medium explains the filter, not 'no matches'", async ({
  page,
}) => {
  // TV-only user searching a title that exists only as a movie: the movie hit is
  // filtered out, but the empty state must name the hidden results + the fix
  // rather than read as a broken search.
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installSearchRoutes(page.context(), (query) =>
    query.toLowerCase() === "dune" ? [DUNE] : [],
  );
  await page.goto("/search");

  await page.getByTestId("search-input").pressSequentially("dune", { delay: 40 });

  const empty = page.getByTestId("search-no-results");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Nothing for "dune".');
  await expect(empty).toContainText("1 result is hidden in Movies");
  await expect(empty).toContainText("Turn Movies on in Settings");
});

test("the '+ Watchlist' control adds optimistically, flashes Added, and settles In library", async ({
  page,
}) => {
  const controls = await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });
  await expect(page.getByTestId("search-result")).toHaveCount(2);

  const showRow = page.getByTestId("search-result").filter({ hasText: "Severance" });
  await showRow.getByTestId("search-add").click();

  // The 600ms filled confirmation, then the quiet in-library state.
  await expect(showRow.getByTestId("search-added")).toHaveText("Added ✓");
  await expect(showRow.getByTestId("search-in-library")).toHaveText("In library");

  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.showIds).toContain(1);

  // The one snackbar confirms with Undo: reversing drops the membership and the
  // add affordance returns.
  await expect(page.getByTestId("snackbar")).toContainText("Severance added to Watchlist");
  await page.getByTestId("snackbar-undo").click();
  await expect.poll(() => controls.watchlistRemovePosts().length).toBe(1);
  await expect(showRow.getByTestId("search-add")).toBeVisible();
});

test("a movie hit routes its add into the movies[] watchlist body", async ({ page }) => {
  const controls = await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });
  const movieRow = page.getByTestId("search-result").filter({ hasText: "Dune" });
  await movieRow.getByTestId("search-add").click();

  // Proven to route into the movies[] body: not mis-filed under shows[].
  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.showIds).toContain(9);
});

test("a show already in the library reads as a static In-library chip", async ({ page }) => {
  const tracked: ShowFixture = {
    trakt: 1,
    title: "Severance",
    status: "returning series",
    posters: ["media.trakt.tv/p.webp"],
    lastWatchedAt: agoIso(2),
    aired: 2,
    completed: 1,
    inWatchlist: true,
    episodes: [
      { season: 1, number: 1, title: "One", firstAired: "2026-01-01T00:00:00.000Z", traktId: 11 },
      { season: 1, number: 2, title: "Two", firstAired: "2026-01-01T00:00:00.000Z", traktId: 12 },
    ],
  };
  await installLibraryRoutes(page.context(), [tracked]);
  await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });
  const showRow = page.getByTestId("search-result").filter({ hasText: "Severance" });
  await expect(showRow.getByTestId("search-in-library")).toHaveText("In library");
  await expect(showRow.getByTestId("search-add")).toHaveCount(0);
});

test("browse poster tiles carry a gradient+initials placeholder so a lazy tile is never blank", async ({
  page,
}) => {
  await installDiscoverRoutes(page.context(), {
    shows: [{ traktId: 1, title: "Severance", year: 2022 }],
    movies: [],
  });
  await page.goto("/search");

  const tile = page.getByTestId("search-trending-shows").getByTestId("browse-tile").first();
  const frame = tile.locator(".poster").first();
  // The real poster image lays over an always-present placeholder backing:
  // title initials on a warm gradient, never a flat grey blank.
  await expect(tile.getByTestId("poster-image")).toBeVisible();
  await expect(frame.locator(".poster__initials")).toHaveText("S");
});

test("a recent search re-runs from the idle state", async ({ page }) => {
  await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });
  await expect(page.getByTestId("search-results")).toBeVisible();

  // Clear the input → idle state now surfaces the recent term as a re-run row.
  await page.getByTestId("search-clear").click();
  const recent = page.getByTestId("search-recent-row").filter({ hasText: "severance" });
  await expect(recent).toBeVisible();

  await recent.click();
  await expect(page.getByTestId("search-results")).toBeVisible();
});

test("offline search shows the honest connection panel for a live query", async ({ page }) => {
  await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");
  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });
  await expect(page.getByTestId("search-results")).toBeVisible();

  // Search is the one surface that genuinely needs a connection.
  await page.context().setOffline(true);
  await expect(page.getByTestId("search-offline")).toContainText("Search needs a connection.");
  await page.context().setOffline(false);
  await expect(page.getByTestId("search-results")).toBeVisible();
});
