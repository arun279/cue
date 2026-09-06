import { expect, test } from "@playwright/test";
import {
  type HistoryRowFixture,
  installHermeticRoutes,
  installHistoryRoutes,
  seedAuth,
} from "./helpers";

// Freeze the clock so day grouping (Today / Yesterday) AND the month-jump's
// "current year" are deterministic. 2026-07-15T16:00Z = 12:00 in America/New_York
// (the pinned Playwright timezone), so "today" is 2026-07-15 and the year is 2026.
const FIXED = new Date("2026-07-15T16:00:00.000Z");

/** A day of plays: three The Bear episodes + a movie "today", plus one
 * Severance episode "yesterday" (a second page at pageSize 4). */
function recentRows(): HistoryRowFixture[] {
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
      id: 12,
      type: "episode",
      showId: 100,
      showTitle: "The Bear",
      season: 1,
      number: 7,
      episodeTitle: "Review",
      watchedAt: "2026-07-15T14:30:00.000Z",
    },
    {
      id: 13,
      type: "episode",
      showId: 100,
      showTitle: "The Bear",
      season: 1,
      number: 6,
      episodeTitle: "Ceres",
      watchedAt: "2026-07-15T14:00:00.000Z",
    },
    {
      id: 14,
      type: "movie",
      movieId: 200,
      movieTitle: "Interstellar",
      year: 2014,
      watchedAt: "2026-07-15T12:00:00.000Z",
    },
    {
      id: 21,
      type: "episode",
      showId: 300,
      showTitle: "Severance",
      season: 1,
      number: 3,
      episodeTitle: "In Perpetuity",
      watchedAt: "2026-07-14T20:00:00.000Z",
    },
  ];
}

/** Plays spread across years and months, for the month-jump tests. */
function decadeRows(): HistoryRowFixture[] {
  return [
    {
      id: 14,
      type: "movie",
      movieId: 200,
      movieTitle: "Interstellar",
      year: 2014,
      watchedAt: "2026-07-15T12:00:00.000Z",
    },
    {
      id: 31,
      type: "movie",
      movieId: 301,
      movieTitle: "Dune",
      year: 2021,
      watchedAt: "2024-03-10T18:00:00.000Z",
    },
    {
      id: 32,
      type: "movie",
      movieId: 302,
      movieTitle: "Oppenheimer",
      year: 2023,
      watchedAt: "2024-06-20T18:00:00.000Z",
    },
  ];
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
  await page.clock.setFixedTime(FIXED);
});

test("groups by local day with rollup headers and pages in earlier history by scrolling", async ({
  page,
}) => {
  await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");

  await expect(page.getByTestId("screen-history")).toBeVisible();

  // Today's sticky header carries the play-count rollup.
  const days = page.getByTestId("history-day-heading");
  await expect(days.first()).toContainText("Today");
  await expect(days.first()).toContainText("3 episodes");
  await expect(days.first()).toContainText("1 movie");

  // Distinct episodes are distinct rows (only same-item plays collapse).
  await expect(page.getByTestId("history-row").filter({ hasText: "The Bear" })).toHaveCount(3);
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();

  // Yesterday is a second page: infinite scroll pulls it in via the sentinel
  // (no button press needed on a short list: the sentinel is already near).
  await expect(page.getByTestId("history-day-heading").nth(1)).toContainText("Yesterday");
  await expect(page.getByTestId("history-row").filter({ hasText: "Severance" })).toBeVisible();
});

test("same-item plays within a day collapse to one ×N row whose check removes the newest", async ({
  page,
}) => {
  const rows: HistoryRowFixture[] = [
    {
      id: 41,
      type: "episode",
      showId: 100,
      showTitle: "The Bear",
      season: 1,
      number: 8,
      episodeTitle: "Braciole",
      watchedAt: "2026-07-15T15:00:00.000Z",
    },
    {
      id: 42,
      type: "episode",
      showId: 100,
      showTitle: "The Bear",
      season: 1,
      number: 8,
      episodeTitle: "Braciole",
      watchedAt: "2026-07-15T09:00:00.000Z",
    },
  ];
  const controls = await installHistoryRoutes(page.context(), rows);
  await page.goto("/history");

  // One row, ×2 badge: never two identical lines for a same-day rewatch.
  const row = page.getByTestId("history-row");
  await expect(row).toHaveCount(1);
  await expect(page.getByTestId("history-plays")).toHaveText("×2");

  // The check removes exactly the NEWEST play, and says what remains.
  await row.getByTestId("mark-watched").click();
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.ids).toEqual([41]);
  await expect(page.getByTestId("snackbar")).toContainText("Removed 1 play · 1 remain");
});

