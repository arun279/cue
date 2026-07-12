import { expect, test } from "@playwright/test";
import {
  type CalendarEpisodeFixture,
  installCalendarRoutes,
  installHermeticRoutes,
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

/** Aired-today, later-today, tomorrow, and a +10-day episode (inside the ~4-week agenda). */
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

test("one ~4-week agenda request; day groups carry Today/Tomorrow labels; no range toggle", async ({
  page,
}) => {
  const controls = await installCalendarRoutes(page.context(), spreadFixture());
  await page.goto("/calendar");

  await expect(page.getByTestId("screen-calendar")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();

  const headings = page.getByTestId("calendar-day-heading");
  // Today, Tomorrow, and the +10-day group: all inside the single 28-day agenda.
  await expect(headings).toHaveCount(3);
  await expect(headings.nth(0)).toContainText("Today");
  await expect(headings.nth(1)).toContainText("Tomorrow");
  await expect(page.getByTestId("calendar-row")).toHaveCount(4);

  // ONE window request, ~4 weeks deep: the 7/14 range toggle is dead (a toggle
  // is a setting pretending to be a feature).
  expect(controls.calendarRequests().map((r) => r.days)).toEqual([28]);
  await expect(page.getByTestId("window-7")).toHaveCount(0);
  await expect(page.getByTestId("window-14")).toHaveCount(0);
});

test("aired rows read 'Aired' and NOTHING on this screen is markable", async ({ page }) => {
  await installCalendarRoutes(page.context(), spreadFixture());
  await page.goto("/calendar");

  // Today's already-aired episode reads its air time: no check, no quick mark.
  const aired = page.getByTestId("calendar-row").filter({ hasText: "Aired Today" });
  await expect(aired).toContainText("Aired 10:00 AM");
  // One home per action: aired-unwatched episodes are marked from Up Next.
  await expect(page.getByTestId("screen-calendar").getByTestId("mark-watched")).toHaveCount(0);
  await expect(page.getByTestId("calendar-mark")).toHaveCount(0);

  // Future rows carry countdown chips: today's time, tomorrow's day count.
  const tomorrow = page.getByTestId("calendar-row").filter({ hasText: "Tomorrow Show" });
  await expect(tomorrow.getByTestId("calendar-countdown")).toHaveText("1d");
  const later = page.getByTestId("calendar-row").filter({ hasText: "Later Today" });
  await expect(later.getByTestId("calendar-countdown")).toHaveText("6:00 PM");
});

test("a row links to the show detail, never an episode surface", async ({ page }) => {
  await installCalendarRoutes(page.context(), spreadFixture());
  await page.goto("/calendar");

  await page.getByTestId("calendar-row").filter({ hasText: "Tomorrow Show" }).click();
  await expect(page).toHaveURL(/\/show\/3$/);
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

test("shows the between-seasons empty state when nothing is airing", async ({ page }) => {
  await installCalendarRoutes(page.context(), []);
  await page.goto("/calendar");

  await expect(page.getByTestId("upcoming-empty")).toBeVisible();
  await expect(page.getByTestId("upcoming-empty")).toContainText("No upcoming episodes");
  await expect(page.getByTestId("upcoming-empty")).toContainText("between seasons");
});

test("a long agenda stays virtualized: bounded window, yet scrolling reaches late rows", async ({
  page,
}) => {
  // 120 episodes, one per hour from today forward: all inside the 28-day agenda.
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
  expect(initial).toBeLessThan(60);

  // The final row (far past the initial window) is not mounted yet: proof the
  // list is truly windowed, not a hard-capped slice of the first N rows.
  const lastRow = page.getByText("Show 119", { exact: true });
  await expect(lastRow).toHaveCount(0);

  // Step the window down a viewport at a time, letting rows measure between
  // steps, until the last row swaps in.
  for (let step = 0; step < 60 && !(await lastRow.isVisible()); step++) {
    await page.evaluate(() => window.scrollBy({ top: window.innerHeight }));
    await page.waitForTimeout(60);
  }

  await expect(lastRow).toBeVisible();
  // Still bounded after scrolling: early rows unmounted as later ones mounted.
  expect(await page.getByTestId("virtual-row").count()).toBeLessThan(60);
});

test("a calendar outage without cache shows the retry state, and recovery fills the agenda", async ({
  page,
}) => {
  await installCalendarRoutes(page.context(), spreadFixture());
  // First read fails hard; the screen must offer Retry rather than a blank.
  let failed = false;
  await page.context().route("**/api.trakt.tv/calendars/my/shows/*/*", (route) => {
    if (!failed) {
      failed = true;
      return route.abort();
    }
    return route.fallback();
  });
  await page.goto("/calendar");

  await expect(page.getByTestId("upcoming-error")).toBeVisible();
  await page.getByTestId("upcoming-error-retry").click();
  await expect(page.getByTestId("calendar-row")).toHaveCount(4);
});
