import { expect, test } from "@playwright/test";
import {
  installHermeticRoutes,
  installSearchRoutes,
  type SearchHitFixture,
  seedAuth,
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
  await page.goto("/discover");

  await expect(page.getByTestId("search-prequery")).toBeVisible();
  // Give any errant debounce a chance to fire, then assert nothing was requested.
  await page.waitForTimeout(600);
  expect(controls.searchQueries()).toEqual([]);
});

test("debounces to exactly one request after the user settles, then renders results", async ({
  page,
}) => {
  const controls = await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/discover");

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
  await page.goto("/discover");

  await page.getByTestId("search-input").pressSequentially("widget", { delay: 40 });

  const empty = page.getByTestId("search-no-results");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No matches for "widget"');
});

test("inline Add fires POST /sync/watchlist optimistically", async ({ page }) => {
  const controls = await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/discover");

  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });
  await expect(page.getByTestId("search-result")).toHaveCount(2);

  const firstAdd = page.getByTestId("search-add").first();
  await firstAdd.click();
  await expect(firstAdd).toHaveText("Added"); // optimistic
  await expect(firstAdd).toBeDisabled();

  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.showIds).toContain(1);
});

test("a recent search chip re-runs the query from the pre-query state", async ({ page }) => {
  await installSearchRoutes(page.context(), defaultResolve);
  await page.goto("/discover");

  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });
  await expect(page.getByTestId("search-results")).toBeVisible();

  // Clear the input → pre-query state now surfaces the recent term as a chip.
  await page.getByTestId("search-input").fill("");
  const chip = page.getByTestId("search-recent-chip").filter({ hasText: "severance" });
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(page.getByTestId("search-results")).toBeVisible();
});
