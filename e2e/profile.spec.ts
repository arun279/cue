import { expect, test } from "@playwright/test";
import { installHermeticRoutes, seedAuth } from "./helpers";

const ZERO_STATS = JSON.stringify({
  movies: { plays: 0, watched: 0, minutes: 0 },
  shows: { watched: 0 },
  episodes: { plays: 0, watched: 0, minutes: 0 },
});

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("renders the identity row from /users/settings: avatar, display name, account line", async ({
  page,
}) => {
  await page.goto("/profile");

  await expect(page.getByTestId("screen-profile")).toBeVisible();
  const identity = page.getByTestId("profile-identity");
  await expect(identity).toBeVisible();
  // Display name prefers the profile's `name`; the sub-line stays "Trakt account".
  await expect(page.getByTestId("profile-username")).toHaveText("Test User");
  await expect(page.getByTestId("connection-status")).toHaveText("Trakt account");
  // The real avatar image resolved (served by the hermetic media route).
  await expect(identity.locator("img")).toBeVisible();
});

test("renders the watch-time hero and count tiles from /users/me/stats", async ({ page }) => {
  await page.goto("/profile");

  await expect(page.getByTestId("stat-theatre")).toBeVisible();

  // 17,330 + 15,650 = 32,980 min → 22 days, 21 hr 40 min remainder.
  const time = page.getByTestId("stat-time");
  await expect(time).toContainText("Total watch time");
  await expect(time).toContainText("22");
  await expect(time).toContainText("days");
  await expect(time).toContainText("21 hr 40 min");

  await expect(page.getByTestId("stat-episodes")).toContainText("534");
  await expect(page.getByTestId("stat-movies")).toContainText("114");
  await expect(page.getByTestId("stat-shows")).toContainText("40");
});

test("shows a brand-new-account empty state when every count is zero", async ({ page }) => {
  await page
    .context()
    .route("**/api.trakt.tv/users/me/stats*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: ZERO_STATS }),
    );
  await page.goto("/profile");

  await expect(page.getByTestId("profile-empty")).toBeVisible();
  await expect(page.getByTestId("stat-theatre")).toHaveCount(0);

  await page.getByTestId("profile-empty-discover").click();
  await expect(page.getByTestId("screen-search")).toBeVisible();
  await expect(page).toHaveURL(/\/search$/);
});

test("Profile is a hub: bounded nav rows + sign out, no unbounded scroll", async ({ page }) => {
  await page.goto("/profile");

  // The unbounded watch log is NOT on Profile: it is a spoke, not the body.
  await expect(page.getByTestId("screen-history")).toHaveCount(0);

  // Both hub rows and the sign-out affordance are one tap away.
  await expect(page.getByTestId("link-history")).toBeVisible();
  await expect(page.getByTestId("link-settings")).toBeVisible();
  await expect(page.getByTestId("button-disconnect")).toBeVisible();
});

test("links into Settings and Back returns to Profile", async ({ page }) => {
  await page.goto("/profile");
  await page.getByTestId("link-settings").click();
  await expect(page.getByTestId("screen-settings")).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("screen-profile")).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);
});

test("links into the watch history and Back returns to Profile", async ({ page }) => {
  await page.goto("/profile");
  await page.getByTestId("link-history").click();

  await expect(page.getByTestId("screen-history")).toBeVisible();
  await expect(page).toHaveURL(/\/history$/);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("screen-profile")).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);
});
