import { expect, type Page, test } from "@playwright/test";
import { buildPersistedClient, installHermeticRoutes, seedQueryCache } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
// The persister saves on a ~1s throttle; the first (empty) save must land before
// we seed so our seed is the final write the reload restores from.
const PERSIST_THROTTLE_MS = 1200;

async function bootThenSeed(
  page: Page,
  controls: Awaited<ReturnType<typeof installHermeticRoutes>>,
  ageMs: number,
): Promise<void> {
  controls.setMode("abort");
  await page.goto("/");
  await expect(page.getByTestId("frame-status")).toHaveText("Offline");
  await page.waitForTimeout(PERSIST_THROTTLE_MS);

  await seedQueryCache(page, buildPersistedClient(7, ageMs));

  controls.setMode("delay");
  controls.setCount(99);
  await page.reload();
}

test.describe("persisted cache boot", () => {
  test("repaints instantly from the persisted cache before the network resolves", async ({
    page,
  }) => {
    const controls = await installHermeticRoutes(page.context());
    await bootThenSeed(page, controls, 0);

    const status = page.getByTestId("frame-status");
    // The delayed network response is 2s out, so a 7 within 1.5s can only be the
    // restored cache painting — proof of stale-while-revalidate boot.
    await expect(status).toHaveAttribute("data-count", "7", { timeout: 1500 });
    // Then the background refetch resolves and replaces it.
    await expect(status).toHaveAttribute("data-count", "99", { timeout: 6000 });
  });

  test("a cache seeded over 24h ago still paints (maxAge decoupled from staleTime)", async ({
    page,
  }) => {
    const controls = await installHermeticRoutes(page.context());
    await bootThenSeed(page, controls, 25 * DAY_MS);

    const status = page.getByTestId("frame-status");
    // A 25-day-old snapshot would be dropped by the default 24h maxAge; that it
    // still paints proves maxAge is decoupled and only `buster` invalidates.
    await expect(status).toHaveAttribute("data-count", "7", { timeout: 1500 });
    await expect(status).toHaveAttribute("data-count", "99", { timeout: 6000 });
  });
});
