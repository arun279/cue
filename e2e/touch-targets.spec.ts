import { expect, type Locator, test } from "@playwright/test";
import {
  agoIso,
  type CalendarEpisodeFixture,
  type EpisodeFixture,
  type HistoryRowFixture,
  installCalendarRoutes,
  installHermeticRoutes,
  installHistoryRoutes,
  installLibraryRoutes,
  installSearchRoutes,
  type SearchHitFixture,
  type ShowFixture,
  seedAuth,
  seedTutorialDismissed,
} from "./helpers";

/** The Cue touch-target floor (`--tap-min`): WCAG 2.5.5 / Apple HIG 44pt. */
const TAP_MIN = 44;
/** A common small phone: the primary audit viewport. */
const PHONE = { width: 390, height: 844 } as const;
const AIRED = "2026-01-01T00:00:00.000Z";

function ep(season: number, number: number, traktId: number, firstAired = AIRED): EpisodeFixture {
  return {
    season,
    number,
    title: `Episode ${number}`,
    firstAired,
    traktId,
    stills: ["media.trakt.tv/still.webp"],
  };
}

/** A run of in-progress queue shows, each with an aired next episode. */
function continueShows(n: number): ShowFixture[] {
  return Array.from({ length: n }, (_, i) => ({
    trakt: i + 1,
    tmdb: 500 + i,
    title: `Continue Show ${i + 1}`,
    status: "returning series",
    posters: [`media.trakt.tv/s${i + 1}.webp`],
    lastWatchedAt: agoIso(i + 2),
    aired: 3,
    completed: 1,
    episodes: [ep(1, 1, (i + 1) * 10 + 1), ep(1, 2, (i + 1) * 10 + 2), ep(1, 3, (i + 1) * 10 + 3)],
  }));
}

/** A partially-watched show for the detail-screen controls. */
function detailShow(): ShowFixture {
  return {
    trakt: 1,
    tmdb: 500,
    title: "The Detail Show",
    status: "returning series",
    posters: ["media.trakt.tv/p.webp"],
    lastWatchedAt: agoIso(2),
    aired: 5,
    completed: 2,
    episodes: [ep(1, 1, 11), ep(1, 2, 12), ep(1, 3, 13), ep(1, 4, 14), ep(1, 5, 15), ep(0, 1, 91)],
  };
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("element has no layout box");
  return b;
}

/**
 * The element's EFFECTIVE target box: its border box grown by any ::before/
 * ::after hit-slop overlay (the GROW/HIT-SLOP rules keep visual ink compact
 * while the finger target clears 44px). Playwright's boundingBox ignores
 * pseudo-elements, so the slop is measured from computed styles.
 */
async function effectiveTarget(locator: Locator): Promise<{ width: number; height: number }> {
  return locator.evaluate((el) => {
    const base = el.getBoundingClientRect();
    let width = base.width;
    let height = base.height;
    for (const pseudo of ["::before", "::after"] as const) {
      const cs = getComputedStyle(el, pseudo);
      if (cs.content === "none" || cs.position !== "absolute") continue;
      const top = Number.parseFloat(cs.top);
      const bottom = Number.parseFloat(cs.bottom);
      const left = Number.parseFloat(cs.left);
      const right = Number.parseFloat(cs.right);
      // inset offsets are negative when the slop extends beyond the box.
      if (!Number.isNaN(top) && !Number.isNaN(bottom)) {
        height = Math.max(height, base.height - top - bottom);
      }
      if (!Number.isNaN(left) && !Number.isNaN(right)) {
        width = Math.max(width, base.width - left - right);
      }
    }
    return { width, height };
  });
}

/** Assert a control clears the shared 44px finger target (both dims, or height
 * only for controls whose width is legitimately elastic / text-driven). The 0.5
 * tolerance absorbs sub-pixel rounding. */
