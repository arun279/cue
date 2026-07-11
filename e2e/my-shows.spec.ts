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

/** One show per Library segment, in canonical order: Watchlist(not-started),
 * Watching (the idle "Lapsed Show" now folds in here), Caught up, Finished(ended),
 * Stopped(abandoned). Relative dates keep the derived status stable. */
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

test("the sync pill shows the last-synced timestamp, not a bare 'Synced'", async ({ page }) => {
  // Regression: the shared pill rendered a bare "Synced" on Library (and Calendar)
  // while Up Next and Profile showed "Synced · <time ago>": the same component,
  // missing the `syncedAt` prop on these two routes. Wire it through so the recency
  // read is identical everywhere.
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/library");

  const pill = page.getByTestId("my-shows-status");
  await expect(pill).toHaveAttribute("data-state", "synced");
  await expect(pill).toContainText("Synced · ");
});

test("renders the segments in canonical order with count badges", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 2200 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/library");

  const headings = page.getByTestId("pile-heading");
  await expect(headings).toHaveCount(5);
  await expect(headings.nth(0)).toHaveAttribute("data-status", "not-started");
  await expect(headings.nth(1)).toHaveAttribute("data-status", "watching");
  await expect(headings.nth(2)).toHaveAttribute("data-status", "caught-up");
  await expect(headings.nth(3)).toHaveAttribute("data-status", "ended");
  await expect(headings.nth(4)).toHaveAttribute("data-status", "abandoned");

  // Plain, real-world labels: no dev jargon.
  await expect(headings.nth(0)).toContainText("Watchlist");
  await expect(headings.nth(1)).toContainText("Watching");
  await expect(headings.nth(3)).toContainText("Finished");
  await expect(headings.nth(4)).toContainText("Stopped");

  // Watchlist holds one; the idle "Lapsed Show" folds into Watching, giving it two.
  await expect(headings.nth(0).getByTestId("pile-count")).toHaveText("1");
  await expect(headings.nth(1).getByTestId("pile-count")).toHaveText("2");

  // Watching is open by default, so its tiles mount; Watchlist is collapsed.
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toBeVisible();
  await expect(page.getByTestId("library-card").filter({ hasText: "Lapsed Show" })).toBeVisible();
  await expect(page.getByTestId("library-card").filter({ hasText: "Fresh Pick" })).toHaveCount(0);
});

test("default-open falls back to the first non-empty segment when Watching is empty", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  // A library with nothing mid-watch: only a watchlist pick and a finished show, so
  // the preferred default segment (Watching) is absent entirely.
  await installLibraryRoutes(page.context(), [
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
      trakt: 5,
      title: "Done Show",
      status: "ended",
      lastWatchedAt: agoIso(4),
      aired: 2,
      completed: 2,
      episodes: [ep(1, 1, AIRED, 501), ep(1, 2, AIRED, 502)],
    },
  ]);
  await page.goto("/library");

  // With no Watching pile to open, the library falls back to the first non-empty
  // segment (Watchlist) rather than loading fully collapsed with nothing expanded.
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Watching" })).toHaveCount(0);
  const watchlist = page.getByTestId("pile-heading").filter({ hasText: "Watchlist" });
  await expect(watchlist).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("library-card").filter({ hasText: "Fresh Pick" })).toBeVisible();
});

test("a collapsed segment expands on click and the choice persists across a reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/library");

  const finished = page.getByTestId("pile-heading").filter({ hasText: "Finished" });
  await expect(finished).toHaveAttribute("data-state", "closed");
  await finished.click();
  await expect(finished).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("library-card").filter({ hasText: "Done Show" })).toBeVisible();

  await page.reload();
  const finishedAfter = page.getByTestId("pile-heading").filter({ hasText: "Finished" });
  await expect(finishedAfter).toHaveAttribute("data-state", "open");
});

test("a caught-up tile notes its return date when known", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/library");

  await page.getByTestId("pile-heading").filter({ hasText: "Caught up" }).click();
  await expect(page.getByTestId("returning-note")).toContainText("returning");
});

test("the cross-segment filter expands matching segments and never mounts non-matches", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/library");

  // "Done Show" lives in the collapsed Finished segment; filtering surfaces it.
  await page.getByTestId("library-filter").fill("done show");
  await expect(page.getByTestId("filter-summary")).toContainText("1 matching show");
  await expect(page.getByTestId("library-card").filter({ hasText: "Done Show" })).toBeVisible();

  // The Finished segment reads matches/total; a segment with no match stays collapsed.
  const finished = page.getByTestId("pile-heading").filter({ hasText: "Finished" });
  await expect(finished.getByTestId("pile-count")).toHaveText("1/1");
  const watching = page.getByTestId("pile-heading").filter({ hasText: "Watching" });
  await expect(watching).toHaveAttribute("data-state", "closed");
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toHaveCount(0);

  // Clearing restores the saved layout: Watching open again, Finished collapsed.
  await page.getByTestId("library-filter").fill("");
  await expect(page.getByTestId("library-card").filter({ hasText: "Watch Me" })).toBeVisible();
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Finished" })).toHaveAttribute(
    "data-state",
    "closed",
  );
});

