import { expect, test } from "@playwright/test";
import {
  type HistoryRowFixture,
  installHermeticRoutes,
  installHistoryRoutes,
  seedAuth,
} from "./helpers";

const ZERO_STATS = JSON.stringify({
  movies: { plays: 0, watched: 0, minutes: 0 },
  shows: { watched: 0 },
  episodes: { plays: 0, watched: 0, minutes: 0 },
});

// Freeze the clock so the Diary's Today/Yesterday day grouping is deterministic.
// 2026-07-15T16:00Z = 12:00 in America/New_York (the pinned Playwright timezone),
// so "today" is 2026-07-15.
const FIXED = new Date("2026-07-15T16:00:00.000Z");

/** A day of plays: a 3-episode The Bear binge (collapses to one card) + a movie
 * on "today", plus one Severance episode "yesterday" (a second page at pageSize 4). */
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

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
  await page.clock.setFixedTime(FIXED);
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

test("links into Settings & connections and Back returns to Profile", async ({ page }) => {
  await page.goto("/profile");
  await page.getByTestId("link-settings").click();
  await expect(page.getByTestId("screen-settings")).toBeVisible();

  await page.getByTestId("settings-back").click();
  await expect(page.getByTestId("screen-profile")).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);
});

test("the Diary replaces the Continue-watching rail as the Profile body", async ({ page }) => {
  await installHistoryRoutes(page.context(), historyRows());
  await page.goto("/profile");

  // The redundant Continue rail is gone; the reverse-chronological Diary is the body.
  await expect(page.getByTestId("profile-diary")).toBeVisible();
  await expect(page.getByTestId("profile-continue")).toHaveCount(0);
});

test("groups the Diary by local day, collapses a same-show binge, and loads earlier", async ({
  page,
}) => {
  await installHistoryRoutes(page.context(), historyRows());
  await page.goto("/profile");

  // Today's header carries the play-count rollup; the binge folds into ONE card.
  const days = page.getByTestId("diary-day-heading");
  await expect(days.first()).toContainText("Today");
  await expect(page.getByTestId("diary-day-count").first()).toContainText("3 episodes");
  await expect(page.getByTestId("diary-day-count").first()).toContainText("1 movie");

  const cluster = page.getByTestId("diary-cluster");
  await expect(cluster).toHaveCount(1);
  await expect(cluster).toContainText("The Bear");
  await expect(cluster).toContainText("3 episodes");
  await expect(page.getByTestId("diary-row").filter({ hasText: "Interstellar" })).toBeVisible();

  // Yesterday is a second page — "Load earlier" pulls it in.
  await expect(page.getByTestId("diary-day-heading")).toHaveCount(1);
  await page.getByTestId("diary-load-earlier").click();
  await expect(page.getByTestId("diary-day-heading")).toHaveCount(2);
  await expect(page.getByTestId("diary-day-heading").nth(1)).toContainText("Yesterday");
  await expect(page.getByTestId("diary-row").filter({ hasText: "Severance" })).toBeVisible();
});

test("surfaces a Load-earlier failure inline and recovers on Retry", async ({ page }) => {
  await installHistoryRoutes(page.context(), historyRows());
  // Fail the FIRST second-page fetch, then let later ones through. Retries are off,
  // so one failure surfaces immediately; the Retry click is a fresh request.
  let failedPageTwo = false;
  await page.context().route(/\/users\/me\/history(\/episodes|\/movies)?(\?|$)/, async (route) => {
    const isPageTwo = new URL(route.request().url()).searchParams.get("page") === "2";
    if (isPageTwo && !failedPageTwo) {
      failedPageTwo = true;
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    }
    return route.fallback();
  });
  await page.goto("/profile");

  // First page painted (Today only); the second page's fetch fails.
  await expect(page.getByTestId("diary-day-heading")).toHaveCount(1);
  await page.getByTestId("diary-load-earlier").click();

  // The failure is surfaced inline — first-page data stays put — and the control
  // becomes a Retry rather than silently swallowing the error.
  await expect(page.getByTestId("diary-load-earlier-error")).toBeVisible();
  await expect(page.getByTestId("diary-load-earlier")).toContainText("Retry");
  await expect(page.getByTestId("diary-day-heading")).toHaveCount(1);

  // Retry pulls the second page in and clears the inline error.
  await page.getByTestId("diary-load-earlier").click();
  await expect(page.getByTestId("diary-day-heading")).toHaveCount(2);
  await expect(page.getByTestId("diary-day-heading").nth(1)).toContainText("Yesterday");
  await expect(page.getByTestId("diary-load-earlier-error")).toHaveCount(0);
});