async function expectTapTarget(locator: Locator, dims: "both" | "height" = "both"): Promise<void> {
  const t = await effectiveTarget(locator);
  expect(t.height + 0.5).toBeGreaterThanOrEqual(TAP_MIN);
  if (dims === "both") expect(t.width + 0.5).toBeGreaterThanOrEqual(TAP_MIN);
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
  await seedTutorialDismissed(page.context());
});

test("Up Next @390: every check clears the floor and 6+ queue shows sit above the fold", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), continueShows(7));
  await page.setViewportSize(PHONE);
  await page.goto("/");

  // Marquee (56 check) + queue rows (48 checks): all real ≥44 targets.
  await expectTapTarget(page.getByTestId("marquee-card").getByTestId("mark-watched"));
  const cards = page.getByTestId("up-next-card");
  await expect(cards.first()).toBeVisible();
  await expectTapTarget(cards.first().getByTestId("mark-watched"));

  // The dense 76px rows put 6+ shows above the 844px fold (marquee included).
  let fullyVisible = 1; // the marquee's show
  const total = await cards.count();
  for (let i = 0; i < total; i++) {
    const b = await box(cards.nth(i));
    if (b.y >= 0 && b.y + b.height <= PHONE.height) fullyVisible += 1;
  }
  expect(fullyVisible).toBeGreaterThanOrEqual(6);

  // Tab bar items and the header avatar are real targets too.
  for (const id of ["tab-up-next", "tab-library", "tab-calendar", "tab-search"]) {
    await expectTapTarget(page.getByTestId(id), "height");
  }
  await expectTapTarget(page.getByTestId("avatar-link"));
  // The keyboard bypass link (revealed on focus) is a real 44px target.
  await expectTapTarget(page.locator(".skip-link"), "height");
});

test("the snackbar's Undo is a 44px target after a mark @390", async ({ page }) => {
  await installLibraryRoutes(page.context(), continueShows(3));
  await page.setViewportSize(PHONE);
  await page.goto("/");

  const card = page.getByTestId("up-next-card").first();
  await expect(card).toBeVisible();
  await card.getByTestId("mark-watched").click();

  const snackbar = page.getByTestId("snackbar");
  await expect(snackbar).toBeVisible();
  await expectTapTarget(page.getByTestId("snackbar-undo"), "height");
});

test("show-detail controls clear the 44px floor: back, overflow, checks, season rows", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.setViewportSize(PHONE);
  await page.goto("/show/1");
  await expect(page.getByTestId("detail-title")).toBeVisible();

  await expectTapTarget(page.getByTestId("detail-back"));
  await expectTapTarget(page.getByTestId("detail-overflow"));
  await expectTapTarget(page.getByTestId("continue-check"));

  // The season bulk check + the per-episode toggles (44px CheckControls with
  // ≥48px slop), and the season trigger row itself.
  const season1 = page.locator('[data-season="1"]');
  await expectTapTarget(season1.getByTestId("season-check"));
  await expectTapTarget(season1.getByTestId("season-trigger"), "height");
  const firstRowCheck = season1.getByTestId("episode-row").first().getByTestId("episode-check");
  await expect(firstRowCheck).toBeVisible();
  await expectTapTarget(firstRowCheck);
});

test("the episode sheet's mark, pager, and overflow are real targets @390", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.setViewportSize(PHONE);
  await page.goto("/show/1/episode/1/3");
  await expect(page.getByTestId("episode-sheet")).toBeVisible();

  await expectTapTarget(page.getByTestId("episode-sheet-check"));
  await expectTapTarget(page.getByTestId("episode-prev"), "height");
  await expectTapTarget(page.getByTestId("episode-next"), "height");
  await expectTapTarget(page.getByTestId("sheet-overflow"));
});

test("Library chrome clears the 44px floor @390: tools, segment, chips", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.setViewportSize(PHONE);
  await page.goto("/library");
  await expect(page.getByTestId("screen-library")).toBeVisible();

  await expectTapTarget(page.getByTestId("library-filter-toggle"));
  await expectTapTarget(page.getByTestId("library-sort"));
  // Segments + chips keep compact ink with vertical hit-slop to 44.
  await expectTapTarget(page.getByTestId("type-shows"), "height");
  await expectTapTarget(page.getByTestId("chip-watching"), "height");
  await expectTapTarget(page.getByTestId("chip-finished"), "height");

  await page.getByTestId("library-filter-toggle").click();
  await expectTapTarget(page.getByTestId("library-filter"), "height");
});