test("surfaces a load-earlier failure inline and recovers on Retry", async ({ page }) => {
  await installHistoryRoutes(page.context(), recentRows());
  // Fail every second-page fetch until the test relents: a 500 is retried on its
  // own now, so only an outage that outlasts the budget reaches the screen.
  let failPageTwo = true;
  await page.context().route(/\/users\/me\/history(\/episodes|\/movies)?(\?|$)/, async (route) => {
    const isPageTwo = new URL(route.request().url()).searchParams.get("page") === "2";
    if (isPageTwo && failPageTwo) {
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    }
    return route.fallback();
  });
  await page.goto("/history");

  // The auto-scroll pull fails: the failure surfaces inline, first-page data
  // stays put, and the control becomes an explicit Retry (the observer disarms
  // so an outage can't be hammered on every scroll twitch).
  await expect(page.getByTestId("history-load-earlier-error")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("history-day-heading")).toHaveCount(1);

  failPageTwo = false;
  await page.getByTestId("history-load-earlier").click();
  await expect(page.getByTestId("history-day-heading")).toHaveCount(2);
  await expect(page.getByTestId("history-day-heading").nth(1)).toContainText("Yesterday");
  await expect(page.getByTestId("history-load-earlier-error")).toHaveCount(0);
});

test("the filter chips scope the feed by medium (URL ?type)", async ({ page }) => {
  await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");
  await expect(page.getByTestId("history-row").filter({ hasText: "The Bear" })).toHaveCount(3);

  await page.getByTestId("history-filter-movies").click();
  await expect(page).toHaveURL(/type=movies/);
  await expect(page.getByTestId("history-row").filter({ hasText: "The Bear" })).toHaveCount(0);
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();

  await page.getByTestId("history-filter-all").click();
  await expect(page).not.toHaveURL(/type=/);
  await expect(page.getByTestId("history-row").filter({ hasText: "The Bear" })).toHaveCount(3);
});

test("the month-jump sheet scopes to a year (start_at/end_at sent to Trakt)", async ({ page }) => {
  await installHistoryRoutes(page.context(), decadeRows(), 60);
  await page.goto("/history");

  // Recent feed carries every year's plays (year separators at boundaries).
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();
  await expect(page.getByTestId("history-row").filter({ hasText: "Dune" })).toBeVisible();
  await expect(page.getByTestId("history-year")).toContainText("2024");

  // Jump to all of 2024: the 2026 play drops (proof the range was sent to
  // Trakt, since the mock only filters when start_at/end_at are present).
  await page.getByTestId("history-jump").click();
  await expect(page.getByTestId("history-jump-sheet")).toBeVisible();
  await page.getByTestId("history-jump-year-2024").click();
  await page.getByTestId("history-jump-all").click();
  await expect(page).toHaveURL(/year=2024/);
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toHaveCount(0);
  await expect(page.getByTestId("history-row").filter({ hasText: "Dune" })).toBeVisible();
  await expect(page.getByTestId("history-row").filter({ hasText: "Oppenheimer" })).toBeVisible();
});

test("drills into a month within a busy year", async ({ page }) => {
  await installHistoryRoutes(page.context(), decadeRows(), 60);
  await page.goto("/history?year=2024");

  await expect(page.getByTestId("history-row").filter({ hasText: "Dune" })).toBeVisible();
  await expect(page.getByTestId("history-row").filter({ hasText: "Oppenheimer" })).toBeVisible();

  // March keeps only the March play; the June play drops out of the window.
  await page.getByTestId("history-jump").click();
  await page.getByTestId("history-jump-month-3").click();
  await expect(page).toHaveURL(/month=3/);
  await expect(page.getByTestId("history-row").filter({ hasText: "Dune" })).toBeVisible();
  await expect(page.getByTestId("history-row").filter({ hasText: "Oppenheimer" })).toHaveCount(0);
});

test("an empty year window shows a scope-aware empty state with a way back", async ({ page }) => {
  await installHistoryRoutes(page.context(), decadeRows(), 60);
  await page.goto("/history?year=2020");

  await expect(page.getByTestId("history-empty")).toContainText("Nothing watched in 2020");

  // Back to recent restores the unbounded feed.
  await page.getByTestId("history-empty-recent").click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();
});

