import { expect, test } from "@playwright/test";
import {
  installDiscoverRoutes,
  installHermeticRoutes,
  installSearchRoutes,
  type SearchHitFixture,
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

test("shows the pre-query empty state and issues no request before typing", async ({ page }) => {
  const controls = await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  await expect(page.getByTestId("screen-search")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Discover" })).toBeVisible();
  await expect(page.getByTestId("search-prequery")).toBeVisible();
  // Give any errant debounce a chance to fire, then assert nothing was requested.
  await page.waitForTimeout(600);
  expect(controls.searchQueries()).toEqual([]);
});

test("debounces to exactly one request after the user settles, then renders results", async ({
  page,
}) => {
  const controls = await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  // Type char-by-char faster than the debounce window so the burst collapses to one request.
  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });

  await expect(page.getByTestId("search-results")).toBeVisible();
  await expect(page.getByTestId("search-result")).toHaveCount(2);
  // Advance a full debounce window past the settle: a late duplicate (e.g. a re-fire
  // on results render) would have landed by now. The recorded query list must still
  // be exactly the one settled term — one request, not one per keystroke, and no tail.
  await page.waitForTimeout(600);
  expect(controls.searchQueries()).toEqual(["severance"]);
});

test("renders the no-results empty state for a query with no matches", async ({ page }) => {
  await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  await page.getByTestId("search-input").pressSequentially("widget", { delay: 40 });

  const empty = page.getByTestId("search-no-results");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No matches for "widget"');
});

test("single-medium: a query matching only the hidden medium explains the filter, not 'no matches'", async ({
  page,
}) => {
  // TV-only user searching a title that exists only as a movie: the movie hit is
  // filtered out, but the empty state must name the hidden results + the fix rather
  // than read as a broken search (honest, settings-aware copy).
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installSearchRoutes(page.context(), (query) =>
    query.toLowerCase() === "dune" ? [DUNE] : [],
  );
  await page.goto("/search");

  await page.getByTestId("search-input").pressSequentially("dune", { delay: 40 });

  const empty = page.getByTestId("search-no-results");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No shows match "dune"');
  const note = page.getByTestId("search-hidden-note");
  await expect(note).toContainText("1 result in Movies is hidden");
  await expect(note).toContainText("Turn Movies on in Settings");
});

test("inline Add fires POST /sync/watchlist optimistically", async ({ page }) => {
  const controls = await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });
  await expect(page.getByTestId("search-result")).toHaveCount(2);

  const firstAdd = page.getByTestId("search-add").first();
  await firstAdd.click();
  await expect(firstAdd).toHaveText("Added"); // optimistic
  await expect(firstAdd).toBeDisabled();

  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.showIds).toContain(1);
});

test("the browse rails include Trending + Popular movies with inline add", async ({ page }) => {
  const controls = await installDiscoverRoutes(page.context(), {
    shows: [{ traktId: 1, title: "Severance", year: 2022 }],
    movies: [{ traktId: 9, title: "Dune", year: 2021, tmdb: 438631 }],
  });
  await page.goto("/search");

  // Movie rails render alongside the show rails, same DiscoverCard poster idiom.
  await expect(page.getByTestId("discover-trending-movies")).toBeVisible();
  await expect(page.getByTestId("discover-popular-movies")).toBeVisible();
  const trendingMovies = page.getByTestId("discover-trending-movies-grid");
  await expect(trendingMovies.getByTestId("search-result")).toHaveCount(1);

  // Inline add on a movie rail fires a movies[] watchlist POST (routed by hit type).
  await trendingMovies.getByTestId("search-add").first().click();
  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  const post = controls.watchlistPosts()[0];
  // Proven to route into the movies[] body — not mis-filed under shows[].
  expect(post?.movieIds).toEqual([9]);
  expect(post?.showIds).toEqual([]);
});

test("discover poster tiles carry a gradient+initials placeholder so a lazy tile is never a blank grey block", async ({
  page,
}) => {
  await installDiscoverRoutes(page.context(), {
    shows: [{ traktId: 1, title: "Severance", year: 2022 }],
    movies: [],
  });
  await page.goto("/search");

  const tile = page.getByTestId("discover-trending-grid").getByTestId("search-result").first();
  const frame = tile.locator(".poster").first();
  // The real poster image lays over an always-present placeholder backing: title
  // initials on a warm per-title gradient, so a below-the-fold tile that hasn't
  // decoded reads as a titled tile rather than a flat grey blank.
  await expect(tile.getByTestId("poster-image")).toBeVisible();
  await expect(frame.locator(".poster__initials")).toHaveText("S");
  await expect(frame).toHaveCSS("background-image", /linear-gradient/);
});

test("a recent search chip re-runs the query from the pre-query state", async ({ page }) => {
  await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/search");

  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });
  await expect(page.getByTestId("search-results")).toBeVisible();

  // Clear the input → pre-query state now surfaces the recent term as a chip.
  await page.getByTestId("search-input").fill("");
  const chip = page.getByTestId("search-recent-chip").filter({ hasText: "severance" });
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(page.getByTestId("search-results")).toBeVisible();
});
