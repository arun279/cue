import { expect, type Page, test } from "@playwright/test";
import {
  agoIso,
  type EpisodeFixture,
  installHermeticRoutes,
  installLibraryRoutes,
  readStored,
  type ShowFixture,
  seedAuth,
} from "./helpers";

const AIRED = "2026-01-01T00:00:00.000Z";

/** The persister saves on a ~1s throttle; wait it out before reading the blob. */
const PERSIST_THROTTLE_MS = 1200;

/** The trakt ids whose `/shows/:id` facts the persisted cache actually carries. */
async function persistedShowInfoIds(page: Page): Promise<number[]> {
  const stored = await readStored(page, "cue.query-cache");
  if (stored === null) throw new Error("no persisted query cache");
  const { clientState } = JSON.parse(stored) as {
    clientState: { queries: { queryKey: unknown[] }[] };
  };
  return clientState.queries
    .filter((query) => query.queryKey[0] === "show" && query.queryKey[1] === "info")
    .map((query) => query.queryKey[2] as number);
}

/**
 * A library big enough that a per-card art read fanning out across it would be a
 * real burst against Trakt's 1000-GET / 5-minute authed window.
 */
const LIBRARY_SIZE = 300;

/**
 * The ceiling this suite gates: scrolling the whole library end to end must cost
 * FAR fewer GETs than it has shows. Art belongs to the cards a reader stops on,
 * not to every row a virtualized grid mounts and unmounts on the way past.
 *
 * Measured cost over three headed runs of this exact scroll: 25 GETs,
 * deterministic. 50 is a 2x margin over that measurement, not `LIBRARY_SIZE / 2`
 * (150): a ceiling six times the real cost passes a six-times regression, which is
 * the exact way this gate went slack once already.
 */
const SCROLL_ART_CEILING = 50;

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
  // Headless Chromium on this VM does not deliver IntersectionObserver callbacks
  // on authed pages, so this spec must run headed here; headed adds real render +
  // input latency on top of the ~14.6s of hard waits below, so give it margin
  // instead of inheriting a tight suite-wide default.
  test.setTimeout(60_000);
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

test("opening a show reuses the card's `/shows/:id` read instead of paying twice", async ({
  page,
}) => {
  // The card art and the detail hero want the same `/shows/:id` payload. Under two
  // query keys that was two GETs for one URL, charged every time a reader tapped a
  // card they had just looked at.
  const controls = await installLibraryRoutes(page.context(), [show(0)]);

  await page.goto("/library");
  const tile = page.getByTestId("library-card").first();
  await expect(tile).toBeVisible();
  await expect.poll(() => controls.artReads(), { timeout: 15_000 }).toBe(1);

  await tile.click();
  await expect(page.getByTestId("detail-title")).toBeVisible();
  await expect(page.getByTestId("continue-bar")).toBeVisible();

  // The hero paints from the entry the tile already filled and spends only its own
  // progress read.
  expect(controls.artReads()).toBe(1);
});

test("only a library show's facts reach the persisted blob", async ({ page }) => {
  // Sharing one cache entry between the card art and the hero means Show detail
  // writes `show/info` for anything opened from Search, Calendar or the Diary too.
  // Those have no card to restore, and with gcTime and maxAge both unbounded they
  // would pile up in IndexedDB for the life of the install.
  const offLibrary: ShowFixture = {
    ...show(9),
    trakt: 2000,
    title: "Never Tracked",
    lastWatchedAt: null,
    completed: 0,
  };
  await installLibraryRoutes(page.context(), [show(0), offLibrary]);

  await page.goto("/library");
  await expect(page.getByTestId("library-card")).toHaveCount(1);
  await page.getByTestId("library-card").first().click();
  await expect(page.getByTestId("detail-title")).toContainText("Show 000");
  await page.waitForTimeout(PERSIST_THROTTLE_MS);

  // A library show's facts DO earn their place: that is what a restored row
  // paints its poster from offline.
  expect(await persistedShowInfoIds(page)).toEqual([1000]);

  await page.goto("/show/2000");
  await expect(page.getByTestId("detail-title")).toContainText("Never Tracked");
  await page.waitForTimeout(PERSIST_THROTTLE_MS);

  expect(await persistedShowInfoIds(page)).toEqual([1000]);
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