test("filtering never rewrites the persisted open-state; it survives a reload intact", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/library");

  // Establish a deliberate layout: open Caught up alongside the default Watching.
  await page.getByTestId("pile-heading").filter({ hasText: "Caught up" }).click();
  const before = await page.evaluate(() => localStorage.getItem("cue.piles-open"));
  expect(new Set(JSON.parse(before ?? "null"))).toEqual(new Set(["watching", "caught-up"]));

  // A filter that matches a different, collapsed segment expands it transiently…
  await page.getByTestId("library-filter").fill("done show");
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Finished" })).toHaveAttribute(
    "data-state",
    "open",
  );
  // …but the persisted layout is untouched by that ephemeral expansion.
  expect(await page.evaluate(() => localStorage.getItem("cue.piles-open"))).toBe(before);

  await page.reload();
  // The stored layout survives the reload byte-for-byte, and the transient Finished
  // expansion is gone: only the segments the user actually opened are open.
  expect(await page.evaluate(() => localStorage.getItem("cue.piles-open"))).toBe(before);
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Finished" })).toHaveAttribute(
    "data-state",
    "closed",
  );
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Caught up" })).toHaveAttribute(
    "data-state",
    "open",
  );
});

test("a no-match filter shows the empty state and clears back to the segments", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/library");

  await page.getByTestId("library-filter").fill("zzzzz");
  await expect(page.getByTestId("my-shows-filter-empty")).toBeVisible();
  await expect(page.getByTestId("pile-heading")).toHaveCount(0);

  await page
    .getByTestId("my-shows-filter-empty")
    .getByRole("button", { name: "Clear filter" })
    .click();
  await expect(page.getByTestId("my-shows-filter-empty")).toHaveCount(0);
  await expect(page.getByTestId("pile-heading")).toHaveCount(5);
});

test("Resume on a Stopped tile removes it from the hidden set and re-files it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1600 });
  const controls = await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/library");

  const stopped = page.getByTestId("pile-heading").filter({ hasText: "Stopped" });
  await expect(stopped).toHaveAttribute("data-state", "closed");
  await stopped.click();

  await expect(page.getByTestId("resume")).toHaveText("Resume");
  await page.getByTestId("resume").click();

  // Resume writes the hidden-set removal, and Undo is offered.
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);
  await expect(page.getByTestId("resume-undo")).toContainText("Resumed");

  // With the hidden flag cleared, the show leaves the Stopped segment.
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Stopped" })).toHaveCount(0);

  // Resume is reversible: Undo re-stops the show (re-hide) and it returns to Stopped.
  await page.getByTestId("resume-undo-action").click();
  await expect.poll(() => controls.hiddenPosts().length).toBe(1);
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Stopped" })).toBeVisible();
});

test("the sort control reorders shows within a segment", async ({ page }) => {
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
  await page.goto("/library");

  // Default recently-watched → Zebra (newest) leads the Watching segment.
  await expect(page.getByTestId("library-card").first()).toContainText("Zebra");

  await page.getByTestId("sort-select").selectOption("alphabetical");
  await expect(page.getByTestId("library-card").first()).toContainText("Alpha");
});

test("the Shows/Movies toggle switches library type", async ({ page }) => {
  await installLibraryRoutes(page.context(), oneOfEachPile());
  await page.goto("/library");

  await expect(page.getByTestId("library-card").first()).toBeVisible();
  await page.getByTestId("type-movies").click();
  // No movie routes installed here, so the movie library resolves empty.
  await expect(page.getByTestId("movies-empty")).toBeVisible();
  await expect(page.getByTestId("library-card")).toHaveCount(0);

  await page.getByTestId("type-shows").click();
  await expect(page.getByTestId("movies-empty")).toHaveCount(0);
  await expect(page.getByTestId("library-card").first()).toBeVisible();
});

test("a large open segment stays virtualized: DOM row count stays bounded", async ({ page }) => {
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
  // 200 shows all land in the (open) Watching segment, but only the visible window
  // (+overscan) is in the DOM.
  const rendered = await page.getByTestId("virtual-row").count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(40);
});

test("shows a whole-library empty state when nothing is tracked", async ({ page }) => {
  await installLibraryRoutes(page.context(), []);
  await page.goto("/library");
  await expect(page.getByTestId("my-shows-empty")).toBeVisible();
});

test("an only-stopped library shows its own state, not 'Nothing tracked yet'", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
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

  await expect(page.getByTestId("my-shows-only-abandoned")).toBeVisible();
  await expect(page.getByTestId("my-shows-only-abandoned")).toContainText("stopped");
  await expect(page.getByTestId("my-shows-empty")).toHaveCount(0);
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Stopped" })).toBeVisible();
});
