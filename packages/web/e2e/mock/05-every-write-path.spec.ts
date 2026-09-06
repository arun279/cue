import { expect, test } from "@playwright/test";
import { connect, landed, settle } from "./_flow";

/**
 * The six write paths, each once. These are the entries the equivalence
 * comparison is really for: a payload that differs, a write coalesced that used
 * to be separate, or a write not enqueued at all is invisible to every other
 * layer, because each app is otherwise only ever compared with its own
 * expectations.
 */

test("marks a whole season in one batched write", async ({ page }) => {
  await connect(page);
  await page.goto("/show/8803");
  await expect(page.getByTestId("screen-show-detail")).toBeVisible();
  await settle(page);

  await page.locator('[data-season="2"]').getByTestId("season-check").click();
  await page.getByTestId("confirm-sheet-primary").click();
  await expect(page.getByTestId("snackbar")).toBeVisible();
  await settle(page);
});

test("stops a show, then resumes it", async ({ page }) => {
  await connect(page);
  await page.goto("/show/8805");
  await expect(page.getByTestId("screen-show-detail")).toBeVisible();
  await settle(page);

  await page.getByTestId("detail-overflow").click();
  await page.getByTestId("overflow-stop").click();
  await landed(page);

  await page.getByTestId("detail-overflow").click();
  await page.getByTestId("overflow-stop").click();
  await landed(page);
  await settle(page);
});

// The seeded account has no show that offers an add (the one never started is
// already watchlisted), so the pair is driven from the movie that is: the remove
// write, then the add its Undo sends.
test("takes a movie off the watchlist and puts it back", async ({ page }) => {
  await connect(page);
  await page.goto("/movie/5503");
  await expect(page.getByTestId("screen-movie-detail")).toBeVisible();
  await settle(page);

  await page.getByTestId("movie-overflow").click();
  await page.getByTestId("overflow-watchlist").click();
  await expect(page.getByTestId("snackbar")).toBeVisible();
  await landed(page);

  await page.getByTestId("snackbar-undo").click();
  await landed(page);
  await settle(page);
});

test("marks a movie watched, then unmarks it", async ({ page }) => {
  await connect(page);
  await page.goto("/movie/5503");
  await expect(page.getByTestId("screen-movie-detail")).toBeVisible();
  await settle(page);

  await page.getByTestId("movie-check").click();
  await settle(page);
  await page.getByTestId("movie-check").click();
  await settle(page);
});

test("removes one play from the history log", async ({ page }) => {
  await connect(page);
  await page.goto("/history");
  await expect(page.getByTestId("screen-history")).toBeVisible();
  await settle(page);

  await page.getByTestId("history-row").first().getByTestId("mark-watched").click();
  await expect(page.getByTestId("snackbar")).toBeVisible();
  await settle(page);
});
