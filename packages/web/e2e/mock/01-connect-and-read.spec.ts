import { expect, test } from "@playwright/test";
import { connect, settle } from "./_flow";

/**
 * SHELL and the cold read. What the native app has to issue identically: the
 * OAuth exchange, then the library reads that paint the first screen, and no
 * more of them than this.
 */
test("connects and paints Up Next from a cold start", async ({ page }) => {
  await connect(page);
  await settle(page);

  await expect(page.getByTestId("up-next-list")).toBeVisible();
  await expect(page.getByTestId("up-next-card").first()).toBeVisible();
});

test("walks the four tabs", async ({ page }) => {
  await connect(page);

  for (const [label, screen] of [
    ["Library", "screen-library"],
    ["Calendar", "screen-calendar"],
    ["Search", "screen-search"],
    ["Up Next", "screen-up-next"],
  ] as const) {
    await page.getByRole("link", { name: label, exact: true }).first().click();
    await expect(page.getByTestId(screen)).toBeVisible();
    await settle(page);
  }
});
