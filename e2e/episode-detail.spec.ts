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
const FUTURE = "2027-01-01T00:00:00.000Z";

function ep(
  season: number,
  number: number,
  firstAired: string,
  traktId: number,
  overview?: string,
): EpisodeFixture {
  return {
    season,
    number,
    title: `Episode ${number}`,
    firstAired,
    traktId,
    overview,
    stills: ["media.trakt.tv/still.webp"],
  };
}

/** Two watched episodes, an aired-unwatched next, and an unaired tail. Every
 * episode carrying a screenshot so the still + spoiler guard are exercised. */
function detailShow(): ShowFixture {
  return {
    trakt: 1,
    tmdb: 500,
    title: "The Detail Show",
    status: "returning series",
    posters: ["media.trakt.tv/p.webp"],
    lastWatchedAt: agoIso(2),
    aired: 3,
    completed: 2,
    episodes: [
      ep(1, 1, AIRED, 11, "The pilot introduces the premise."),
      ep(1, 2, AIRED, 12, "The second episode deepens the mystery."),
      ep(1, 3, AIRED, 13, "The third, aired but unwatched."),
      ep(1, 4, FUTURE, 14, "The fourth, not yet aired."),
    ],
  };
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("a deep link presents the route-backed sheet over the show detail", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1/episode/1/2");

  // The sheet is a presentation over the show page, not a separate page.
  const sheet = page.getByTestId("episode-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("screen-show-detail")).toBeAttached();

  // Quiet meta line + display title + clamped overview; the pill parade is dead.
  await expect(page.getByTestId("episode-detail-code")).toContainText("S1 E2");
  await expect(page.getByTestId("episode-detail-code")).toContainText("42 min");
  await expect(page.getByTestId("episode-detail-title")).toContainText("Episode 2");
  // The sheet stamps the full episode title and KEEPS it: the show page
  // beneath yields the title while the sheet is open, so its late-resolving
  // header read (a cold deep link races both) can never clobber it.
  await expect(page).toHaveTitle("The Detail Show · S1 E2 · Cue");
  await expect(page.getByTestId("episode-detail-overview")).toContainText("deepens the mystery");

  // A watched episode: clear still (no spoiler guard), watched mark row.
  await expect(page.getByTestId("episode-still")).toBeVisible();
  await expect(page.getByTestId("still-reveal")).toHaveCount(0);
  await expect(page.getByTestId("episode-mark-row")).toContainText("Watched");
  await expect(page.getByTestId("episode-sheet-check")).toHaveAttribute("data-state", "watched");

  // Footer pager targets the neighbors within the show.
  await expect(page.getByTestId("episode-prev")).toContainText("S1 E1");
  await expect(page.getByTestId("episode-next")).toContainText("S1 E3");
});

test("an unwatched episode's still is spoiler-blurred until revealed", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1/episode/1/3"); // aired, unwatched

  // Default pref ON: the still hides behind the reveal chip.
  const reveal = page.getByTestId("still-reveal");
  await expect(reveal).toBeVisible();
  await expect(reveal).toContainText("Tap to reveal");
  await expect(page.getByTestId("episode-still")).toHaveCount(0);

  // One tap reveals it for this episode.
  await reveal.click();
  await expect(page.getByTestId("episode-still")).toBeVisible();
  await expect(page.getByTestId("still-reveal")).toHaveCount(0);
});

test("marking from the sheet posts the play and flips the mark row", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1/episode/1/3");

  const check = page.getByTestId("episode-sheet-check");
  await expect(page.getByTestId("episode-mark-row")).toContainText("Not watched yet");
  await expect(check).toHaveAttribute("data-state", "unwatched");

  await check.click();
  await expect(check).toHaveAttribute("data-state", "watched"); // optimistic

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(13);
  await expect(page.getByTestId("episode-mark-row")).toContainText("Watched");
  await expect(page.getByTestId("episode-mark-row")).toContainText("tap the check to remove");
  // The one snackbar confirms with Undo; no gap here, so no backfill action.
  await expect(page.getByTestId("snackbar")).toContainText("The Detail Show S1 E3 marked");
  await expect(page.getByTestId("snackbar-action-backfill")).toHaveCount(0);
});

