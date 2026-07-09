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

/** One TV play + one movie play, so a locked single-medium Diary can be shown to
 * carry only its own medium's rows. */
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

test("defaults to both media on — Library toggle + both Settings switches present", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), oneShow());
  await page.goto("/library");

  // The Shows/Movies segmented toggle is present when both media are on.
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

test("TV-only: Library shows only Shows with no toggle", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installLibraryRoutes(page.context(), oneShow());
  await page.goto("/library");

  await expect(page.getByTestId("screen-library")).toBeVisible();
  // A single active medium shows no Shows/Movies toggle.
  await expect(page.getByTestId("type-shows")).toHaveCount(0);
  await expect(page.getByTestId("type-movies")).toHaveCount(0);
  await expect(page.getByTestId("library-filter")).toHaveAttribute("placeholder", "Filter shows…");

  // Discover is a first-class tab (Search's old header affordance); it stays for a
  // single-medium user, searching only their active medium via the field label.
  await expect(
    page.locator(".sidebar").getByRole("link", { name: "Discover", exact: true }),
  ).toBeVisible();
});

test("TV-only: Search hides the movie discover rails", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installDiscoverRoutes(page.context(), DISCOVER);
  await page.goto("/search");

  await expect(page.getByTestId("discover-trending")).toBeVisible();
  await expect(page.getByTestId("discover-trending-movies")).toHaveCount(0);
  await expect(page.getByTestId("discover-popular-movies")).toHaveCount(0);
});

test("TV-only: /library?type=movies is redirected to Shows", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installLibraryRoutes(page.context(), oneShow());
  await page.goto("/library?type=movies");

  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByTestId("library-filter")).toHaveAttribute("placeholder", "Filter shows…");
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

test("TV-only: Profile hides the Movies tile and its minutes leave the total", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: true, moviesEnabled: false });
  await installHistoryRoutes(page.context(), historyRows());
  await page.clock.setFixedTime(new Date("2026-07-15T16:00:00.000Z"));
  await page.goto("/profile");

  await expect(page.getByTestId("stat-theatre")).toBeVisible();
  await expect(page.getByTestId("stat-episodes")).toBeVisible();
  await expect(page.getByTestId("stat-shows")).toBeVisible();
  // The Movies tile is gone, and the total is recomputed to TV minutes only (17,330
  // min → 12 days) — not the both-media 32,980 min (22 days).
  await expect(page.getByTestId("stat-movies")).toHaveCount(0);
  const time = page.getByTestId("stat-time");
  await expect(time).toContainText("12");
  await expect(time).toContainText("days");
  await expect(time).not.toContainText("22");

  // The watch history is locked to TV: no type toggle, and only TV plays appear.
  await page.goto("/history");
  await expect(page.getByTestId("screen-history")).toBeVisible();
  await expect(page.getByTestId("history-filter-movies")).toHaveCount(0);
  await expect(page.getByTestId("history-row").filter({ hasText: "The Bear" })).toBeVisible();
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toHaveCount(0);
});

// ---- TV disabled (the movies-only case) ----

test("movies-only: nav sheds only the episodic Up Next, keeping Library/History/Discover", async ({
  page,
}) => {
  await seedMediaVisibility(page.context(), { showsEnabled: false, moviesEnabled: true });
  await installLibraryRoutes(page.context(), []);
  await page.goto("/library");

  const sidebar = page.locator(".sidebar");
  // Three cross-media jobs remain; the TV-centric Up Next (and Calendar) are gone.
  await expect(sidebar.locator(".sidebar__links a")).toHaveCount(3);
  await expect(sidebar.getByRole("link", { name: "Library", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "History", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Discover", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Up Next", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Calendar", exact: true })).toHaveCount(0);
});

test("movies-only: home and calendar route to the movies Library", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: false, moviesEnabled: true });
  await installLibraryRoutes(page.context(), []);

  await page.goto("/");
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByTestId("library-filter")).toHaveAttribute("placeholder", "Filter movies…");

  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByTestId("screen-library")).toBeVisible();
});

test("movies-only: Search hides the show discover rails", async ({ page }) => {
  await seedMediaVisibility(page.context(), { showsEnabled: false, moviesEnabled: true });
  await installDiscoverRoutes(page.context(), DISCOVER);
  await page.goto("/search");

  await expect(page.getByTestId("discover-trending-movies")).toBeVisible();
  await expect(page.getByTestId("discover-trending")).toHaveCount(0);
  await expect(page.getByTestId("discover-popular")).toHaveCount(0);
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

  // The Shows switch — now the last one on — is locked so the app can't be emptied,
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
  // The stored choice wins after reload — Movies stays off, Shows stays locked-on.
  await expect(page.getByTestId("content-toggle-movies")).not.toBeChecked();
  await expect(page.getByTestId("content-toggle-shows")).toBeDisabled();

  // Device-local: the pref lives in localStorage (never Trakt-synced).
  const stored = await page.evaluate(() => localStorage.getItem("cue.movies-enabled"));
  expect(stored).toBe("0");

  // And it drives the surfaces after reload — Library shows no movie toggle.
  await page.goto("/library");
  await expect(page.getByTestId("type-movies")).toHaveCount(0);
});
