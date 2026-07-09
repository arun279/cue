import { expect, test } from "@playwright/test";
import {
  type CalendarEpisodeFixture,
  installCalendarRoutes,
  installHermeticRoutes,
  readStored,
  seedAuth,
} from "./helpers";

// Freeze the clock so Today/Tomorrow grouping is deterministic regardless of when
// the suite runs. 2026-07-15T16:00Z = 12:00 in America/New_York (the fixed
// calendar tz), so "today" in NY is 2026-07-15.
const FIXED = new Date("2026-07-15T16:00:00.000Z");

function calItem(
  overrides: Partial<CalendarEpisodeFixture> & { traktId: number },
): CalendarEpisodeFixture {
  return {
    showId: 1,
    showTitle: "Fixture Show",
    season: 1,
    number: 1,
    title: "An Episode",
    firstAired: "2026-07-15T14:00:00.000Z",
    ...overrides,
  };
}

/** Aired-today, later-today, tomorrow, and a +10-day episode (only inside the 14-day window). */
function spreadFixture(): CalendarEpisodeFixture[] {
  return [
    calItem({
      traktId: 11,
      showId: 1,
      showTitle: "Aired Today",
      firstAired: "2026-07-15T14:00:00.000Z",
    }),
    calItem({
      traktId: 12,
      showId: 2,
      showTitle: "Later Today",
      firstAired: "2026-07-15T22:00:00.000Z",
    }),
    calItem({
      traktId: 13,
      showId: 3,
      showTitle: "Tomorrow Show",
      firstAired: "2026-07-16T15:00:00.000Z",
    }),
    calItem({
      traktId: 14,
      showId: 4,
      showTitle: "Next Week",
      firstAired: "2026-07-25T15:00:00.000Z",
    }),
  ];
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
  await page.clock.setFixedTime(FIXED);
});

test("groups episodes by localized day with Today/Tomorrow labels", async ({ page }) => {
  await installCalendarRoutes(page.context(), spreadFixture());
  await page.goto("/calendar");

  await expect(page.getByTestId("screen-calendar")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Upcoming" })).toBeVisible();

  const headings = page.getByTestId("calendar-day-heading");
  // Within the default 7-day window: Today + Tomorrow (Next Week is outside it).
  await expect(headings).toHaveCount(2);
  await expect(headings.nth(0)).toHaveText(/Today/);
  await expect(headings.nth(1)).toHaveText(/Tomorrow/);
  // Today holds both the aired and the later-today episode.
  await expect(page.getByTestId("calendar-row")).toHaveCount(3);
});

test("the sync pill shows the last-synced timestamp, not a bare 'Synced'", async ({ page }) => {
  // Regression: the shared pill rendered a bare "Synced" on Calendar (and Library)
  // while Up Next and Profile showed "Synced · <time ago>" — the same component,
  // missing the `syncedAt` prop on these two routes. Wire it through so the recency
  // read is identical everywhere.
  await installCalendarRoutes(page.context(), spreadFixture());
  await page.goto("/calendar");

  const pill = page.getByTestId("upcoming-status");
  await expect(pill).toHaveAttribute("data-state", "synced");
  await expect(pill).toContainText("Synced · ");
});

test("excludes hidden shows even though the calendar feed still lists them", async ({ page }) => {
  const items = [
    calItem({
      traktId: 11,
      showId: 1,
      showTitle: "Visible Show",
      firstAired: "2026-07-15T14:00:00.000Z",
    }),
    calItem({
      traktId: 91,
      showId: 9,
      showTitle: "Hidden Show",
      firstAired: "2026-07-15T15:00:00.000Z",
    }),
  ];
  await installCalendarRoutes(page.context(), items, [9]);
  await page.goto("/calendar");

  await expect(page.getByTestId("calendar-row")).toHaveCount(1);
  await expect(page.getByText("Visible Show")).toBeVisible();
  await expect(page.getByText("Hidden Show")).toHaveCount(0);
});

test("the widen control refetches with a larger window and reveals further-out days", async ({
  page,
}) => {
  const controls = await installCalendarRoutes(page.context(), spreadFixture());
  await page.goto("/calendar");

  await expect(page.getByTestId("calendar-day-heading")).toHaveCount(2);
  expect(controls.calendarRequests().map((r) => r.days)).toEqual([7]);

  await page.getByTestId("window-14").click();

  // Widening changes the request days and pulls in the +10-day episode as a new day group.
  await expect(page.getByText("Next Week")).toBeVisible();
  await expect(page.getByTestId("calendar-day-heading")).toHaveCount(3);
  await expect.poll(() => controls.calendarRequests().map((r) => r.days)).toEqual([7, 14]);
});

test("an aired row gets a quick mark-watched that fires POST /sync/history", async ({ page }) => {
  const controls = await installCalendarRoutes(page.context(), [
    calItem({
      traktId: 11,
      showId: 1,
      showTitle: "Aired Today",
      firstAired: "2026-07-15T14:00:00.000Z",
    }),
    calItem({
      traktId: 13,
      showId: 3,
      showTitle: "Tomorrow Show",
      firstAired: "2026-07-16T15:00:00.000Z",
    }),
  ]);
  await page.goto("/calendar");

  // Only the aired (today) row exposes the mark control; the future row shows "Airs soon".
  await expect(page.getByTestId("calendar-mark")).toHaveCount(1);
  await expect(page.getByTestId("calendar-upcoming")).toHaveCount(1);

  await page.getByTestId("calendar-mark").click();
  await expect(page.getByTestId("calendar-watched")).toBeVisible(); // optimistic

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toEqual([11]);
});

test("the quick mark offers a point-of-action Undo that removes the play", async ({ page }) => {
  const controls = await installCalendarRoutes(page.context(), [
    calItem({ traktId: 11, showId: 1, showTitle: "Aired Today" }),
  ]);
  await page.goto("/calendar");

  await page.getByTestId("calendar-mark").click();
  await expect(page.getByTestId("calendar-watched")).toBeVisible(); // optimistic

  // The calendar mark now has the same point-of-action Undo as Up Next.
  await expect(page.getByTestId("calendar-undo")).toContainText("Marked Aired Today watched");
  await page.getByTestId("calendar-undo-action").click();

  // Undo issues the compensating /sync/history/remove and restores the mark control.
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.episodeIds).toEqual([11]);
  await expect(page.getByTestId("calendar-mark")).toBeVisible();
  await expect(page.getByTestId("calendar-watched")).toHaveCount(0);
});

