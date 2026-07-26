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

/**
 * A library big enough that a per-card art read fanning out across it would be a
 * real burst against Trakt's 1000-GET / 5-minute authed window.
 */
const LIBRARY_SIZE = 300;

/**
 * The ceiling this suite gates: scrolling the whole library end to end must cost
 * FAR fewer GETs than it has shows. Art belongs to the cards a reader stops on,
 * not to every row a virtualized grid mounts and unmounts on the way past.
 */
const SCROLL_ART_CEILING = LIBRARY_SIZE / 2;

function ep(season: number, number: number, traktId: number): EpisodeFixture {
  return { season, number, title: `Episode ${number}`, firstAired: AIRED, traktId };
}

function show(index: number): ShowFixture {
  return {
    trakt: 1000 + index,
    title: `Show ${String(index).padStart(3, "0")}`,
    status: "returning series",
    lastWatchedAt: agoIso(1 + (index % 14)),
    aired: 10,
    completed: 5,
    backdrops: [`media.trakt.tv/b${index}.webp`],
    episodes: Array.from({ length: 10 }, (_, i) => ep(1, i + 1, (1000 + index) * 100 + i)),
  };
}

/** A bare `/shows/:id` art read, not `/shows/:id/progress/watched` or `/seasons`. */
const isArtRead = (url: string): boolean => /\/api\.trakt\.tv\/shows\/\d+(\?|$)/.test(url);

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("scrolling the whole library costs far fewer art reads than it has shows", async ({
  page,
}) => {
  await installLibraryRoutes(
    page.context(),
    Array.from({ length: LIBRARY_SIZE }, (_, i) => show(i)),
  );

  let art = 0;
  page.on("request", (request) => {
    if (isArtRead(request.url())) art += 1;
  });

  await page.goto("/library");
  await expect(page.getByTestId("library-card").first()).toBeVisible();
  await page.waitForTimeout(2000);
  const atRest = art;

  // Flick from the top of the grid to the bottom. Every row mounts on the way
  // past (plus the virtualizer's overscan), so a read fired on mount would cost
  // one GET per show in the library.
  for (let i = 0; i < 60; i += 1) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(3000);

  expect(atRest).toBeGreaterThan(0);
  expect(atRest).toBeLessThan(SCROLL_ART_CEILING);
  expect(art).toBeLessThan(SCROLL_ART_CEILING);
});

test("a rate-limited art read recovers instead of leaving the card unresolved", async ({
  page,
}) => {
  // The bulk watched list carries no backdrop, so the hero's backdrop can ONLY
  // come from its own art read: if that read is dropped on a 429, the card keeps
  // its gradient plate for the whole content hour with nothing to retry it.
  const controls = await installLibraryRoutes(
    page.context(),
    Array.from({ length: 4 }, (_, i) => show(i)),
  );
  controls.rateLimitArtReads(1);

  await page.goto("/");

  await expect(page.getByTestId("marquee-card").locator("img")).toBeVisible({ timeout: 15_000 });
});
