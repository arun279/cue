import { expect, test } from "@playwright/test";
import {
  agoIso,
  type EpisodeFixture,
  installHermeticRoutes,
  installLibraryRoutes,
  type ShowFixture,
  seedAuth,
} from "./helpers";

const AIRED = "2026-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

function ep(season: number, number: number, firstAired: string, traktId: number): EpisodeFixture {
  return { season, number, title: `Episode ${number}`, firstAired, traktId };
}

/** One show per Library status chip. A caught-up mid-run show still counts as
 * Watching (the chip set has no separate caught-up home); the idle "Lapsed
 * Show" folds into Watching too. */
function oneOfEachChip(): ShowFixture[] {
  return [
    {
      trakt: 1,
      title: "Watch Me",
      status: "returning series",
      lastWatchedAt: agoIso(2),
      aired: 10,
      completed: 5,
      episodes: Array.from({ length: 10 }, (_, i) => ep(1, i + 1, AIRED, 100 + i)),
    },
    {
      trakt: 2,
      title: "Lapsed Show",
      status: "returning series",
      lastWatchedAt: agoIso(40),
      aired: 10,
      completed: 5,
      episodes: Array.from({ length: 10 }, (_, i) => ep(1, i + 1, AIRED, 200 + i)),
    },
    {
      trakt: 3,
      title: "Fresh Pick",
      status: "returning series",
      inWatchlist: true,
      lastWatchedAt: null,
      aired: 0,
      completed: 0,
      episodes: [ep(1, 1, AIRED, 301)],
    },
    {
      trakt: 4,
      title: "Caught Up Show",
      status: "returning series",
      lastWatchedAt: agoIso(3),
      aired: 2,
      completed: 2,
      episodes: [ep(1, 1, AIRED, 401), ep(1, 2, AIRED, 402), ep(2, 1, FUTURE, 403)],
    },
    {
      trakt: 5,
      title: "Done Show",
      status: "ended",
      lastWatchedAt: agoIso(4),
      aired: 2,
      completed: 2,
      episodes: [ep(1, 1, AIRED, 501), ep(1, 2, AIRED, 502)],
    },
    {
      trakt: 6,
      title: "Abandoned Show",
      status: "returning series",
      hidden: true,
      lastWatchedAt: agoIso(1),
      aired: 3,
      completed: 1,
      episodes: [ep(1, 1, AIRED, 601), ep(1, 2, AIRED, 602), ep(1, 3, AIRED, 603)],
    },
  ];
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("renders the status chips with counts; Watching is default-active with its grid", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), oneOfEachChip());
  await page.goto("/library");

  // Chips with always-visible counts: Watching absorbs lapsed + caught-up (3),
  // the rest hold one each.
  const watching = page.getByTestId("chip-watching");
  await expect(watching).toContainText("Watching");
  await expect(watching).toContainText("3");
  await expect(page.getByTestId("chip-watchlist")).toContainText("1");
  await expect(page.getByTestId("chip-stopped")).toContainText("1");
  await expect(page.getByTestId("chip-finished")).toContainText("1");

  // Exactly one active chip; its bucket fills the grid.
  await expect(watching).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toBeVisible();
  await expect(page.getByTestId("library-card").filter({ hasText: "Lapsed Show" })).toBeVisible();
  await expect(page.getByTestId("library-card").filter({ hasText: "Fresh Pick" })).toHaveCount(0);
});

test("tile overlays carry non-color cues: remaining badge, PAUSED tag, finished check", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), oneOfEachChip());
  await page.goto("/library");

  // Watching: remaining-count badge (number + bar = two cues, never color-only).
  const watchMe = page.getByTestId("library-card").filter({ hasText: "Watch Me" });
  await expect(watchMe.getByTestId("library-remaining")).toHaveText("5");

  // Stopped: an explicit PAUSED text tag: text, not just dimming.
  await page.getByTestId("chip-stopped").click();
  const stopped = page.getByTestId("library-card").filter({ hasText: "Abandoned Show" });
  await expect(stopped).toContainText("PAUSED");

  // Watchlist: a plain tile (nothing fabricated for a show never started).
  await page.getByTestId("chip-watchlist").click();
  await expect(page.getByTestId("library-card").filter({ hasText: "Fresh Pick" })).toBeVisible();
});

