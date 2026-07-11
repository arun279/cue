import { expect, test } from "@playwright/test";
import {
  type HistoryRowFixture,
  installHermeticRoutes,
  installHistoryRoutes,
  seedAuth,
} from "./helpers";

// Freeze the clock so day grouping (Today / Yesterday) AND the Year picker's
// "current year" are deterministic. 2026-07-15T16:00Z = 12:00 in America/New_York
// (the pinned Playwright timezone), so "today" is 2026-07-15 and the year is 2026.
const FIXED = new Date("2026-07-15T16:00:00.000Z");

/** A day of plays: a 3-episode The Bear binge (collapses to one card) + a movie on
 * "today", plus one Severance episode "yesterday" (a second page at pageSize 4). */
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

/** Plays spread across years and months, for the decade-jump (Year → Month) tests. */
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

/** Forty movie plays on distinct days: enough that a non-virtualized list would
 * mount every row, so a windowed count proves virtualization. */
function manyRows(): HistoryRowFixture[] {
  const rows: HistoryRowFixture[] = [];
  const base = Date.parse("2026-06-30T18:00:00.000Z");
  for (let i = 0; i < 40; i += 1) {
    const n = i + 1;
    rows.push({
      id: 500 + n,
      type: "movie",
      movieId: 500 + n,
      movieTitle: `Archive Film ${String(n).padStart(2, "0")}`,
      year: 2000 + n,
      watchedAt: new Date(base - i * 86_400_000).toISOString(),
    });
  }
  return rows;
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
  await page.clock.setFixedTime(FIXED);
});

test("loads, groups by local day, collapses a same-show binge, and loads earlier", async ({
  page,
}) => {
  await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");

  await expect(page.getByTestId("screen-history")).toBeVisible();

  // Today's header carries the play-count rollup; the binge folds into ONE card.
  const days = page.getByTestId("history-day-heading");
  await expect(days.first()).toContainText("Today");
  await expect(page.getByTestId("history-day-count").first()).toContainText("3 episodes");
  await expect(page.getByTestId("history-day-count").first()).toContainText("1 movie");

  const cluster = page.getByTestId("history-cluster");
  await expect(cluster).toHaveCount(1);
  await expect(cluster).toContainText("The Bear");
  await expect(cluster).toContainText("3 episodes");
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();

  // Yesterday is a second page: "Load earlier" pulls it in.
  await expect(page.getByTestId("history-day-heading")).toHaveCount(1);
  await page.getByTestId("history-load-earlier").click();
  await expect(page.getByTestId("history-day-heading")).toHaveCount(2);
  await expect(page.getByTestId("history-day-heading").nth(1)).toContainText("Yesterday");
  await expect(page.getByTestId("history-row").filter({ hasText: "Severance" })).toBeVisible();
});

test("surfaces a Load-earlier failure inline and recovers on Retry", async ({ page }) => {
  await installHistoryRoutes(page.context(), recentRows());
  // Fail the FIRST second-page fetch, then let later ones through.
  let failedPageTwo = false;
  await page.context().route(/\/users\/me\/history(\/episodes|\/movies)?(\?|$)/, async (route) => {
    const isPageTwo = new URL(route.request().url()).searchParams.get("page") === "2";
    if (isPageTwo && !failedPageTwo) {
      failedPageTwo = true;
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    }
    return route.fallback();
  });
  await page.goto("/history");

  await expect(page.getByTestId("history-day-heading")).toHaveCount(1);
  await page.getByTestId("history-load-earlier").click();

  // The failure surfaces inline, first-page data stays put, and the control
  // becomes a Retry rather than silently swallowing the error.
  await expect(page.getByTestId("history-load-earlier-error")).toBeVisible();
  await expect(page.getByTestId("history-load-earlier")).toContainText("Retry");
  await expect(page.getByTestId("history-day-heading")).toHaveCount(1);

  await page.getByTestId("history-load-earlier").click();
  await expect(page.getByTestId("history-day-heading")).toHaveCount(2);
  await expect(page.getByTestId("history-day-heading").nth(1)).toContainText("Yesterday");
  await expect(page.getByTestId("history-load-earlier-error")).toHaveCount(0);
});

