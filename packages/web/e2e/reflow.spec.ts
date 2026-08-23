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
  seedTutorialDismissed,
} from "./helpers";

/** ~320 CSS px is WCAG 1.4.10's reflow width (1280px at 400% zoom). Content must fit
 * with no horizontal scroll: grids reflow, rows wrap. */
const NARROW = { width: 320, height: 720 } as const;
const AIRED = "2026-01-01T00:00:00.000Z";
const BREAKPOINT_CASES = [
  { width: 874, height: 402, primary: "tabbar" },
  { width: 956, height: 440, primary: "tabbar" },
  { width: 1024, height: 768, primary: "sidebar" },
  { width: 390, height: 844, primary: "tabbar" },
] as const;

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
 * overflow-x containers (the chips row) clip their own content and never widen this. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

/** 200% browser zoom halves the usable CSS width; any control or row with an
 * intrinsic width wider than that half would push the body into a sideways
 * scroll (a WCAG 1.4.4 / 1.4.10 failure). */
const ZOOM = { width: 390, height: 780 } as const;

async function setZoom(page: Page, factor: number): Promise<void> {
  await page.evaluate((f) => {
    document.documentElement.style.zoom = String(f);
  }, factor);
  // A ResizeObserver-driven virtualizer can remeasure a frame after the zoom lands;
  // one rAF lets any such re-layout settle before the overflow is read.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

/** Long-titled plays across two days: the width pressure on history rows. */
function longHistoryRows(): HistoryRowFixture[] {
  return [
    {
      id: 1,
      type: "episode",
      showId: 100,
      showTitle: "The Extraordinarily Long Running Detective Series",
      season: 1,
      number: 1,
      episodeTitle: "The First Case of the Season",
      watchedAt: agoIso(1),
    },
    {
      id: 2,
      type: "episode",
      showId: 100,
      showTitle: "The Extraordinarily Long Running Detective Series",
      season: 1,
      number: 2,
      episodeTitle: "The Case of the Missing Afternoon Appointment",
      watchedAt: agoIso(1),
    },
  ];
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
  await seedTutorialDismissed(page.context());
});

test.describe("landscape and breakpoint navigation gate", () => {
  for (const viewport of BREAKPOINT_CASES) {
    const label = `${viewport.width}x${viewport.height}`;

    test(`${label} shows only the reachable ${viewport.primary} with no horizontal overflow`, async ({
      browserName,
      page,
    }) => {
      await installLibraryRoutes(page.context(), libraryShows());
      await page.setViewportSize(viewport);

      if (label === "874x402" && browserName === "chromium") {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { left: 47, right: 47, bottom: 21 },
        });
      }

      await page.goto("/");
      await expect(
        page.getByTestId("screen-up-next"),
        `${label} Up Next route is reachable`,
      ).toBeVisible();

      const tabbar = page.locator(".tabbar");
      const sidebar = page.locator(".sidebar");
      if (viewport.primary === "tabbar") {
        await expect(tabbar, `${label} tabbar is visible`).toBeVisible();
        await expect(sidebar, `${label} sidebar is hidden`).toBeHidden();
      } else {
        await expect(sidebar, `${label} sidebar is visible`).toBeVisible();
        await expect(tabbar, `${label} tabbar is hidden`).toBeHidden();
      }

      expect(
        await horizontalOverflow(page),
        `${label} document overflows horizontally`,
      ).toBeLessThanOrEqual(1);

      if (label === "874x402") {
        // The CDP safe-area override above is chromium-only; without it webkit's
        // insets stay at 0 and this assertion degrades to a padding tautology
        // (-16 === -16) instead of proving anything. Skip rather than overstate
        // webkit's coverage.
        test.skip(browserName === "webkit", "no CDP safe-area override on webkit");

        const alignment = await page.evaluate(() => {
          const mainElement = document.querySelector<HTMLElement>(".main");
          const headerElement = document.querySelector<HTMLElement>(".app-header");
          if (!mainElement || !headerElement) throw new Error("App shell styles are unavailable");
          const main = getComputedStyle(mainElement);
          const header = getComputedStyle(headerElement);
          return {
            mainLeft: Number.parseFloat(main.paddingLeft),
            mainRight: Number.parseFloat(main.paddingRight),
            headerLeft: Number.parseFloat(header.marginLeft),
            headerRight: Number.parseFloat(header.marginRight),
          };
        });

        expect(
          alignment.headerLeft,
          "874x402 .app-header margin-left negates .main padding-left",
        ).toBe(-alignment.mainLeft);
        expect(
          alignment.headerRight,
          "874x402 .app-header margin-right negates .main padding-right",
        ).toBe(-alignment.mainRight);
      }
    });
  }
});