test("the active chip is remembered per segment across a reload", async ({ page }) => {
  await installLibraryRoutes(page.context(), oneOfEachChip());
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/library");

  await page.getByTestId("chip-finished").click();
  await expect(page.getByTestId("library-card").filter({ hasText: "Done Show" })).toBeVisible();

  await page.reload();
  const finished = page.getByTestId("chip-finished");
  const rail = page.getByTestId("library-chips");
  await expect(finished).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("library-card").filter({ hasText: "Done Show" })).toBeVisible();
  await expect
    .poll(async () => {
      const railBox = await rail.boundingBox();
      const chipBox = await finished.boundingBox();
      return (
        railBox !== null &&
        chipBox !== null &&
        chipBox.x >= railBox.x &&
        chipBox.x + chipBox.width <= railBox.x + railBox.width + 0.5
      );
    })
    .toBe(true);
  expect(await rail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("the tap-to-reveal filter scopes the grid and clears honestly", async ({ page }) => {
  await installLibraryRoutes(page.context(), oneOfEachChip());
  await page.goto("/library");

  await page.getByTestId("library-filter-toggle").click();
  const field = page.getByTestId("library-filter");
  await field.fill("watch me");
  await expect(page.getByTestId("library-card")).toHaveCount(1);
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toBeVisible();

  // No match → per-chip empty copy + Clear.
  await field.fill("zzzzz");
  await expect(page.getByTestId("library-empty-watching")).toContainText('No shows match "zzzzz".');
  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.getByTestId("library-card")).toHaveCount(3);

  // Toggling the tool closed clears the session filter too.
  await field.fill("watch me");
  await expect(page.getByTestId("library-card")).toHaveCount(1);
  await page.getByTestId("library-filter-toggle").click();
  await expect(page.getByTestId("library-filter")).toHaveCount(0);
  await expect(page.getByTestId("library-card")).toHaveCount(3);
});

test("the sort ActionSheet reorders shows within the active chip", async ({ page }) => {
  await installLibraryRoutes(page.context(), [
    {
      trakt: 1,
      title: "Zebra",
      status: "returning series",
      lastWatchedAt: agoIso(1),
      aired: 5,
      completed: 2,
      episodes: Array.from({ length: 5 }, (_, i) => ep(1, i + 1, AIRED, 10 + i)),
    },
    {
      trakt: 2,
      title: "Mango",
      status: "returning series",
      lastWatchedAt: agoIso(3),
      aired: 5,
      completed: 2,
      episodes: Array.from({ length: 5 }, (_, i) => ep(1, i + 1, AIRED, 20 + i)),
    },
    {
      trakt: 3,
      title: "Alpha",
      status: "returning series",
      lastWatchedAt: agoIso(5),
      aired: 5,
      completed: 2,
      episodes: Array.from({ length: 5 }, (_, i) => ep(1, i + 1, AIRED, 30 + i)),
    },
  ]);
  await page.goto("/library");

  // Default recently-watched → Zebra (newest) leads the Watching grid.
  await expect(page.getByTestId("library-card").first()).toContainText("Zebra");

  await page.getByTestId("library-sort").click();
  await page.getByTestId("sort-alphabetical").click();
  await expect(page.getByTestId("library-card").first()).toContainText("Alpha");
});

test("long-press quick actions: the expert mark rides the queue pipeline with its snackbar", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), oneOfEachChip());
  await page.goto("/library");

  // Desktop context-menu = the long-press equivalent (same QuickActions sheet).
  await page.getByTestId("library-card").filter({ hasText: "Watch Me" }).click({ button: "right" });

  // The accelerator names the real next episode (completed 5 → S1 E6, id 105).
  const quickMark = page.getByTestId("quick-mark");
  await expect(quickMark).toHaveText("Mark S1 E6 watched");
  await quickMark.click();

  // The exact queue pipeline: optimistic write + the one snackbar with Undo.
  await expect(page.getByTestId("snackbar")).toContainText("Watch Me S1 E6 marked");
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(105);
  await page.getByTestId("snackbar-undo").click();
  await expect.poll(() => controls.removePosts().length).toBe(1);
});

test("long-press quick actions: Stop show confirms via snackbar, reversibly, and re-buckets the tile", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), oneOfEachChip());
  await page.goto("/library");

  await page.getByTestId("library-card").filter({ hasText: "Watch Me" }).click({ button: "right" });
  await page.getByTestId("quick-stop").click();

  await expect(page.getByTestId("snackbar")).toContainText("Watch Me stopped");
  await expect.poll(() => controls.hiddenPosts().length).toBe(1);
  // The tile leaves Watching for Stopped.
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toHaveCount(0);
  await page.getByTestId("chip-stopped").click();
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toBeVisible();

  // Undo un-stops it.
  await page.getByTestId("snackbar-undo").click();
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toHaveCount(0);
});

