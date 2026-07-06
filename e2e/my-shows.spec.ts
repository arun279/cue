import { expect, test } from "@playwright/test";
import {
  type EpisodeFixture,
  installHermeticRoutes,
  installLibraryRoutes,
  type ShowFixture,
  seedAuth,
} from "./helpers";

const AIRED = "2026-01-01T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";

function ep(season: number, number: number, firstAired: string, traktId: number): EpisodeFixture {
  return { season, number, title: `Episode ${number}`, firstAired, traktId };
}

/** One show per aired-based bucket, plus a hidden (Stopped) show. */
function oneOfEachBucket(): ShowFixture[] {
  return [
    {
      trakt: 1,
      title: "Watch Me",
      status: "returning series",
      lastWatchedAt: "2026-06-05T00:00:00.000Z",
      aired: 10,
      completed: 5,
      episodes: Array.from({ length: 10 }, (_, i) => ep(1, i + 1, AIRED, 100 + i)),
    },
    {
      trakt: 2,
      title: "Soon Show",
      status: "returning series",
      lastWatchedAt: "2026-06-04T00:00:00.000Z",
      aired: 2,
      completed: 2,
      episodes: [ep(1, 1, AIRED, 201), ep(1, 2, AIRED, 202), ep(2, 1, FUTURE, 203)],
    },
    {
      trakt: 3,
      title: "Current Show",
      status: "returning series",
      lastWatchedAt: "2026-06-03T00:00:00.000Z",
      aired: 2,
      completed: 2,
      episodes: [ep(1, 1, AIRED, 301), ep(1, 2, AIRED, 302)],
    },
    {
      trakt: 4,
      title: "Done Show",
      status: "ended",
      lastWatchedAt: "2026-06-02T00:00:00.000Z",
      aired: 2,
      completed: 2,
      episodes: [ep(1, 1, AIRED, 401), ep(1, 2, AIRED, 402)],
    },
    {
      trakt: 5,
      title: "Stopped Show",
      status: "returning series",
      hidden: true,
      lastWatchedAt: "2026-06-01T00:00:00.000Z",
      aired: 3,
      completed: 1,
      episodes: [ep(1, 1, AIRED, 501), ep(1, 2, AIRED, 502), ep(1, 3, AIRED, 503)],
    },
  ];
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("groups the library into aired-based buckets in canonical order", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 2200 });
  await installLibraryRoutes(page.context(), oneOfEachBucket());
  await page.goto("/my-shows");

  const headings = page.getByTestId("bucket-heading");
  await expect(headings).toHaveCount(5);
  await expect(headings.nth(0)).toHaveAttribute("data-status", "watching");
  await expect(headings.nth(1)).toHaveAttribute("data-status", "up-to-date");
  await expect(headings.nth(2)).toHaveAttribute("data-status", "coming-soon");
  await expect(headings.nth(3)).toHaveAttribute("data-status", "ended");
  await expect(headings.nth(4)).toHaveAttribute("data-status", "stopped");

  await expect(page.getByRole("heading", { name: "Watch Me" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Watch Me" }).locator("..").getByTestId("library-progress"),
  ).toContainText("5/10");
});

test("a hidden show appears only in the Stopped bucket", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 2200 });
  await installLibraryRoutes(page.context(), oneOfEachBucket());
  await page.goto("/my-shows");

  const stoppedCard = page.getByTestId("library-card").filter({ hasText: "Stopped Show" });
  await expect(stoppedCard).toHaveCount(1);
  await expect(page.getByTestId("bucket-heading").filter({ hasText: "Stopped" })).toBeVisible();

  // The hidden show carries show-id 5 and must appear exactly once across every bucket.
  await expect(page.locator('[data-testid="library-card"][data-show-id="5"]')).toHaveCount(1);
});

test("the sort control reorders shows within a bucket", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installLibraryRoutes(page.context(), [
    {
      trakt: 1,
      title: "Zebra",
      status: "returning series",
      lastWatchedAt: "2026-06-10T00:00:00.000Z",
      aired: 5,
      completed: 2,
      episodes: Array.from({ length: 5 }, (_, i) => ep(1, i + 1, AIRED, 10 + i)),
    },
    {
      trakt: 2,
      title: "Mango",
      status: "returning series",
      lastWatchedAt: "2026-06-05T00:00:00.000Z",
      aired: 5,
      completed: 2,
      episodes: Array.from({ length: 5 }, (_, i) => ep(1, i + 1, AIRED, 20 + i)),
    },
    {
      trakt: 3,
      title: "Alpha",
      status: "returning series",
      lastWatchedAt: "2026-06-01T00:00:00.000Z",
      aired: 5,
      completed: 2,
      episodes: Array.from({ length: 5 }, (_, i) => ep(1, i + 1, AIRED, 30 + i)),
    },
  ]);
  await page.goto("/my-shows");

  // Default recently-watched → Zebra (newest) leads.
  await expect(page.getByTestId("library-card").first()).toContainText("Zebra");

  await page.getByTestId("sort-select").selectOption("alphabetical");
  await expect(page.getByTestId("library-card").first()).toContainText("Alpha");
});

test("the Shows/Movies toggle switches library type", async ({ page }) => {
  await installLibraryRoutes(page.context(), oneOfEachBucket());
  await page.goto("/my-shows");

  await expect(page.getByTestId("library-card").first()).toBeVisible();
  await page.getByTestId("type-movies").click();
  // No movie routes installed here, so the movie library resolves empty.
  await expect(page.getByTestId("movies-empty")).toBeVisible();
  await expect(page.getByTestId("library-card")).toHaveCount(0);

  await page.getByTestId("type-shows").click();
  await expect(page.getByTestId("movies-empty")).toHaveCount(0);
  await expect(page.getByTestId("library-card").first()).toBeVisible();
});

test("a large library stays virtualized: DOM row count stays bounded", async ({ page }) => {
  const many: ShowFixture[] = Array.from({ length: 200 }, (_, i) => ({
    trakt: 1000 + i,
    title: `Show ${i}`,
    status: "returning series",
    lastWatchedAt: `2026-06-${String((i % 27) + 1).padStart(2, "0")}T00:00:00.000Z`,
    aired: 10,
    completed: 4,
    episodes: Array.from({ length: 10 }, (_, e) => ep(1, e + 1, AIRED, (1000 + i) * 100 + e)),
  }));
  await installLibraryRoutes(page.context(), many);
  await page.goto("/my-shows");

  await expect(page.getByTestId("library-card").first()).toBeVisible();
  // 200 shows + 1 header = 201 rows, but only the visible window (+overscan) is in the DOM.
  const rendered = await page.getByTestId("virtual-row").count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(40);
});

test("shows a whole-library empty state when nothing is tracked", async ({ page }) => {
  await installLibraryRoutes(page.context(), []);
  await page.goto("/my-shows");
  await expect(page.getByTestId("my-shows-empty")).toBeVisible();
});