test("the type filter scopes the feed to movies only", async ({ page }) => {
  await installHistoryRoutes(page.context(), historyRows());
  await page.goto("/profile");
  await expect(page.getByTestId("diary-cluster")).toHaveCount(1);

  await page.getByTestId("diary-filter-movies").click();
  await expect(page.getByTestId("diary-cluster")).toHaveCount(0);
  await expect(page.getByTestId("diary-row").filter({ hasText: "Interstellar" })).toBeVisible();
  await expect(page.getByTestId("diary-row")).toHaveCount(1);
});

test("removes EXACTLY one play by its history id, then restores it with Undo", async ({ page }) => {
  const controls = await installHistoryRoutes(page.context(), historyRows());
  await page.goto("/profile");

  const movieRow = page.getByTestId("diary-row").filter({ hasText: "Interstellar" });
  await expect(movieRow).toBeVisible();
  await movieRow.getByTestId("diary-remove").click();

  // Optimistically gone + honest confirmation.
  await expect(movieRow).toHaveCount(0);
  await expect(page.getByTestId("diary-undo")).toContainText("Removed from history");

  // The write targeted the exact history event id (14), NOT an item-scoped wipe.
  await expect.poll(() => controls.removePosts().length).toBeGreaterThan(0);
  const removal = controls.removePosts()[0];
  expect(removal?.ids).toEqual([14]);
  expect(removal?.hasMoviesSection).toBe(false);
  expect(removal?.hasEpisodesSection).toBe(false);

  // Undo re-adds it best-effort and says so.
  await page.getByTestId("diary-undo-action").click();
  await expect(page.getByTestId("diary-restored")).toContainText("Restored to history");
  await expect.poll(() => controls.addPosts().length).toBeGreaterThan(0);
  await expect(page.getByTestId("diary-row").filter({ hasText: "Interstellar" })).toBeVisible();
});

test("a failed Undo re-add keeps the play removed and never falsely claims Restored", async ({
  page,
}) => {
  const controls = await installHistoryRoutes(page.context(), historyRows());
  await page.goto("/profile");

  const movieRow = page.getByTestId("diary-row").filter({ hasText: "Interstellar" });
  await expect(movieRow).toBeVisible();
  await movieRow.getByTestId("diary-remove").click();
  await expect(movieRow).toHaveCount(0);
  await expect(page.getByTestId("diary-undo")).toContainText("Removed from history");

  // The remove landed; the best-effort Undo re-add will hard-fail (403).
  controls.setAddMode("reject");
  await page.getByTestId("diary-undo-action").click();

  // The re-add fired but failed: NO false "Restored to history", an honest error,
  // and the play stays removed (never a phantom row that vanishes on next refetch).
  await expect.poll(() => controls.addPosts().length).toBeGreaterThan(0);
  await expect(page.getByTestId("diary-remove-error")).toContainText("Couldn't restore that play");
  await expect(page.getByTestId("diary-restored")).toHaveCount(0);
  await expect(movieRow).toHaveCount(0);
});

test("Undo during an in-flight remove that then fails never re-adds a duplicate play", async ({
  page,
}) => {
  const controls = await installHistoryRoutes(page.context(), historyRows());
  await page.goto("/profile");

  const movieRow = page.getByTestId("diary-row").filter({ hasText: "Interstellar" });
  await expect(movieRow).toBeVisible();

  // Hold the remove open so the Undo races an unsettled removal.
  controls.setRemoveMode("hold");
  await movieRow.getByTestId("diary-remove").click();
  await expect(movieRow).toHaveCount(0);
  await expect(page.getByTestId("diary-undo")).toBeVisible();

  // Undo BEFORE the remove settles, then let the remove hard-fail.
  await page.getByTestId("diary-undo-action").click();
  controls.releaseRemove("reject");

  // The play was never deleted, so Undo must NOT re-add it — a re-add on top of a
  // still-present play is exactly the history duplication the user is fanatical
  // about. The row returns, no "Restored" lie, and no re-add is ever sent.
  await expect(movieRow).toBeVisible();
  await expect(page.getByTestId("diary-remove-error")).toContainText("Couldn't remove that play");
  await expect(page.getByTestId("diary-restored")).toHaveCount(0);
  expect(controls.addPosts()).toHaveLength(0);
  expect(controls.removePosts()).toHaveLength(1);
});

test("shows the Diary empty state when nothing is logged", async ({ page }) => {
  await installHistoryRoutes(page.context(), []);
  await page.goto("/profile");

  await expect(page.getByTestId("diary-empty")).toBeVisible();
  await expect(page.getByTestId("diary-empty")).toContainText("Nothing logged yet");
});
