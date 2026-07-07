import { expect, type Page, test } from "@playwright/test";
import {
  buildPersistedLibrary,
  installHermeticRoutes,
  installLibraryRoutes,
  type LibraryControls,
  type ShowFixture,
  seedActivities,
  seedAuth,
  seedQueryCache,
} from "./helpers";

/**
 * A last-activities baseline OLDER than the library harness's fixture stamps
 * (2026-07-04): the boot poll diffs it, sees the change, and revalidates the
 * restored cache — the poll-driven successor to refetch-on-mount that the
 * stale-while-revalidate boot now rides on.
 */
const STALE_ACTIVITIES = { episodes: { watched_at: "2026-07-01T00:00:00.000Z" } };

const DAY_MS = 24 * 60 * 60 * 1000;
// The persister saves on a ~1s throttle; the first (empty) save must land before
// we seed so our seed is the final write the reload restores from.
const PERSIST_THROTTLE_MS = 1200;

/** `networkCount` distinct shows, each with one aired unwatched next episode → one card apiece. */
function networkShows(count: number): ShowFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    trakt: 100 + index,
    title: `Network Show ${index + 1}`,
    status: "returning series",
    lastWatchedAt: new Date(Date.now() - (index + 1) * DAY_MS).toISOString(),
    aired: 5,
    completed: 1,
    episodes: [
      {
        season: 1,
        number: 1,
        title: "One",
        firstAired: "2026-01-01T00:00:00.000Z",
        traktId: 900 + index * 10,
      },
      {
        season: 1,
        number: 2,
        title: "Two",
        firstAired: "2026-02-01T00:00:00.000Z",
        traktId: 901 + index * 10,
      },
    ],
  }));
}

async function bootThenSeed(page: Page, controls: LibraryControls, ageMs: number): Promise<void> {
  await seedAuth(page.context());
  // A baseline OLDER than the harness fixture, present at every boot, so the reload
  // poll diffs a change and revalidates the restored cache.
  await seedActivities(page.context(), STALE_ACTIVITIES);
  controls.setReadMode("abort");
  await page.goto("/");
  // No cache yet + reads aborted → the hard-error state, sync pill offline.
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "offline");
  await page.waitForTimeout(PERSIST_THROTTLE_MS);

  await seedQueryCache(page, buildPersistedLibrary(1, ageMs));

  controls.setReadMode("ok");
  controls.setReadDelayMs(2000);
  await page.reload();
}

test.describe("persisted cache boot", () => {
  test("repaints the queue instantly from cache before the network resolves", async ({ page }) => {
    await installHermeticRoutes(page.context());
    const controls = await installLibraryRoutes(page.context(), networkShows(2));
    await bootThenSeed(page, controls, 0);

    const status = page.getByTestId("sync-status");
    // The delayed network response is 2s out, so a count of 1 within 1.5s can
    // only be the restored cache painting — proof of stale-while-revalidate boot.
    await expect(status).toHaveAttribute("data-count", "1", { timeout: 1500 });
    // Then the background refetch (2 shows) resolves and replaces it.
    await expect(status).toHaveAttribute("data-count", "2", { timeout: 6000 });
  });

  test("a cache seeded far in the past still paints (maxAge decoupled from staleTime)", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const controls = await installLibraryRoutes(page.context(), networkShows(2));
    await bootThenSeed(page, controls, 25 * DAY_MS);

    const status = page.getByTestId("sync-status");
    // A 25-day-old snapshot would be dropped by a 24h maxAge; that it still paints
    // proves maxAge is decoupled and only `buster` invalidates.
    await expect(status).toHaveAttribute("data-count", "1", { timeout: 1500 });
    await expect(status).toHaveAttribute("data-count", "2", { timeout: 6000 });
  });
});