test("Calendar rows are real targets @390", async ({ page }) => {
  const item: CalendarEpisodeFixture = {
    showId: 1,
    showTitle: "Fixture Show",
    season: 1,
    number: 1,
    title: "An Episode",
    firstAired: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    traktId: 11,
  };
  await installCalendarRoutes(page.context(), [item]);
  await page.setViewportSize(PHONE);
  await page.goto("/calendar");

  const row = page.getByTestId("calendar-row").first();
  await expect(row).toBeVisible();
  await expectTapTarget(row, "height");
});

test("Settings switches keep compact ink with a 44px hit-slop; select rows are 44 tall", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("/settings");

  const sw = page.getByTestId("content-toggle-shows");
  await expect(sw).toBeVisible();
  // The visible track stays a deliberate ≤44 pill (keep the ink tiny)…
  const inkBox = await box(sw);
  expect(inkBox.height).toBeLessThan(TAP_MIN);
  // …but its slop pseudo-element gives the finger a real 44px target.
  await expectTapTarget(sw, "height");

  await expectTapTarget(page.getByTestId("threshold-select"), "height");
  await expectTapTarget(page.getByTestId("order-select"), "height");
  await expectTapTarget(page.getByTestId("sync-now"), "height");
  // The theme segments carry vertical slop to 44 within the 36px track.
  await expectTapTarget(page.getByTestId("theme-toggle").getByText("Dark"), "height");
});

test("History's checks, chips, and header tools clear the floor @390", async ({ page }) => {
  const rows: HistoryRowFixture[] = [
    {
      id: 11,
      type: "episode",
      showId: 100,
      showTitle: "The Bear",
      season: 1,
      number: 8,
      episodeTitle: "Braciole",
      watchedAt: agoIso(1),
    },
  ];
  await installHistoryRoutes(page.context(), rows);
  await page.setViewportSize(PHONE);
  await page.goto("/history");

  // The per-play removal check IS the consequential control here.
  const check = page.getByTestId("history-row").first().getByTestId("mark-watched");
  await expect(check).toBeVisible();
  await expectTapTarget(check);

  await expectTapTarget(page.getByRole("button", { name: "Back" }));
  await expectTapTarget(page.getByTestId("history-search-toggle"));
  await expectTapTarget(page.getByTestId("history-filter-all"), "height");
  await expectTapTarget(page.getByTestId("history-jump"), "height");
});

test("the 'Previously' checks on home clear the floor @390", async ({ page }) => {
  await installLibraryRoutes(page.context(), continueShows(1));
  const rows: HistoryRowFixture[] = [
    {
      id: 71,
      type: "episode",
      showId: 1,
      showTitle: "Continue Show 1",
      season: 1,
      number: 1,
      episodeTitle: "One",
      watchedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    },
  ];
  await installHistoryRoutes(page.context(), rows);
  await page.setViewportSize(PHONE);
  await page.goto("/");

  const check = page.getByTestId("previously-row").first().getByTestId("mark-watched");
  await expect(check).toBeVisible();
  await expectTapTarget(check);
});

test("Search's field and watchlist add clear the floor @390", async ({ page }) => {
  const HIT: SearchHitFixture = { type: "show", traktId: 1, title: "Severance", year: 2022 };
  await installSearchRoutes(page.context(), () => [HIT]);
  await page.setViewportSize(PHONE);
  await page.goto("/search");

  await expectTapTarget(page.getByTestId("search-input"), "height");
  await page.getByTestId("search-input").pressSequentially("severance", { delay: 40 });
  const add = page.getByTestId("search-add").first();
  await expect(add).toBeVisible();
  await expectTapTarget(add, "height");
});
