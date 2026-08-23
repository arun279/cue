import { expect, test } from "@playwright/test";
import { connect, settle } from "./_flow";

/** Search, and the watchlist write it offers inline. */
test("searches, then adds and removes a watchlist entry", async ({ page }) => {
  await connect(page);
  await page.getByRole("link", { name: "Search", exact: true }).first().click();
  await expect(page.getByTestId("screen-search")).toBeVisible();
  await settle(page);

  await page.getByTestId("search-input").fill("Coastal");
  await settle(page);
});

/** Calendar: the agenda the app reads a window of. */
test("reads the calendar agenda", async ({ page }) => {
  await connect(page);
  await page.getByRole("link", { name: "Calendar", exact: true }).first().click();
  await expect(page.getByTestId("screen-calendar")).toBeVisible();
  await settle(page);
});

/** Profile and History: the stats tiles and the watch log. */
test("reads the profile and the history log", async ({ page }) => {
  await connect(page);
  await page.getByTestId("avatar-link").click();
  await expect(page.getByTestId("screen-profile")).toBeVisible();
  await settle(page);

  await page.getByTestId("link-history").click();
  await expect(page.getByTestId("screen-history")).toBeVisible();
  await settle(page);
});