test("Library poster grid + chips reflow with no horizontal scroll @320", async ({ page }) => {
  await installLibraryRoutes(page.context(), libraryShows());
  await page.setViewportSize(NARROW);
  await page.goto("/library");
  await expect(page.getByTestId("library-card").first()).toBeVisible();

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Watch history rows reflow with no horizontal scroll @320", async ({ page }) => {
  await installHistoryRoutes(page.context(), longHistoryRows());
  await page.setViewportSize(NARROW);
  await page.goto("/history");
  await expect(page.getByTestId("history-row").first()).toBeVisible();

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Library controls reflow with no horizontal scroll at 200% zoom", async ({ page }) => {
  // `.library-toolbar` (Shows/Movies segment + the two 44px tool buttons)
  // wraps: the tool cluster drops to a second row instead of pushing the body
  // into a sideways scroll (WCAG 1.4.4/1.4.10).
  await installLibraryRoutes(page.context(), libraryShows());
  await page.setViewportSize(ZOOM);
  await page.goto("/library");
  await expect(page.getByTestId("library-card").first()).toBeVisible();

  await setZoom(page, 2);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Watch history reflows with no horizontal scroll at 200% zoom", async ({ page }) => {
  // The filter chips + month-jump chip are the width pressure here.
  await installHistoryRoutes(page.context(), longHistoryRows());
  await page.setViewportSize(ZOOM);
  await page.goto("/history");
  await expect(page.getByTestId("history-row").first()).toBeVisible();

  await setZoom(page, 2);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Up Next reflows with no horizontal scroll at 200% zoom", async ({ page }) => {
  // The trailing 48px check crowds the poster + text at 200% zoom; the row must
  // absorb it instead of overflowing the body.
  await installLibraryRoutes(page.context(), libraryShows());
  await page.setViewportSize(ZOOM);
  await page.goto("/");
  await expect(page.getByTestId("up-next-card").first()).toBeVisible();

  await setZoom(page, 2);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Up Next (marquee + queue + sections) reflows with no horizontal scroll @320", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), libraryShows());
  await page.setViewportSize(NARROW);
  await page.goto("/");
  await expect(page.getByTestId("marquee-card")).toBeVisible();

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
  await expect(page.getByTestId("season-panel").first()).toBeVisible();

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("the episode sheet reflows with no horizontal scroll @320", async ({ page }) => {
  await installLibraryRoutes(page.context(), [
    {
      trakt: 1,
      tmdb: 500,
      title: "The Detail Show",
      status: "returning series",
      posters: ["media.trakt.tv/p.webp"],
      lastWatchedAt: agoIso(2),
      aired: 3,
      completed: 1,
      episodes: [
        { ...ep(1, 1, 11), stills: ["media.trakt.tv/still.webp"] },
        { ...ep(1, 2, 12), stills: ["media.trakt.tv/still.webp"] },
        { ...ep(1, 3, 13), stills: ["media.trakt.tv/still.webp"] },
      ],
    },
  ]);
  await page.setViewportSize(NARROW);
  await page.goto("/show/1/episode/1/1");
  await expect(page.getByTestId("episode-sheet")).toBeVisible();
  await expect(page.getByTestId("episode-detail-title")).toBeVisible();

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test("Calendar, Search, Profile, and Settings reflow with no horizontal scroll @320", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), libraryShows());
  await page.setViewportSize(NARROW);

  for (const [path, marker] of [
    ["/calendar", "screen-calendar"],
    ["/search", "screen-search"],
    ["/profile", "screen-profile"],
    ["/settings", "screen-settings"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByTestId(marker)).toBeVisible();
    expect(await horizontalOverflow(page), `${path} overflows`).toBeLessThanOrEqual(1);
  }
});