test("the snackbar's '+N earlier' backfill and Undo are tappable OVER the open sheet", async ({
  page,
}) => {
  // Only E1 watched → tapping E3 leaves E2 as the gap.
  const gappy: ShowFixture = { ...detailShow(), completed: 1 };
  const controls = await installLibraryRoutes(page.context(), [gappy]);
  // Hold writes open: the harness's linear watched counter can't represent a
  // gap once the out-of-order mark applies server-side, so the deferred
  // revalidate keeps the optimistic (gappy) tree the backfill computes from.
  controls.setWriteMode("delay");
  await page.goto("/show/1/episode/1/3");

  await page.getByTestId("episode-sheet-check").click();
  await expect(page.getByTestId("snackbar")).toContainText("S1 E3 marked");
  const backfill = page.getByTestId("snackbar-action-backfill");
  await expect(backfill).toHaveText("+1 earlier");
  await expect.poll(() => controls.historyPosts().length, { timeout: 15_000 }).toBe(1);

  // The snackbar sits ABOVE the sheet stack: accepting the backfill is a real
  // tap while the sheet is open. It must run the action and never fall through
  // to the scrim and dismiss the sheet.
  await backfill.click();
  await expect(page.getByTestId("snackbar")).toContainText("S1 E2-E3 marked");
  await expect(page.getByTestId("episode-sheet")).toBeVisible();
  await expect.poll(() => controls.historyPosts().length, { timeout: 15_000 }).toBe(2);
  expect(controls.historyPosts()[1]?.shows?.[0]?.seasons).toEqual([
    { number: 1, episodes: [{ number: 2 }] },
  ]);

  // Undo reverses the WHOLE absorbed delta, the tapped episode AND the gap,
  // again as a real tap over the sheet, and the sheet stays open.
  await page.getByTestId("snackbar-undo").click();
  await expect(page.getByTestId("episode-sheet")).toBeVisible();
  const removedEpisodes = (): number[] =>
    controls.removePosts().flatMap((w) => {
      const fromIds = (w.ids ?? []).map((id) => Math.floor(id / 10));
      // Season-1 subtree entries map to the fixture's trakt ids (S1 En → 10+n).
      const fromSeasons = (w.shows ?? [])
        .flatMap((s) => s.seasons ?? [])
        .flatMap((season) => (season.episodes ?? []).map((e) => 10 + e.number));
      return [...w.episodeIds, ...fromIds, ...fromSeasons];
    });
  await expect.poll(() => removedEpisodes().sort(), { timeout: 15_000 }).toEqual([12, 13]);
  // The sheet is still live: once the reversal lands (the held mark must settle
  // first) and the revalidate reads back, its check reads unwatched again.
  await expect(page.getByTestId("episode-sheet-check")).toHaveAttribute("data-state", "unwatched", {
    timeout: 10_000,
  });
});

test("unmarking a single-play episode removes exactly that play by history id", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1/episode/1/2");

  const check = page.getByTestId("episode-sheet-check");
  await expect(check).toHaveAttribute("data-state", "watched");
  await check.click();
  await expect(check).toHaveAttribute("data-state", "unwatched"); // optimistic

  await expect.poll(() => controls.removePosts().length).toBe(1);
  const removed = controls.removePosts()[0];
  // Per-play-safe: by the resolved history-event id (S1 E2 trakt 12 → play 121),
  // NOT an item-scoped `{episodes:[{ids}]}` body that would wipe every play.
  expect(removed?.ids).toEqual([121]);
  expect(removed?.episodeIds).toEqual([]);
  expect(removed?.episodeItemKeys).toBeUndefined();
  await expect(page.getByTestId("snackbar")).toContainText("Removed play");
});

test("a rewatched episode shows ×2, and a tap removes only the LATEST play", async ({ page }) => {
  const rewatch: ShowFixture = { ...detailShow(), rewatchedEpisodeIds: [12] };
  const controls = await installLibraryRoutes(page.context(), [rewatch]);
  await page.goto("/show/1/episode/1/2");

  const check = page.getByTestId("episode-sheet-check");
  await expect(check).toHaveAttribute("data-state", "watched");
  // The plays badge renders once the scoped-history read resolves two plays.
  await expect(check).toContainText("×2");
  await expect(page.getByTestId("episode-mark-row")).toContainText("Watched twice");

  await check.click();

  // Silent latest-play removal: play 122 goes, the check STAYS filled, and the
  // snackbar reads the honest remainder. Rewatch data is never wiped by one tap.
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.ids).toEqual([122]);
  await expect(page.getByTestId("snackbar")).toContainText("Removed 1 play · 1 remain");
  await expect(check).toHaveAttribute("data-state", "watched");
});

test("long-press (context menu) on a rewatched check offers Remove-all behind a danger confirm", async ({
  page,
}) => {
  const rewatch: ShowFixture = { ...detailShow(), rewatchedEpisodeIds: [12] };
  const controls = await installLibraryRoutes(page.context(), [rewatch]);
  await page.goto("/show/1/episode/1/2");

  const check = page.getByTestId("episode-sheet-check");
  await expect(check).toContainText("×2"); // plays resolved → menu knows the count
  // Desktop context-menu = the long-press equivalent (same sheet).
  await check.click({ button: "right" });

  await expect(page.getByTestId("menu-add-play")).toBeVisible();
  const removeAll = page.getByTestId("menu-remove-all");
  await expect(removeAll).toHaveText("Remove all 2 plays…");
  await removeAll.click();

  // The ConfirmSheet names the count; only its danger primary removes.
  await expect(page.getByText("Remove all plays?")).toBeVisible();
  await expect(
    page.getByText("S1 E2 has 2 plays. This removes both from your history."),
  ).toBeVisible();
  const primary = page.getByTestId("confirm-sheet-primary");
  await expect(primary).toHaveText("Remove 2 plays");
  await primary.click();

  // ALL plays go, by exact history ids.
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.ids).toEqual([121, 122]);
  await expect(page.getByTestId("snackbar")).toContainText("Removed 2 plays");
});