test("Resume on a Stopped tile clears the hidden set and re-buckets it", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), oneOfEachChip());
  await page.goto("/library");

  await page.getByTestId("chip-stopped").click();
  await page
    .getByTestId("library-card")
    .filter({ hasText: "Abandoned Show" })
    .click({ button: "right" });
  await page.getByTestId("quick-resume").click();

  await expect(page.getByTestId("snackbar")).toContainText("Abandoned Show resumed");
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);
  // Gone from Stopped; present under Watching.
  await expect(page.getByTestId("library-card").filter({ hasText: "Abandoned Show" })).toHaveCount(
    0,
  );
  await page.getByTestId("chip-watching").click();
  await expect(
    page.getByTestId("library-card").filter({ hasText: "Abandoned Show" }),
  ).toBeVisible();
});

test("quick actions' Show details routes into the detail page", async ({ page }) => {
  await installLibraryRoutes(page.context(), oneOfEachChip());
  await page.goto("/library");

  await page.getByTestId("library-card").filter({ hasText: "Watch Me" }).click({ button: "right" });
  await page.getByTestId("quick-details").click();
  await expect(page.getByTestId("screen-show-detail")).toBeVisible();
  await expect(page).toHaveURL(/\/show\/1$/);
});

test("the Shows/Movies segment switches library type", async ({ page }) => {
  await installLibraryRoutes(page.context(), oneOfEachChip());
  await page.goto("/library");

  await expect(page.getByTestId("library-card").first()).toBeVisible();
  await page.getByTestId("type-movies").click();
  // No movie routes installed here, so the movie library resolves empty.
  await expect(page.getByTestId("library-empty-watchlist")).toBeVisible();
  await expect(page.getByTestId("library-card")).toHaveCount(0);

  await page.getByTestId("type-shows").click();
  await expect(page.getByTestId("library-card").first()).toBeVisible();
});

test("a large chip stays virtualized: DOM row count stays bounded", async ({ page }) => {
  const many: ShowFixture[] = Array.from({ length: 200 }, (_, i) => ({
    trakt: 1000 + i,
    title: `Show ${i}`,
    status: "returning series",
    lastWatchedAt: agoIso((i % 10) + 1),
    aired: 10,
    completed: 4,
    episodes: Array.from({ length: 10 }, (_, e) => ep(1, e + 1, AIRED, (1000 + i) * 100 + e)),
  }));
  await installLibraryRoutes(page.context(), many);
  await page.goto("/library");

  await expect(page.getByTestId("library-card").first()).toBeVisible();
  // 200 shows land under Watching, but only the visible window (+overscan) of
  // 3-column grid rows is in the DOM.
  const rendered = await page.getByTestId("virtual-row").count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(40);
});

test("an empty library reads per-chip orientation copy with a Search CTA", async ({ page }) => {
  await installLibraryRoutes(page.context(), []);
  await page.goto("/library");

  await expect(page.getByTestId("library-empty-watching")).toContainText(
    "Shows you're watching land here.",
  );
  await page.getByTestId("library-search-shows").click();
  await expect(page.getByTestId("screen-search")).toBeVisible();
});

test("an only-stopped library still counts its Stopped chip honestly", async ({ page }) => {
  await installLibraryRoutes(page.context(), [
    {
      trakt: 1,
      title: "Only Stopped",
      status: "returning series",
      hidden: true,
      lastWatchedAt: agoIso(2),
      aired: 3,
      completed: 1,
      episodes: [ep(1, 1, AIRED, 11), ep(1, 2, AIRED, 12), ep(1, 3, AIRED, 13)],
    },
  ]);
  await page.goto("/library");

  // The default Watching chip is empty (orientation copy), but Stopped carries
  // the show: the library never claims "nothing tracked".
  await expect(page.getByTestId("library-empty-watching")).toBeVisible();
  await expect(page.getByTestId("chip-stopped")).toContainText("1");
  await page.getByTestId("chip-stopped").click();
  await expect(page.getByTestId("library-card").filter({ hasText: "Only Stopped" })).toBeVisible();
});
