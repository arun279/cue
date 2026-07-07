import { expect, test } from "@playwright/test";
import {
  agoIso,
  installHermeticRoutes,
  installLibraryRoutes,
  type ShowFixture,
  seedAuth,
} from "./helpers";

const ZERO_STATS = JSON.stringify({
  movies: { plays: 0, watched: 0, minutes: 0 },
  shows: { watched: 0 },
  episodes: { plays: 0, watched: 0, minutes: 0 },
});

const AIRED = "2026-01-01T00:00:00.000Z";

/** One in-progress show, next = S01E02, so it surfaces on the Continue shelf. */
function shelfShow(overrides: Partial<ShowFixture> = {}): ShowFixture {
  return {
    trakt: 1,
    title: "Solo",
    status: "returning series",
    posters: ["media.trakt.tv/solo.webp"],
    lastWatchedAt: agoIso(2),
    aired: 2,
    completed: 1,
    episodes: [
      { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 11 },
      { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: 12 },
    ],
    ...overrides,
  };
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("renders the watch-stats theatre from /users/me/stats", async ({ page }) => {
  await page.goto("/profile");

  await expect(page.getByTestId("screen-profile")).toBeVisible();
  await expect(page.getByTestId("stat-theatre")).toBeVisible();

  // 17,330 + 15,650 = 32,980 min → 22 days, 21 hr 40 min remainder.
  const time = page.getByTestId("stat-time");
  await expect(time).toContainText("22");
  await expect(time).toContainText("days");
  await expect(time).toContainText("21 hr 40 min");

  await expect(page.getByTestId("stat-episodes")).toContainText("534");
  await expect(page.getByTestId("stat-movies")).toContainText("114");
  await expect(page.getByTestId("stat-shows")).toContainText("40");
});

test("shows a brand-new-account empty state when every count is zero", async ({ page }) => {
  // Registered after the hermetic stats route, so this all-zero fixture wins.
  await page
    .context()
    .route("**/api.trakt.tv/users/me/stats*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: ZERO_STATS }),
    );
  await page.goto("/profile");

  await expect(page.getByTestId("profile-empty")).toBeVisible();
  await expect(page.getByTestId("stat-theatre")).toHaveCount(0);

  // The empty-state CTA now routes to Search (Discover is no longer a destination).
  await page.getByTestId("profile-empty-discover").click();
  await expect(page.getByTestId("screen-search")).toBeVisible();
  await expect(page).toHaveURL(/\/search$/);
});

test("links into Settings & connections and Back returns to Profile", async ({ page }) => {
  await page.goto("/profile");
  await page.getByTestId("link-settings").click();
  await expect(page.getByTestId("screen-settings")).toBeVisible();

  // Settings previously had no way back; the history-aware Back returns to Profile.
  await page.getByTestId("settings-back").click();
  await expect(page.getByTestId("screen-profile")).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);
});

test("shows a Continue-watching poster rail into the Show page", async ({ page }) => {
  await installLibraryRoutes(page.context(), [
    shelfShow({ trakt: 1, title: "Alpha", lastWatchedAt: agoIso(2) }),
    shelfShow({ trakt: 2, title: "Bravo", lastWatchedAt: agoIso(3) }),
  ]);
  await page.goto("/profile");

  const rail = page.getByTestId("profile-continue");
  await expect(rail).toBeVisible();
  await expect(rail.getByTestId("library-card")).toHaveCount(2);

  await rail.getByTestId("library-card").first().click();
  await expect(page).toHaveURL(/\/show\/1$/);
});

test("omits the Continue-watching rail when nothing is tracked", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByTestId("stat-theatre")).toBeVisible();
  await expect(page.getByTestId("profile-continue")).toHaveCount(0);
});