test("an unaired episode trades the still for a countdown and carries no check", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1/episode/1/4"); // future

  await expect(page.getByTestId("episode-sheet")).toBeVisible();
  await expect(page.getByTestId("episode-sheet")).toContainText("Airs");
  await expect(page.getByTestId("episode-sheet-check")).toHaveCount(0);
  await expect(page.getByTestId("episode-mark-row")).toHaveCount(0);
  await expect(page.getByTestId("still-reveal")).toHaveCount(0);
});

test("the footer pager swaps episodes in place (replace, no history stacking)", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  // The pager lives at the sheet's bottom; at the 65% opening detent it sits
  // below the fold on a short window (a finger drags to 92% there). A tall
  // viewport keeps the tap path in view without simulating the drag.
  await page.setViewportSize({ width: 900, height: 1500 });
  await page.goto("/show/1/episode/1/2");

  await page.getByTestId("episode-next").click();
  await expect(page.getByTestId("episode-detail-code")).toContainText("S1 E3");
  await expect(page).toHaveURL(/\/show\/1\/episode\/1\/3$/);

  await page.getByTestId("episode-prev").click();
  await expect(page.getByTestId("episode-detail-code")).toContainText("S1 E2");
  await expect(page).toHaveURL(/\/show\/1\/episode\/1\/2$/);

  // At the show's first episode, prev is disabled: no dead navigation.
  await page.getByTestId("episode-prev").click();
  await expect(page.getByTestId("episode-detail-code")).toContainText("S1 E1");
  await expect(page.getByTestId("episode-prev")).toBeDisabled();
});

test("closing the sheet returns to the show page beneath it", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);

  // Opened from the show page (continue bar body): close pops back to it.
  await page.goto("/show/1");
  await page.getByTestId("continue-episode-link").click();
  await expect(page.getByTestId("episode-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/show\/1\/episode\/1\/3$/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("episode-sheet")).toHaveCount(0);
  await expect(page).toHaveURL(/\/show\/1$/);
  await expect(page.getByTestId("detail-title")).toBeVisible();

  // A cold deep link has no page beneath: close replaces to the show URL.
  await page.goto("/show/1/episode/1/2");
  await expect(page.getByTestId("episode-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("episode-sheet")).toHaveCount(0);
  await expect(page).toHaveURL(/\/show\/1$/);
});

test("the sheet overflow offers Add-another-play (watched only) and the Trakt hand-off", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);

  // Unwatched: no add-play row, just the Trakt link.
  await page.goto("/show/1/episode/1/3");
  await page.getByTestId("sheet-overflow").click();
  await expect(page.getByTestId("sheet-overflow-trakt")).toBeVisible();
  await expect(page.getByTestId("sheet-overflow-add-play")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Watched: the deliberate rewatch increment, message-only (no Undo: fresh
  // plays have no history id to reverse yet).
  await page.goto("/show/1/episode/1/2");
  await expect(page.getByTestId("episode-sheet-check")).toHaveAttribute("data-state", "watched");
  await page.getByTestId("sheet-overflow").click();
  await page.getByTestId("sheet-overflow-add-play").click();
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(12);
  await expect(page.getByTestId("snackbar")).toContainText("Play added");
  await expect(page.getByTestId("snackbar-undo")).toHaveCount(0);
});

test("a details-light episode still renders and the check still works", async ({ page }) => {
  const show = detailShow();
  const noOverview: ShowFixture = {
    ...show,
    episodes: show.episodes.map((e) =>
      e.number === 3 ? { ...e, overview: undefined, stills: undefined } : e,
    ),
  };
  const controls = await installLibraryRoutes(page.context(), [noOverview]);
  await page.goto("/show/1/episode/1/3");

  // No overview and no still → the content simply moves up; never a broken box.
  await expect(page.getByTestId("episode-detail-title")).toContainText("Episode 3");
  await expect(page.getByTestId("episode-detail-overview")).toHaveCount(0);
  await expect(page.getByTestId("still-reveal")).toHaveCount(0);
  await expect(page.getByTestId("episode-still")).toHaveCount(0);

  await page.getByTestId("episode-sheet-check").click();
  await expect.poll(() => controls.historyPosts().length).toBe(1);
});