test("the type filter scopes the feed to movies only", async ({ page }) => {
  await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");
  await expect(page.getByTestId("history-cluster")).toHaveCount(1);

  await page.getByTestId("history-filter-movies").click();
  await expect(page).toHaveURL(/type=movies/);
  await expect(page.getByTestId("history-cluster")).toHaveCount(0);
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();
  await expect(page.getByTestId("history-row")).toHaveCount(1);
});

test("jumps to a year: the read is scoped by start_at/end_at, out-of-year plays drop", async ({
  page,
}) => {
  await installHistoryRoutes(page.context(), decadeRows(), 60);
  await page.goto("/history");

  // Recent feed carries every year's plays.
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();
  await expect(page.getByTestId("history-row").filter({ hasText: "Dune" })).toBeVisible();

  // Jump to 2024: the 2026 play drops (proof the range was sent to Trakt, since the
  // mock only filters when start_at/end_at are present).
  await page.getByTestId("history-year").selectOption("2024");
  await expect(page).toHaveURL(/year=2024/);
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toHaveCount(0);
  await expect(page.getByTestId("history-row").filter({ hasText: "Dune" })).toBeVisible();
  await expect(page.getByTestId("history-row").filter({ hasText: "Oppenheimer" })).toBeVisible();

  // A year scope reveals the Month drill.
  await expect(page.getByTestId("history-month")).toBeVisible();
});

test("drills into a month within a busy year", async ({ page }) => {
  await installHistoryRoutes(page.context(), decadeRows(), 60);
  await page.goto("/history?year=2024");

  await expect(page.getByTestId("history-row").filter({ hasText: "Dune" })).toBeVisible();
  await expect(page.getByTestId("history-row").filter({ hasText: "Oppenheimer" })).toBeVisible();

  // March keeps only the March play; the June play drops out of the window.
  await page.getByTestId("history-month").selectOption("3");
  await expect(page).toHaveURL(/month=3/);
  await expect(page.getByTestId("history-row").filter({ hasText: "Dune" })).toBeVisible();
  await expect(page.getByTestId("history-row").filter({ hasText: "Oppenheimer" })).toHaveCount(0);
});

test("an empty year/month window shows a scope-aware empty state with a way back", async ({
  page,
}) => {
  await installHistoryRoutes(page.context(), decadeRows(), 60);
  await page.goto("/history?year=2020");

  await expect(page.getByTestId("history-empty")).toContainText("Nothing watched in 2020");

  // Back to recent restores the unbounded feed.
  await page.getByTestId("history-empty-recent").click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();
});

test("virtualizes: only a window of rows is mounted, and scrolling reaches the oldest", async ({
  page,
}) => {
  await installHistoryRoutes(page.context(), manyRows(), 60);
  await page.goto("/history");

  await expect(page.getByTestId("screen-history")).toBeVisible();
  await expect(page.getByTestId("history-row").first()).toBeVisible();

  // 40 plays on distinct days = 80 flattened rows; a windowed list mounts far fewer,
  // and the oldest play is absent from the DOM until scrolled to.
  const mounted = await page.getByTestId("virtual-row").count();
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(60);
  await expect(page.getByTestId("history-row").filter({ hasText: "Archive Film 40" })).toHaveCount(
    0,
  );

  await page.getByTestId("virtual-list").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(
    page.getByTestId("history-row").filter({ hasText: "Archive Film 40" }),
  ).toBeVisible();
});