test("shows the empty-window state when nothing is airing", async ({ page }) => {
  await installCalendarRoutes(page.context(), []);
  await page.goto("/calendar");

  await expect(page.getByTestId("upcoming-empty")).toBeVisible();
  await expect(page.getByTestId("upcoming-empty")).toContainText("next 7 days");
});

test("a long calendar stays virtualized: bounded window, yet scrolling reaches late rows", async ({
  page,
}) => {
  // 120 episodes, one per hour from today forward — all inside the default 7-day window.
  const many: CalendarEpisodeFixture[] = Array.from({ length: 120 }, (_, i) => ({
    showId: 1000 + i,
    showTitle: `Show ${i}`,
    season: 1,
    number: 1,
    title: `Episode ${i}`,
    firstAired: new Date(FIXED.getTime() + i * 3_600_000).toISOString(),
    traktId: 5000 + i,
  }));
  await installCalendarRoutes(page.context(), many);
  await page.goto("/calendar");

  await expect(page.getByTestId("calendar-row").first()).toBeVisible();
  const initial = await page.getByTestId("virtual-row").count();
  expect(initial).toBeGreaterThan(0);
  expect(initial).toBeLessThan(40);

  // The final row (far past the initial window) is not mounted yet — proof the list
  // is truly windowed, not a hard-capped slice of the first N rows.
  const lastRow = page.getByText("Show 119", { exact: true });
  await expect(lastRow).toHaveCount(0);

  // Step the container down a viewport at a time, letting rows measure between steps
  // (a single jump-to-bottom oscillates because rows measure differently than the
  // estimate). Each step mounts the next slice until the last row swaps in.
  const list = page.getByTestId("virtual-list");
  for (let step = 0; step < 40 && !(await lastRow.isVisible()); step++) {
    await list.evaluate((el) => el.scrollBy({ top: el.clientHeight }));
    await page.waitForTimeout(60);
  }

  await expect(lastRow).toBeVisible();
  // Still bounded after scrolling — the early rows were unmounted as later ones mounted.
  expect(await page.getByTestId("virtual-row").count()).toBeLessThan(40);
});

test("the quick mark rides the durable queue: the op persists before the write settles", async ({
  page,
}) => {
  const controls = await installCalendarRoutes(page.context(), [
    calItem({ traktId: 11, showId: 1, showTitle: "Aired Today" }),
  ]);
  controls.setWriteMode("delay"); // hold the POST open so the op stays durable in the log
  await page.goto("/calendar");

  await page.getByTestId("calendar-mark").click();
  await expect(page.getByTestId("calendar-watched")).toBeVisible(); // optimistic

  // The mark is a durable-queue write, not a fire-and-forget fetch: it is persisted
  // with a frozen watched_at before the in-flight POST resolves.
  await expect
    .poll(async () => {
      const raw = await readStored(page, "cue.write-queue");
      return (JSON.parse(raw ?? "[]") as unknown[]).length;
    })
    .toBe(1);
  const log = JSON.parse((await readStored(page, "cue.write-queue")) ?? "[]") as {
    request: { path: string; body: { episodes: { ids: { trakt: number }; watched_at: string }[] } };
  }[];
  expect(log[0]?.request.path).toBe("/sync/history");
  expect(log[0]?.request.body.episodes[0]?.ids.trakt).toBe(11);
  expect(log[0]?.request.body.episodes[0]?.watched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("a rate-limited mark honors Retry-After and still lands watched", async ({ page }) => {
  const controls = await installCalendarRoutes(page.context(), [
    calItem({ traktId: 11, showId: 1, showTitle: "Aired Today" }),
  ]);
  controls.setWriteMode("rate-limit-once");
  await page.goto("/calendar");

  await page.getByTestId("calendar-mark").click();
  await expect(page.getByTestId("calendar-watched")).toBeVisible(); // optimistic, before the retry

  // The queue paces past the 429 (Retry-After), retries once, and the mark stays watched.
  await expect.poll(() => controls.historyPosts().length, { timeout: 6000 }).toBe(2);
  await expect(page.getByTestId("calendar-watched")).toBeVisible();
});

test("a hard-rejected mark rolls the row back and surfaces a recoverable error", async ({
  page,
}) => {
  const controls = await installCalendarRoutes(page.context(), [
    calItem({ traktId: 11, showId: 1, showTitle: "Aired Today" }),
  ]);
  controls.setWriteMode("reject"); // definitive 403 → the durable queue reports a hard failure
  await page.goto("/calendar");

  await page.getByTestId("calendar-mark").click();

  // The optimistic Watched badge reverts to the mark control and a dismissible error shows.
  await expect(page.getByTestId("calendar-mark-error")).toBeVisible();
  await expect(page.getByTestId("calendar-mark")).toBeVisible();
  await expect(page.getByTestId("calendar-watched")).toHaveCount(0);
  expect(controls.historyPosts().length).toBe(1);
});