test("the in-header title filter live-filters loaded entries", async ({ page }) => {
  await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();

  await page.getByTestId("history-search-toggle").click();
  const field = page.getByTestId("history-search-field");
  await expect(field).toBeVisible();
  await field.fill("bear");

  // Only the matching show's rows remain; day headers stay honest.
  await expect(page.getByTestId("history-row").filter({ hasText: "The Bear" })).toHaveCount(3);
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toHaveCount(0);

  // A no-match reads its own copy, and closing the field restores the feed.
  await field.fill("zzzz");
  await expect(page.getByTestId("history-filter-empty")).toBeVisible();
  await page.getByTestId("history-search-close").click();
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();
});

test("the green check removes EXACTLY one play by its history id, then restores it with Undo", async ({
  page,
}) => {
  const controls = await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");

  const movieRow = page.getByTestId("history-row").filter({ hasText: "Interstellar" });
  await expect(movieRow).toBeVisible();
  // The filled check IS the durable unmark path: one tap, optimistic, reversible.
  await movieRow.getByTestId("mark-watched").click();

  await expect(movieRow).toHaveCount(0);
  await expect(page.getByTestId("snackbar")).toContainText("Removed play");

  // The write targeted the exact history event id (14), NOT an item-scoped wipe.
  await expect.poll(() => controls.removePosts().length).toBeGreaterThan(0);
  const removal = controls.removePosts()[0];
  expect(removal?.ids).toEqual([14]);
  expect(removal?.hasMoviesSection).toBe(false);
  expect(removal?.hasEpisodesSection).toBe(false);

  // Undo re-adds it best-effort; the row reappearing is the confirmation.
  await page.getByTestId("snackbar-undo").click();
  await expect.poll(() => controls.addPosts().length).toBeGreaterThan(0);
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();
});

test("long-press offers Go-to + Remove-this-play on an entry", async ({ page }) => {
  const controls = await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");

  const movieRow = page.getByTestId("history-row").filter({ hasText: "Interstellar" });
  // Desktop context-menu = the long-press equivalent (same sheet).
  await movieRow.click({ button: "right" });
  await expect(page.getByTestId("history-menu-open")).toHaveText("Go to movie");
  await page.getByTestId("history-menu-remove").click();

  await expect(movieRow).toHaveCount(0);
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.ids).toEqual([14]);
});

test("a failed Undo re-add keeps the play removed and surfaces the honest error", async ({
  page,
}) => {
  const controls = await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");

  const movieRow = page.getByTestId("history-row").filter({ hasText: "Interstellar" });
  await movieRow.getByTestId("mark-watched").click();
  await expect(movieRow).toHaveCount(0);

  // The remove landed; the best-effort Undo re-add will hard-fail (403).
  controls.setAddMode("reject");
  await page.getByTestId("snackbar-undo").click();

  await expect.poll(() => controls.addPosts().length).toBeGreaterThan(0);
  await expect(page.getByTestId("snackbar")).toContainText("Couldn't restore that play");
  await expect(movieRow).toHaveCount(0);
});

test("Undo during an in-flight remove that then fails never re-adds a duplicate play", async ({
  page,
}) => {
  const controls = await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");

  const movieRow = page.getByTestId("history-row").filter({ hasText: "Interstellar" });
  await expect(movieRow).toBeVisible();

  // Hold the remove open so the Undo races an unsettled removal.
  controls.setRemoveMode("hold");
  await movieRow.getByTestId("mark-watched").click();
  await expect(movieRow).toHaveCount(0);
  await expect(page.getByTestId("snackbar-undo")).toBeVisible();

  // Undo BEFORE the remove settles, then let the remove hard-fail.
  await page.getByTestId("snackbar-undo").click();
  controls.releaseRemove("reject");

  // The play was never deleted, so Undo must NOT re-add it. The row returns and
  // no re-add is ever sent.
  await expect(movieRow).toBeVisible();
  expect(controls.addPosts()).toHaveLength(0);
  expect(controls.removePosts()).toHaveLength(1);
});

test("shows the recent empty state when nothing is logged", async ({ page }) => {
  await installHistoryRoutes(page.context(), []);
  await page.goto("/history");

  await expect(page.getByTestId("history-empty")).toBeVisible();
  await expect(page.getByTestId("history-empty")).toContainText("Nothing logged yet");
});
