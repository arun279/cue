import { expect, type Page, test } from "@playwright/test";
import {
  agoIso,
  type EpisodeFixture,
  type HistoryRowFixture,
  installHermeticRoutes,
  installHistoryRoutes,
  installLibraryRoutes,
  type ShowFixture,
  seedAuth,
} from "./helpers";

/** ~320 CSS px is WCAG 1.4.10's reflow width (1280px at 400% zoom). Content must fit
 * with no horizontal scroll: grids reflow to a single column, rows wrap. */
const NARROW = { width: 320, height: 720 } as const;
const AIRED = "2026-01-01T00:00:00.000Z";

function ep(season: number, number: number, traktId: number): EpisodeFixture {
  return { season, number, title: `Episode ${number}`, firstAired: AIRED, traktId };
}

function libraryShows(): ShowFixture[] {
  return Array.from({ length: 4 }, (_, i) => ({
    trakt: i + 1,
    tmdb: 500 + i,
    title: `A Deliberately Long Show Title Number ${i + 1}`,
    status: "returning series",
    posters: [`media.trakt.tv/s${i + 1}.webp`],
    lastWatchedAt: agoIso(i + 2),
    aired: 3,
    completed: 1,
    episodes: [ep(1, 1, (i + 1) * 10 + 1), ep(1, 2, (i + 1) * 10 + 2), ep(1, 3, (i + 1) * 10 + 3)],
  }));
}

/** The document's own horizontal overflow (0 or ≤1px sub-pixel = no scroll). Inner
 * overflow-x containers (the stills shelf) clip their own content and never widen this. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

/** 200% browser zoom halves the usable CSS width, so any control or row with an
 * intrinsic width wider than that half: a long Sort option, the three-item History
 * segmented, the Up Next mark column: would push the body into a sideways scroll (a
 * WCAG 1.4.4 / 1.4.10 failure). Emulate it exactly as a design review does: stamp
 * `zoom: 2` on the document element and re-assert no horizontal overflow. The overflow case
 * was captured at 390px, so the tests lock that width. */
const ZOOM = { width: 390, height: 780 } as const;

async function setZoom(page: Page, factor: number): Promise<void> {
  await page.evaluate((f) => {
    document.documentElement.style.zoom = String(f);
  }, factor);
  // A ResizeObserver-driven virtualizer can remeasure a frame after the zoom lands;
  // one rAF lets any such re-layout settle before the overflow is read.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

/** A same-minute, same-show pair: the cluster whose trailing "Logged together" aside
 * used to crush the title to one word per line at ~320px (now a caption below the title
 * and episode range). Shared by the @320 reflow test and the 200%-zoom test. */
function clusteredHistoryRows(): HistoryRowFixture[] {
  const together = agoIso(1);
  return [
    {
      id: 1,
      type: "episode",
      showId: 100,
      showTitle: "The Extraordinarily Long Running Detective Series",
      season: 1,
      number: 1,
      episodeTitle: "The First Case of the Season",
      watchedAt: together,
    },
    {
      id: 2,
      type: "episode",
      showId: 100,
      showTitle: "The Extraordinarily Long Running Detective Series",
      season: 1,
      number: 2,
      episodeTitle: "The Case of the Missing Afternoon Appointment",
      watchedAt: together,
    },
  ];
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("Library poster grid reflows with no horizontal scroll @320", async ({ page }) => {
  await installLibraryRoutes(page.context(), libraryShows());
  await page.setViewportSize(NARROW);
  await page.goto("/library");
  await expect(page.getByTestId("screen-library")).toBeVisible();

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Watch history rows reflow with no horizontal scroll @320", async ({ page }) => {
  // A same-minute, same-show pair clusters with the "Logged together" caption: the
  // affordance that used to crush the title + episode range at narrow widths.
  await installHistoryRoutes(page.context(), clusteredHistoryRows());
  await page.setViewportSize(NARROW);
  await page.goto("/history");
  await expect(page.getByTestId("history-logged-together").first()).toBeVisible();

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Library controls reflow with no horizontal scroll at 200% zoom", async ({ page }) => {
  // The Sort <select> ("Recently added/watched") and Shows/Movies segmented are the
  // widest controls; at 200% zoom they must cap + wrap, never scroll the body.
  await installLibraryRoutes(page.context(), libraryShows());
  await page.setViewportSize(ZOOM);
  await page.goto("/library");
  await expect(page.getByTestId("screen-library")).toBeVisible();

  await setZoom(page, 2);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Watch history reflows with no horizontal scroll at 200% zoom", async ({ page }) => {
  // The three-item All/TV/Movies segmented plus the decade-jump selects are the width
  // pressure here; they must wrap/cap rather than push a sideways scroll.
  await installHistoryRoutes(page.context(), clusteredHistoryRows());
  await page.setViewportSize(ZOOM);
  await page.goto("/history");
  await expect(page.getByTestId("screen-history")).toBeVisible();
  await expect(page.getByTestId("history-logged-together").first()).toBeVisible();

  await setZoom(page, 2);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Up Next reflows with no horizontal scroll at 200% zoom", async ({ page }) => {
  // The trailing 56px mark column crowds the poster + text at 200% zoom; the row must
  // wrap the mark instead of overflowing the body.
  await installLibraryRoutes(page.context(), libraryShows());
  await page.setViewportSize(ZOOM);
  await page.goto("/");
  await expect(page.getByTestId("up-next-card").first()).toBeVisible();

  await setZoom(page, 2);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Show detail reflows with no horizontal scroll @320", async ({ page }) => {
  await installLibraryRoutes(page.context(), [
    {
      trakt: 1,
      tmdb: 500,
      title: "The Detail Show",
      status: "returning series",
      posters: ["media.trakt.tv/p.webp"],
      lastWatchedAt: agoIso(2),
      aired: 5,
      completed: 2,
      episodes: [ep(1, 1, 11), ep(1, 2, 12), ep(1, 3, 13), ep(1, 4, 14), ep(1, 5, 15)],
    },
  ]);
  await page.setViewportSize(NARROW);
  await page.goto("/show/1");
  await expect(page.getByTestId("detail-title")).toBeVisible();

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
