import { expect, type Locator, test } from "@playwright/test";
import {
  agoIso,
  type CalendarEpisodeFixture,
  type EpisodeFixture,
  type HistoryRowFixture,
  installCalendarRoutes,
  installDiscoverRoutes,
  installHermeticRoutes,
  installHistoryRoutes,
  installLibraryRoutes,
  type ShowFixture,
  seedAuth,
} from "./helpers";

/** The Cue touch-target floor (`--tap-min`): WCAG 2.5.5 / Apple HIG 44pt. */
const TAP_MIN = 44;
/** A common small phone — the primary audit viewport. */
const PHONE = { width: 390, height: 844 } as const;
const AIRED = "2026-01-01T00:00:00.000Z";

function ep(season: number, number: number, traktId: number, firstAired = AIRED): EpisodeFixture {
  return { season, number, title: `Episode ${number}`, firstAired, traktId };
}

/** A run of in-progress "Continue" shows, each with an aired next episode to queue. */
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

/** A partially-watched show for the detail-screen controls (rating, specials, season mark). */
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

/** Assert a control clears the shared 44px finger target (both dims, or height only
 * for controls whose width is legitimately elastic / text-driven). The 0.5 tolerance
 * absorbs sub-pixel rounding of a `min-height: 44px` box. */
async function expectTapTarget(locator: Locator, dims: "both" | "height" = "both"): Promise<void> {
  const b = await box(locator);
  expect(b.height + 0.5).toBeGreaterThanOrEqual(TAP_MIN);
  if (dims === "both") expect(b.width + 0.5).toBeGreaterThanOrEqual(TAP_MIN);
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("Up Next @390 clears more of the fold — compact inline mark, not a full-width CTA", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), continueShows(6));
  await page.setViewportSize(PHONE);
  await page.goto("/");

  const cards = page.getByTestId("up-next-card");
  await expect(cards.first()).toBeVisible();
  await expect(cards).toHaveCount(6);

  // Count cards FULLY above the 844px fold. The legacy full-width-action layout
  // left only 3 fully visible (measurements.json upNext_390.episodeCards); dropping the
  // action to a compact trailing pill roughly halves card height, so strictly more of
  // the queue clears the fold.
  let fullyVisible = 0;
  const total = await cards.count();
  for (let i = 0; i < total; i++) {
    const b = await box(cards.nth(i));
    if (b.y >= 0 && b.y + b.height <= PHONE.height) fullyVisible += 1;
  }
  expect(fullyVisible).toBeGreaterThanOrEqual(4);

  // The lead's mark is an inline trailing pill (far narrower than the card), not the
  // old full-width CTA, and still clears the 44px target.
  const lead = cards.first();
  const cardBox = await box(lead);
  const markBox = await box(lead.getByTestId("mark-watched"));
  expect(markBox.width).toBeLessThan(cardBox.width * 0.5);
  expect(markBox.height + 0.5).toBeGreaterThanOrEqual(TAP_MIN);
  // Compaction: a card is now well under the legacy 188px height.
  expect(cardBox.height).toBeLessThan(150);
});

test("header avatar is a 44×44 finger target @390", async ({ page }) => {
  await installLibraryRoutes(page.context(), continueShows(1));
  await page.setViewportSize(PHONE);
  await page.goto("/");

  const topbar = page.locator(".topbar");
  // Search moved onto the Discover tab; the header now carries only the Profile
  // avatar (utility hub) beside the brand — both real finger targets.
  await expectTapTarget(topbar.getByRole("link", { name: "Profile" }));
  // The brand-home link keeps its compact wordmark but a full-height tap target.
  await expectTapTarget(topbar.getByRole("link", { name: "Cue home" }), "height");
  // The keyboard bypass link (revealed on focus) is a real 44px target too.
  await expectTapTarget(page.locator(".skip-link"), "height");
});

test("show-detail controls clear the 44px floor: rating track, back, specials, season mark", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.setViewportSize(PHONE);
  await page.goto("/show/1");
  await expect(page.getByTestId("detail-title")).toBeVisible();

  await expectTapTarget(page.getByTestId("detail-back"), "height");

  // Rating: the control is ONE wide slider track, not ten sub-44px stars
  // (ten 44px stars would need 440px — wider than a phone). The whole track is a single
  // ≥44px finger target a tap lands anywhere on, carrying role=slider for AT.
  const slider = page.getByTestId("show-rating-slider");
  await expect(slider).toHaveAttribute("role", "slider");
  await expectTapTarget(slider, "height");

  // "Include specials" — the whole label is the 44-tall target, not its 13px box.
  await expectTapTarget(page.locator(".detail-specials"), "height");

  // "Stop watching" — a consequential action (drops the show from Up Next + calendar).
  await expectTapTarget(page.getByTestId("hide-show"), "height");

  // The show-level "Up next" module (aired next episode): the primary mark and the
  // always-visible catch-up are both 44 tall (the touch path to "mark up to here").
  await expectTapTarget(page.getByTestId("next-up-mark"), "height");
  await expectTapTarget(page.getByTestId("next-up-catchup"), "height");

  // The per-season "Mark season watched" action.
  await expectTapTarget(page.locator('[data-season="1"]').getByTestId("mark-season"), "height");

  // Expand a season: the per-episode watched toggle — the primary "mark unwatched"
  // affordance — is a full 44×44 target (BOTH dims: a square check on the still, not a
  // text button), with the visible badge kept compact so a 158px still isn't swallowed.
  await page.locator('[data-season="1"]').getByTestId("season-trigger").click();
  const toggle = page
    .locator('[data-season="1"]')
    .getByTestId("episode-row")
    .first()
    .locator(".ep-still__toggle");
  await expect(toggle).toBeVisible();
  await expectTapTarget(toggle, "both");
});

