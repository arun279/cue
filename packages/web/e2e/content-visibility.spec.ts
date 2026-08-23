import { expect, test } from "@playwright/test";
import {
  agoIso,
  type EpisodeFixture,
  type HistoryRowFixture,
  installDiscoverRoutes,
  installHermeticRoutes,
  installHistoryRoutes,
  installLibraryRoutes,
  type ShowFixture,
  seedAuth,
  seedMediaVisibility,
} from "./helpers";

const AIRED = "2026-01-01T00:00:00.000Z";

function ep(season: number, number: number, traktId: number): EpisodeFixture {
  return { season, number, title: `Episode ${number}`, firstAired: AIRED, traktId };
}

function oneShow(): ShowFixture[] {
  return [
    {
      trakt: 1,
      title: "Watch Me",
      status: "returning series",
      lastWatchedAt: agoIso(2),
      aired: 10,
      completed: 5,
      episodes: Array.from({ length: 10 }, (_, i) => ep(1, i + 1, 100 + i)),
    },
  ];
}

const DISCOVER = {
  shows: [{ traktId: 1, title: "Severance", year: 2022 }],
  movies: [{ traktId: 9, title: "Dune", year: 2021 }],
} as const;

/** One TV play + one movie play, so a locked single-medium History can be shown
 * to carry only its own medium's rows. */
function historyRows(): HistoryRowFixture[] {
  return [
    {
      id: 11,
      type: "episode",
      showId: 100,
      showTitle: "The Bear",
      season: 1,
      number: 8,
      episodeTitle: "Braciole",
      watchedAt: "2026-07-15T15:00:00.000Z",
    },
    {
      id: 14,
      type: "movie",
      movieId: 200,
      movieTitle: "Interstellar",
      year: 2014,
      watchedAt: "2026-07-15T12:00:00.000Z",
    },
  ];
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

// ---- Default: both media on, everything unchanged ----

test("defaults to both media on: Library segment + both Settings switches present", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), oneShow());
  await page.goto("/library");

  // The Shows/Movies segmented control is present when both media are on.
  await expect(page.getByTestId("type-shows")).toBeVisible();
  await expect(page.getByTestId("type-movies")).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByTestId("content-section")).toBeVisible();
  await expect(page.getByTestId("content-toggle-shows")).toBeChecked();
  await expect(page.getByTestId("content-toggle-movies")).toBeChecked();
  // Neither is the "last enabled" one, so both can be switched off.
  await expect(page.getByTestId("content-toggle-shows")).toBeEnabled();
  await expect(page.getByTestId("content-toggle-movies")).toBeEnabled();
});

// ---- Movies disabled (the common TV-only case) ----

test("TV-only: Library pins to Shows with no segment; all four tabs stay", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installLibraryRoutes(page.context(), oneShow());
  await page.goto("/library");

  await expect(page.getByTestId("screen-library")).toBeVisible();
  // A single active medium shows no Shows/Movies segment: the show chips render directly.
  await expect(page.getByTestId("type-shows")).toHaveCount(0);
  await expect(page.getByTestId("type-movies")).toHaveCount(0);
  await expect(page.getByTestId("chip-watching")).toBeVisible();

  // A TV-only user keeps the full 4-tab set (Up Next, Library, Calendar, Search).
  await expect(page.locator(".sidebar__links a")).toHaveCount(4);
  await expect(
    page.locator(".sidebar").getByRole("link", { name: "Search", exact: true }),
  ).toBeVisible();
});

test("TV-only: Search hides the movie browse grid", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installDiscoverRoutes(page.context(), DISCOVER);
  await page.goto("/search");

  await expect(page.getByTestId("search-trending-shows")).toBeVisible();
  await expect(page.getByTestId("search-popular-movies")).toHaveCount(0);
});

test("TV-only: /library?type=movies is redirected to Shows", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installLibraryRoutes(page.context(), oneShow());
  await page.goto("/library?type=movies");

  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByTestId("chip-watching")).toBeVisible();
});

test("TV-only: /movie/:id lands on a quiet Movies-are-off notice with a Settings link", async ({
  page,
}) => {
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await page.goto("/movie/200");

  await expect(page.getByTestId("movies-off")).toBeVisible();
  await expect(page.getByTestId("movies-off")).toContainText("Movies are turned off");
  await page.getByTestId("movies-off-settings").click();
  await expect(page.getByTestId("screen-settings")).toBeVisible();
});

test("TV-only: home Previously excludes recent movie plays", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installLibraryRoutes(page.context(), oneShow());
  await installHistoryRoutes(
    page.context(),
    historyRows().map((row, index) => ({
      ...row,
      watchedAt: new Date(Date.now() - (index + 1) * 3_600_000).toISOString(),
    })),
  );
  await page.goto("/");

  const previously = page.getByTestId("previously");
  await expect(previously).toBeVisible();
  await expect(
    previously.getByTestId("previously-row").filter({ hasText: "The Bear" }),
  ).toBeVisible();
  await expect(
    previously.getByTestId("previously-row").filter({ hasText: "Interstellar" }),
  ).toHaveCount(0);
});

