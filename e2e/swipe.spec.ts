import { expect, test } from "@playwright/test";
import {
  installHermeticRoutes,
  installLibraryRoutes,
  seedAuth,
  seedTutorialDismissed,
  soloShow,
  touchDrag,
} from "./helpers";

// The swipe accelerator is touch/pen-only (mouse never triggers it), so this
// suite drives REAL touch input through CDP (chromium only). The tap paths are
// the load-bearing coverage elsewhere; this one spec proves the gesture commits
// through the identical pipeline.

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

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
  await touchDrag(page, { x: b.x + 24, y: b.y + b.height / 2 }, { dx: 220 });

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
  await touchDrag(page, { x: b.x + 24, y: b.y + b.height / 2 }, { dx: 60 });

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

  await touchDrag(page, { x: b.x + b.width - 24, y: b.y + b.height / 2 }, { dx: -220 });

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
