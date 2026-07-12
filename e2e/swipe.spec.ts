import { expect, type Page, test } from "@playwright/test";
import {
  agoIso,
  installHermeticRoutes,
  installLibraryRoutes,
  type ShowFixture,
  seedAuth,
  seedTutorialDismissed,
} from "./helpers";

// The swipe accelerator is touch/pen-only (mouse never triggers it), so this
// suite drives REAL touch input through CDP (chromium only). The tap paths are
// the load-bearing coverage elsewhere; this one spec proves the gesture commits
// through the identical pipeline.

const AIRED = "2026-01-01T00:00:00.000Z";

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

function soloShow(overrides: Partial<ShowFixture> = {}): ShowFixture {
  const trakt = overrides.trakt ?? 1;
  return {
    trakt,
    tmdb: 500 + trakt,
    title: "Solo",
    status: "returning series",
    posters: ["media.trakt.tv/solo.webp"],
    lastWatchedAt: agoIso(2),
    aired: 3,
    completed: 1,
    episodes: [
      { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: trakt * 10 + 1 },
      { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: trakt * 10 + 2 },
      { season: 1, number: 3, title: "Three", firstAired: AIRED, traktId: trakt * 10 + 3 },
    ],
    ...overrides,
  };
}

/**
 * Drive a horizontal touch drag with CDP (`Input.dispatchTouchEvent`): trusted
 * touch input the browser synthesizes real pointer events from, which is what
 * SwipeAction's pointer handlers (12px intent lock, 96px commit threshold)
 * listen to. Generous distance + small steps keep the intent resolution stable.
 */
async function touchSwipe(page: Page, x: number, y: number, dx: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const steps = 12;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + (dx * i) / steps, y, id: 1 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP touch dispatch is chromium-only");
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
  await seedTutorialDismissed(page.context());
});

test("swipe right on a queue row marks watched through the identical pipeline", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");

  const card = page.getByTestId("up-next-card").first();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E2");
  const b = await card.boundingBox();
  if (b === null) throw new Error("queue row has no layout box");

  // Well past the 96px commit threshold, dead horizontal (the 12px intent lock
  // claims the gesture away from vertical scroll).
  await touchSwipe(page, b.x + 24, b.y + b.height / 2, 220);

  // The commit runs the SAME mark pipeline: optimistic advance, the one
  // snackbar with Undo, and the durable POST for the pre-advance episode.
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");
  await expect(page.getByTestId("snackbar")).toContainText("Solo S1 E2 marked");
  await expect(page.getByTestId("snackbar-undo")).toBeVisible();
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(12);
});

test("a short swipe springs back and commits nothing", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");

  const card = page.getByTestId("up-next-card").first();
  const b = await card.boundingBox();
  if (b === null) throw new Error("queue row has no layout box");

  // Horizontal intent, but released short of the 96px threshold.
  await touchSwipe(page, b.x + 24, b.y + b.height / 2, 60);

  await expect(card.locator(".ep-row__code")).toHaveText("S1 E2");
  await page.waitForTimeout(1500);
  expect(controls.historyPosts()).toHaveLength(0);
  await expect(page.getByTestId("snackbar")).toHaveCount(0);
});

test("swipe left on a queue row stops the show, snackbar-reversibly", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");

  const card = page.getByTestId("up-next-card").first();
  const b = await card.boundingBox();
  if (b === null) throw new Error("queue row has no layout box");

  await touchSwipe(page, b.x + b.width - 24, b.y + b.height / 2, -220);

  // Confirm-free stop with the reversible snackbar.
  await expect(page.getByTestId("snackbar")).toContainText("Solo stopped");
  await expect.poll(() => controls.hiddenPosts().length).toBe(1);
  await page.getByTestId("snackbar-undo").click();
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);
});