test("removes EXACTLY one play by its history id, then restores it with Undo", async ({ page }) => {
  const controls = await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");

  const movieRow = page.getByTestId("history-row").filter({ hasText: "Interstellar" });
  await expect(movieRow).toBeVisible();
  // Destructive-by-intent: the row's ⋯ opens a confirm sheet; the removal only
  // fires on the sheet's "Remove this play".
  await movieRow.getByTestId("history-remove-menu").click();
  await page.getByTestId("history-remove").click();

  // Optimistically gone + honest confirmation.
  await expect(movieRow).toHaveCount(0);
  await expect(page.getByTestId("history-undo")).toContainText("Removed from history");

  // The write targeted the exact history event id (14), NOT an item-scoped wipe.
  await expect.poll(() => controls.removePosts().length).toBeGreaterThan(0);
  const removal = controls.removePosts()[0];
  expect(removal?.ids).toEqual([14]);
  expect(removal?.hasMoviesSection).toBe(false);
  expect(removal?.hasEpisodesSection).toBe(false);

  // Undo re-adds it best-effort and says so.
  await page.getByTestId("history-undo-action").click();
  await expect(page.getByTestId("history-restored")).toContainText("Restored to history");
  await expect.poll(() => controls.addPosts().length).toBeGreaterThan(0);
  await expect(page.getByTestId("history-row").filter({ hasText: "Interstellar" })).toBeVisible();
});

test("the confirm sheet names the exact play and Cancel removes nothing", async ({ page }) => {
  const controls = await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");

  const movieRow = page.getByTestId("history-row").filter({ hasText: "Interstellar" });
  await movieRow.getByTestId("history-remove-menu").click();

  // The sheet names the exact play (title + its release year) before any removal.
  const sheet = page.getByTestId("history-remove-sheet");
  await expect(sheet).toContainText("Interstellar");
  await expect(sheet).toContainText("2014");

  // Cancel dismisses without touching history: no write, row still present.
  await page.getByTestId("history-remove-cancel").click();
  await expect(sheet).toHaveCount(0);
  await expect(movieRow).toBeVisible();
  expect(controls.removePosts()).toHaveLength(0);
});

test("a failed Undo re-add keeps the play removed and never falsely claims Restored", async ({
  page,
}) => {
  const controls = await installHistoryRoutes(page.context(), recentRows());
  await page.goto("/history");

  const movieRow = page.getByTestId("history-row").filter({ hasText: "Interstellar" });
  await expect(movieRow).toBeVisible();
  // Destructive-by-intent: the row's ⋯ opens a confirm sheet; the removal only
  // fires on the sheet's "Remove this play".
  await movieRow.getByTestId("history-remove-menu").click();
  await page.getByTestId("history-remove").click();
  await expect(movieRow).toHaveCount(0);
  await expect(page.getByTestId("history-undo")).toContainText("Removed from history");

  // The remove landed; the best-effort Undo re-add will hard-fail (403).
  controls.setAddMode("reject");
  await page.getByTestId("history-undo-action").click();

  await expect.poll(() => controls.addPosts().length).toBeGreaterThan(0);
  await expect(page.getByTestId("history-remove-error")).toContainText(
    "Couldn't restore that play",
  );
  await expect(page.getByTestId("history-restored")).toHaveCount(0);
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
  // Destructive-by-intent: the row's ⋯ opens a confirm sheet; the removal only
  // fires on the sheet's "Remove this play".
  await movieRow.getByTestId("history-remove-menu").click();
  await page.getByTestId("history-remove").click();
  await expect(movieRow).toHaveCount(0);
  await expect(page.getByTestId("history-undo")).toBeVisible();

  // Undo BEFORE the remove settles, then let the remove hard-fail.
  await page.getByTestId("history-undo-action").click();
  controls.releaseRemove("reject");

  // The play was never deleted, so Undo must NOT re-add it. The row returns, no
  // "Restored" lie, and no re-add is ever sent.
  await expect(movieRow).toBeVisible();
  await expect(page.getByTestId("history-remove-error")).toContainText("Couldn't remove that play");
  await expect(page.getByTestId("history-restored")).toHaveCount(0);
  expect(controls.addPosts()).toHaveLength(0);
  expect(controls.removePosts()).toHaveLength(1);
});

test("shows the recent empty state when nothing is logged", async ({ page }) => {
  await installHistoryRoutes(page.context(), []);
  await page.goto("/history");

  await expect(page.getByTestId("history-empty")).toBeVisible();
  await expect(page.getByTestId("history-empty")).toContainText("Nothing logged yet");
});
