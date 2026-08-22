import { expect, type Page, test } from "@playwright/test";
import {
  agoIso,
  installHermeticRoutes,
  installLibraryRoutes,
  type ShowFixture,
  seedAuth,
  seedTutorialDismissed,
} from "./helpers";

// The pull gesture is touch/pen-only, so this suite drives REAL touch input
// through CDP (chromium only), the same way the swipe suite does. What it pins
// is what a unit test cannot: that a released pull past the threshold runs
// exactly one sync pass, that a short one runs none, and that the gesture is
// live across a screen's chrome and not only its list.

const AIRED = "2026-01-01T00:00:00.000Z";

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

function soloShow(): ShowFixture {
  return {
    trakt: 1,
    tmdb: 501,
    title: "Solo",
    status: "returning series",
    posters: ["media.trakt.tv/solo.webp"],
    lastWatchedAt: agoIso(2),
    aired: 3,
    completed: 1,
    episodes: [
      { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 11 },
      { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: 12 },
      { season: 1, number: 3, title: "Three", firstAired: AIRED, traktId: 13 },
    ],
  };
}

/**
 * Drive a downward touch drag with CDP (`Input.dispatchTouchEvent`): trusted
 * touch the browser synthesizes real pointer events from, which is what the
 * wrapper's pointer handlers (12px axis lock, half-rate resistance, 80px arm
 * threshold) listen to. Small steps keep the axis resolution stable.
 */
async function touchPull(page: Page, x: number, y: number, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const steps = 12;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + (dy * i) / steps, id: 1 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** The boot poll has to have landed before a manual pass is countable. */
async function settledPollCount(
  page: Page,
  controls: { activitiesReads: () => number },
): Promise<number> {
  await expect.poll(() => controls.activitiesReads()).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  return controls.activitiesReads();
}

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP touch dispatch is chromium-only");
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
  await seedTutorialDismissed(page.context());
});

test("a pull past the threshold runs exactly one sync pass", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  await expect(page.getByTestId("up-next-card").first()).toBeVisible();
  const baseline = await settledPollCount(page, controls);

  const region = page.getByTestId("pull-to-refresh");
  const box = await region.boundingBox();
  if (box === null) throw new Error("pull region has no layout box");
  // 240px of travel is 120px of pull at half rate: well past the 80px threshold.
  await touchPull(page, box.x + box.width / 2, box.y + 8, 240);

  // The indicator holds its minimum spin and then settles; nothing failed, so
  // the shared failure snackbar never appears.
  await expect(region).toHaveAttribute("data-state", "refreshing");
  await expect.poll(() => controls.activitiesReads()).toBe(baseline + 1);
  await expect(region).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("snackbar")).toHaveCount(0);
  // Exactly one pass: nothing re-fires while the gesture settles.
  await page.waitForTimeout(1000);
  expect(controls.activitiesReads()).toBe(baseline + 1);
});

test("a pull that starts on the Library chip rail refreshes like any other", async ({ page }) => {
  await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/library");
  const chips = page.getByTestId("library-chips");
  await expect(chips).toBeVisible();

  // The rail scrolls horizontally and is chrome rather than list, which is why
  // it sat outside the pull region and silently ignored the gesture. Only an
  // armed release reaches the refreshing state, so the state is the whole
  // assertion: a drag the region never claimed leaves it idle.
  const box = await chips.boundingBox();
  if (box === null) throw new Error("the chip rail has no layout box");
  // Left of centre, clear of the indicator: it parks above the region's own top
  // edge at opacity 0, and a drag that started on it would be claimed whatever
  // the rail belongs to.
  await touchPull(page, box.x + 24, box.y + box.height / 2, 240);

  const region = page.getByTestId("pull-to-refresh");
  await expect(region).toHaveAttribute("data-state", "refreshing");
  await expect(region).toHaveAttribute("data-state", "idle");
});

test("a pull released short of the threshold syncs nothing", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  await expect(page.getByTestId("up-next-card").first()).toBeVisible();
  const baseline = await settledPollCount(page, controls);

  const region = page.getByTestId("pull-to-refresh");
  const box = await region.boundingBox();
  if (box === null) throw new Error("pull region has no layout box");
  // Past the 12px axis lock (so the gesture is genuinely claimed) but only 50px
  // of pull at half rate, short of the 80px arm threshold.
  await touchPull(page, box.x + box.width / 2, box.y + 8, 100);

  await page.waitForTimeout(1500);
  expect(controls.activitiesReads()).toBe(baseline);
  await expect(region).toHaveAttribute("data-state", "idle");
});