test("TV-only: Profile hides the Movies tile and its minutes leave the total", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installHistoryRoutes(page.context(), historyRows());
  await page.clock.setFixedTime(new Date("2026-07-15T16:00:00.000Z"));
  await page.goto("/profile");

  await expect(page.getByTestId("stat-theatre")).toBeVisible();
  await expect(page.getByTestId("stat-episodes")).toBeVisible();
  await expect(page.getByTestId("stat-shows")).toBeVisible();
  // The Movies tile is gone, and the total is recomputed to TV minutes only
  // (17,330 min → 12 days): not the both-media 32,980 min (22 days).
  await expect(page.getByTestId("stat-movies")).toHaveCount(0);
  const time = page.getByTestId("stat-time");
  await expect(time).toContainText("12");
  await expect(time).toContainText("days");
  await expect(time).not.toContainText("22");

  // The watch history is locked to TV: no medium chips, and only TV plays appear.
  await page.goto("/history");
  await expect(page.getByTestId("screen-history")).toBeVisible();
  await expect(page.getByTestId("history-filter-movies")).toHaveCount(0);
  await expect(page.getByTestId("history-row").filter({ hasText: "The Bear" })).toBeVisible();
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toHaveCount(0);
});

// ---- TV disabled (the movies-only case) ----

test("movies-only: the nav prunes Up Next AND Calendar, keeping Library + Search", async ({
  page,
}) => {
  await seedMediaVisibility(page.context(), { showsEnabled: false, moviesEnabled: true });
  await installLibraryRoutes(page.context(), []);
  await page.goto("/library");

  const sidebar = page.locator(".sidebar");
  // The episodic Up Next AND the episodic Calendar are gone: two cross-media
  // jobs remain (History lives under Profile, so it never was a tab).
  await expect(sidebar.locator(".sidebar__links a")).toHaveCount(2);
  await expect(sidebar.getByRole("link", { name: "Library", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Search", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Up Next", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Calendar", exact: true })).toHaveCount(0);

  // The phone tab bar prunes identically.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("tab-library")).toBeVisible();
  await expect(page.getByTestId("tab-search")).toBeVisible();
  await expect(page.getByTestId("tab-up-next")).toHaveCount(0);
  await expect(page.getByTestId("tab-calendar")).toHaveCount(0);
});

test("movies-only: home and calendar route to the movies Library", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: false, moviesEnabled: true });
  await installLibraryRoutes(page.context(), []);

  await page.goto("/");
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByTestId("chip-watchlist")).toBeVisible();

  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByTestId("screen-library")).toBeVisible();
});

test("movies-only: Search hides the show browse grid", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: false, moviesEnabled: true });
  await installDiscoverRoutes(page.context(), DISCOVER);
  await page.goto("/search");

  await expect(page.getByTestId("search-popular-movies")).toBeVisible();
  await expect(page.getByTestId("search-trending-shows")).toHaveCount(0);
});

test("movies-only: Profile keeps only the Movies tile and its minutes", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: false, moviesEnabled: true });
  await page.goto("/profile");

  await expect(page.getByTestId("stat-movies")).toBeVisible();
  await expect(page.getByTestId("stat-episodes")).toHaveCount(0);
  await expect(page.getByTestId("stat-shows")).toHaveCount(0);
  // 15,650 movie minutes → 10 days, not the both-media 22 days.
  const time = page.getByTestId("stat-time");
  await expect(time).toContainText("10");
  await expect(time).toContainText("days");
  await expect(time).not.toContainText("22");
});

// ---- Both-off is prevented ----

test("disabling the last-enabled medium is prevented", async ({ page }) => {
  await page.goto("/settings");

  // Turn Movies off; Shows is now the only enabled medium.
  await page.getByTestId("content-toggle-movies").click();
  await expect(page.getByTestId("content-toggle-movies")).not.toBeChecked();

  // The Shows switch, now the last one on, is locked so the app can't be emptied,
  // and stays checked. A short hint explains the rule.
  await expect(page.getByTestId("content-toggle-shows")).toBeDisabled();
  await expect(page.getByTestId("content-toggle-shows")).toBeChecked();
  await expect(page.getByTestId("content-hint")).toContainText("At least one stays on");
});

// ---- Persistence + device-local ----

test("the choice persists across reload and lives only in localStorage", async ({ page }) => {
  await page.goto("/settings");
  await page.getByTestId("content-toggle-movies").click();
  await expect(page.getByTestId("content-toggle-movies")).not.toBeChecked();

  await page.reload();
  // The stored choice wins after reload: Movies stays off, Shows stays locked-on.
  await expect(page.getByTestId("content-toggle-movies")).not.toBeChecked();
  await expect(page.getByTestId("content-toggle-shows")).toBeDisabled();

  // Device-local: the pref lives in localStorage (never Trakt-synced).
  const stored = await page.evaluate(() => localStorage.getItem("cue.movies-enabled"));
  expect(stored).toBe("0");

  // And it drives the surfaces after reload: Library shows no movie segment.
  await page.goto("/library");
  await expect(page.getByTestId("type-movies")).toHaveCount(0);
});

// ---- Compliance surfaces: Trakt attribution + account-deletion hand-off ----

test("Settings carries the Trakt attribution and a distinct delete-account hand-off to Trakt", async ({
  page,
}) => {
  await page.goto("/settings");

  // Required Trakt attribution (a condition of the free API).
  await expect(page.getByTestId("trakt-attribution")).toContainText(
    "not created, endorsed, or sponsored by Trakt",
  );
  await expect(page.getByTestId("powered-by-trakt")).toContainText("Powered by Trakt");

  // A delete-account row distinct from Sign out that opens Trakt's own settings
  // in a new browser context (Apple 5.1.1(v) / Google account-deletion).
  const deleteAccount = page.getByTestId("link-delete-account");
  await expect(deleteAccount).toHaveAttribute("href", "https://app.trakt.tv/settings/advanced");
  await expect(deleteAccount).toHaveAttribute("target", "_blank");
  await expect(deleteAccount).toHaveAttribute("rel", /noopener/);
  // It is a separate control from Sign out, not a relabel of it.
  await expect(page.getByTestId("button-disconnect")).toBeVisible();
});