test("Library chrome clears the 44px floor @390", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.setViewportSize(PHONE);
  await page.goto("/library");
  await expect(page.getByTestId("screen-library")).toBeVisible();

  await expectTapTarget(page.getByTestId("type-shows"), "height");
  await expectTapTarget(page.getByTestId("library-filter"), "height");
  await expectTapTarget(page.getByTestId("sort-select"), "height");
});

test("Calendar range toggles are 44px targets @390", async ({ page }) => {
  const item: CalendarEpisodeFixture = {
    showId: 1,
    showTitle: "Fixture Show",
    season: 1,
    number: 1,
    title: "An Episode",
    firstAired: agoIso(0),
    traktId: 11,
  };
  await installCalendarRoutes(page.context(), [item]);
  await page.setViewportSize(PHONE);
  await page.goto("/calendar");

  await expect(page.getByTestId("window-7")).toBeVisible();
  await expectTapTarget(page.getByTestId("window-7"), "height");
  await expectTapTarget(page.getByTestId("window-14"), "height");
});

test("Settings switch keeps its compact ink but a 44px hit-slop; threshold select is 44 tall", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("/settings");

  const sw = page.getByTestId("content-toggle-shows");
  await expect(sw).toBeVisible();
  // The visible track stays a deliberate ≤44 pill (keep the ink tiny)…
  const inkBox = await box(sw);
  expect(inkBox.height).toBeLessThan(TAP_MIN);
  // …but its centred ::before pseudo-element gives the finger a real 44px target.
  const slopHeight = await sw.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el, "::before").height),
  );
  expect(slopHeight).toBeGreaterThanOrEqual(TAP_MIN);

  await expectTapTarget(page.getByTestId("threshold-select"), "height");
});

test("watch-history remove is a 44px target @390", async ({ page }) => {
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

  // The row's trailing ⋯ (which opens the confirm sheet) is the consequential
  // control that must be a full finger target.
  const remove = page.getByTestId("history-remove-menu").first();
  await expect(remove).toBeVisible();
  await expectTapTarget(remove, "height");
});

test("Search watchlist add is a 44px target @390", async ({ page }) => {
  await installDiscoverRoutes(page.context(), {
    shows: [{ traktId: 1, title: "Severance", year: 2022 }],
    movies: [],
  });
  await page.setViewportSize(PHONE);
  await page.goto("/search");

  const add = page.getByTestId("search-add").first();
  await expect(add).toBeVisible();
  await expectTapTarget(add, "height");
});

test("Up Next reversal toast: Undo + dismiss are 44px targets after a mark @390", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), continueShows(3));
  await page.setViewportSize(PHONE);
  await page.goto("/");

  const lead = page.getByTestId("up-next-card").first();
  await expect(lead).toBeVisible();
  await lead.getByTestId("mark-watched").click();

  // Reversibility is the crux of the honest mark: the Undo toast's action must be a
  // real finger target (was 38×22), and its "×" dismiss a full 44×44 square (a glyph
  // has no elastic text width, so BOTH dims are asserted; was 13×19).
  const toast = page.getByTestId("undo");
  await expect(toast).toBeVisible();
  await expectTapTarget(toast.getByTestId("undo-action"), "height");
  await expectTapTarget(toast.getByTestId("undo-dismiss"), "both");
});

test("Episode detail: the back link is a 44px target @390", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.setViewportSize(PHONE);
  await page.goto("/show/1/episode/1/3");
  await expect(page.getByTestId("episode-back")).toBeVisible();

  // Shares the `.detail-back` treatment as the show-detail back link.
  await expectTapTarget(page.getByTestId("episode-back"), "height");
  // The episode Cue mark (mark/unmark): a full-width labelled button that is itself
  // the target, so measure the `.watched-field` button directly.
  await expectTapTarget(page.locator(".watched-field"), "height");

  // NOTE: `.episode-hero__show` (the "THE DETAIL SHOW" eyebrow link) is deliberately
  // NOT asserted at 44px. It is an inline link inside the running eyebrow sentence
  // ("<show> · Season N"), which WCAG 2.5.8's Inline exception exempts, and the 44px
  // "‹ <show>" back link above is its Equivalent to the same destination. Forcing a
  // 44px block there would break the sentence flow the standard itself carves out.
});
