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

/** One show per pile, in canonical order: watching, lapsed, not-started, caught-up,
 * ended, abandoned. Freshness (Watching vs Not-watched-in-a-while) uses relative
 * dates so the split is stable regardless of when the suite runs. */
function oneOfEachPile(): ShowFixture[] {
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

test("renders the piles in canonical order with count badges", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 2200 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/my-shows");

  const headings = page.getByTestId("pile-heading");
  await expect(headings).toHaveCount(6);
  await expect(headings.nth(0)).toHaveAttribute("data-status", "watching");
  await expect(headings.nth(1)).toHaveAttribute("data-status", "lapsed");
  await expect(headings.nth(2)).toHaveAttribute("data-status", "not-started");
  await expect(headings.nth(3)).toHaveAttribute("data-status", "caught-up");
  await expect(headings.nth(4)).toHaveAttribute("data-status", "ended");
  await expect(headings.nth(5)).toHaveAttribute("data-status", "abandoned");

  // Each pile carries a count badge; every pile here holds exactly one show.
  await expect(page.getByTestId("pile-count").first()).toHaveText("1");

  // Watching is open by default, so its tile is mounted; Not started is collapsed.
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toBeVisible();
  await expect(page.getByTestId("library-card").filter({ hasText: "Fresh Pick" })).toHaveCount(0);
});

test("a collapsed pile expands on click and the choice persists across a reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/my-shows");

  const ended = page.getByTestId("pile-heading").filter({ hasText: "Ended" });
  await expect(ended).toHaveAttribute("data-state", "closed");
  await ended.click();
  await expect(ended).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("library-card").filter({ hasText: "Done Show" })).toBeVisible();

  await page.reload();
  const endedAfter = page.getByTestId("pile-heading").filter({ hasText: "Ended" });
  await expect(endedAfter).toHaveAttribute("data-state", "open");
});

test("the cross-pile filter expands matching piles and never mounts non-matches", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/my-shows");

  // "Done Show" lives in the collapsed Ended pile; filtering surfaces it.
  await page.getByTestId("library-filter").fill("done show");
  await expect(page.getByTestId("filter-summary")).toContainText("1 matching show");
  await expect(page.getByTestId("library-card").filter({ hasText: "Done Show" })).toBeVisible();

  // The Ended pile reads matches/total; a pile with no match stays collapsed.
  const ended = page.getByTestId("pile-heading").filter({ hasText: "Ended" });
  await expect(ended.getByTestId("pile-count")).toHaveText("1/1");
  const watching = page.getByTestId("pile-heading").filter({ hasText: "Watching" });
  await expect(watching).toHaveAttribute("data-state", "closed");
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toHaveCount(0);

  // Clearing restores the saved layout: Watching open again, Ended collapsed.
  await page.getByTestId("library-filter").fill("");
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toBeVisible();
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Ended" })).toHaveAttribute(
    "data-state",
    "closed",
  );
});

test("filtering never rewrites the persisted open-state; it survives a reload intact", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/my-shows");

  // Establish a deliberate layout: open Caught up alongside the default Watching.
  await page.getByTestId("pile-heading").filter({ hasText: "Caught up" }).click();
  const before = await page.evaluate(() => localStorage.getItem("cue.piles-open"));
  expect(new Set(JSON.parse(before ?? "null"))).toEqual(new Set(["watching", "caught-up"]));

  // A filter that matches a different, collapsed pile expands it transiently…
  await page.getByTestId("library-filter").fill("done show");
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Ended" })).toHaveAttribute(
    "data-state",
    "open",
  );
  // …but the persisted layout is untouched by that ephemeral expansion.
  expect(await page.evaluate(() => localStorage.getItem("cue.piles-open"))).toBe(before);

  await page.reload();
  // The stored layout survives the reload byte-for-byte, and the transient Ended
  // expansion is gone — only the piles the user actually opened are open.
  expect(await page.evaluate(() => localStorage.getItem("cue.piles-open"))).toBe(before);
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Ended" })).toHaveAttribute(
    "data-state",
    "closed",
  );
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Caught up" })).toHaveAttribute(
    "data-state",
    "open",
  );
});

test("a no-match filter shows the empty state and clears back to the piles", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/my-shows");

  await page.getByTestId("library-filter").fill("zzzzz");
  await expect(page.getByTestId("my-shows-filter-empty")).toBeVisible();
  await expect(page.getByTestId("pile-heading")).toHaveCount(0);

  await page
    .getByTestId("my-shows-filter-empty")
    .getByRole("button", { name: "Clear filter" })
    .click();
  await expect(page.getByTestId("my-shows-filter-empty")).toHaveCount(0);
  await expect(page.getByTestId("pile-heading")).toHaveCount(6);
});

test("un-abandon on a tile removes it from the hidden set and re-files it", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  const controls = await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/my-shows");

  const abandoned = page.getByTestId("pile-heading").filter({ hasText: "Abandoned" });
  await expect(abandoned).toHaveAttribute("data-state", "closed");
  await abandoned.click();

  await page.getByTestId("unabandon").click();

  // Un-abandon writes the hidden-set removal, and Undo is offered.
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);
  await expect(page.getByTestId("unabandon-undo")).toBeVisible();

  // With the hidden flag cleared, the show leaves the Abandoned pile.
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Abandoned" })).toHaveCount(0);
});

test("the sort control reorders shows within a pile", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
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
  await page.goto("/my-shows");

  // Default recently-watched → Zebra (newest) leads the Watching pile.
  await expect(page.getByTestId("library-card").first()).toContainText("Zebra");

  await page.getByTestId("sort-select").selectOption("alphabetical");
  await expect(page.getByTestId("library-card").first()).toContainText("Alpha");
});

test("the Shows/Movies toggle switches library type", async ({ page }) => {
  await installLibraryRoutes(page.context(), oneOfEachPile());
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

test("a large open pile stays virtualized: DOM row count stays bounded", async ({ page }) => {
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
  await page.goto("/my-shows");

  await expect(page.getByTestId("library-card").first()).toBeVisible();
  // 200 shows all land in the (open) Watching pile, but only the visible window
  // (+overscan) is in the DOM.
  const rendered = await page.getByTestId("virtual-row").count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(40);
});

test("shows a whole-library empty state when nothing is tracked", async ({ page }) => {
  await installLibraryRoutes(page.context(), []);
  await page.goto("/my-shows");
  await expect(page.getByTestId("my-shows-empty")).toBeVisible();
});

test("an only-abandoned library shows its own state, not 'Nothing tracked yet'", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installLibraryRoutes(page.context(), [
    {
      trakt: 1,
      title: "Only Abandoned",
      status: "returning series",
      hidden: true,
      lastWatchedAt: agoIso(2),
      aired: 3,
      completed: 1,
      episodes: [ep(1, 1, AIRED, 11), ep(1, 2, AIRED, 12), ep(1, 3, AIRED, 13)],
    },
  ]);
  await page.goto("/my-shows");

  await expect(page.getByTestId("my-shows-only-abandoned")).toBeVisible();
  await expect(page.getByTestId("my-shows-empty")).toHaveCount(0);
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Abandoned" })).toBeVisible();
});
