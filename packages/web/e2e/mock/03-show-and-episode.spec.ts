import { expect, test } from "@playwright/test";
import { connect, settle } from "./_flow";

/** Show detail: the header read, the season shelves, and one episode's sheet. */
test("opens a show, its seasons, and one episode's sheet", async ({ page }) => {
  await connect(page);
  await page.getByRole("link", { name: "Library", exact: true }).first().click();
  await page.getByTestId("library-card").first().click();
  await expect(page.getByTestId("screen-show-detail")).toBeVisible();
  await settle(page);

  await expect(page.getByTestId("season-list")).toBeVisible();
  await page.getByTestId("season-trigger").first().click();
  await settle(page);

  await page.getByTestId("episode-row").first().click();
  await expect(page.getByTestId("episode-sheet")).toBeVisible();
  await expect(page.getByTestId("episode-mark-row")).toBeVisible();
  await settle(page);
});

/** Library: the chips, the reveal filter and the sort, over the virtualized grid. */
test("filters and sorts the library", async ({ page }) => {
  await connect(page);
  await page.getByRole("link", { name: "Library", exact: true }).first().click();
  await expect(page.getByTestId("screen-library")).toBeVisible();
  await settle(page);

  await expect(page.getByTestId("library-card").first()).toBeVisible();
  await page.getByTestId("library-filter-toggle").click();
  await page.getByTestId("library-filter").fill("Harbor");
  await expect(page.getByTestId("library-card")).toHaveCount(1);

  await page.getByTestId("library-filter-toggle").click();
  await page.getByTestId("library-sort").click();
  await page.getByTestId("sort-alphabetical").click();
  await settle(page);
});
