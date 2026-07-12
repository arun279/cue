import { expect, test } from "@playwright/test";
import {
  agoIso,
  type EpisodeFixture,
  installHermeticRoutes,
  installLibraryRoutes,
  readStored,
  type ShowFixture,
  seedAuth,
  seededBulkOp,
  seededHideOp,
  seedOpLog,
} from "./helpers";

const AIRED = "2026-01-01T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";

function ep(season: number, number: number, firstAired: string, traktId: number): EpisodeFixture {
  return { season, number, title: `Episode ${number}`, firstAired, traktId };
}

/**
 * A show with a fully-aired Season 1, a partially-aired Season 2 (S2 E4/E5
 * unaired), and an aired Specials season. Episodes are in watch order so the
 * fixture's linear `completed` counter maps to consistent per-episode watched
 * flags. `completed` = 2 keeps it in Up Next with next = S1 E3 (id 13).
 */
function detailShow(overrides: Partial<ShowFixture> = {}): ShowFixture {
  return {
    trakt: 1,
    tmdb: 500,
    title: "The Detail Show",
    status: "returning series",
    posters: ["media.trakt.tv/p.webp"],
    backdrops: ["media.trakt.tv/b.webp"],
    overview: "A show built for testing the detail screen.",
    network: "Testnet",
    lastWatchedAt: agoIso(2),
    aired: 7,
    completed: 2,
    episodes: [
      ep(1, 1, AIRED, 11),
      ep(1, 2, AIRED, 12),
      ep(1, 3, AIRED, 13),
      ep(1, 4, AIRED, 14),
      ep(2, 1, AIRED, 21),
      ep(2, 2, AIRED, 22),
      ep(2, 3, AIRED, 23),
      ep(2, 4, FUTURE, 24),
      ep(2, 5, FUTURE, 25),
      ep(0, 1, AIRED, 91),
    ],
    ...overrides,
  };
}

/**
 * A show whose Season 1 is fully watched, with S1 E1 watched TWICE (a rewatch).
 * Durable unmark paths must keep the rewatched episode's plays intact.
 */
function rewatchShow(): ShowFixture {
  return {
    trakt: 2,
    tmdb: 501,
    title: "The Rewatch Show",
    status: "returning series",
    posters: ["media.trakt.tv/p.webp"],
    lastWatchedAt: agoIso(2),
    aired: 3,
    completed: 3,
    rewatchedEpisodeIds: [201],
    episodes: [ep(1, 1, AIRED, 201), ep(1, 2, AIRED, 202), ep(1, 3, AIRED, 203)],
  };
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

function season(page: import("@playwright/test").Page, n: number) {
  return page.locator(`[data-season="${n}"]`);
}

async function expandSeason(page: import("@playwright/test").Page, n: number): Promise<void> {
  await season(page, n).getByTestId("season-trigger").click();
}

/** An episode row within a season panel, by its display title. */
function episodeRow(page: import("@playwright/test").Page, seasonNumber: number, title: string) {
  return season(page, seasonNumber).getByTestId("episode-row").filter({ hasText: title });
}

test("detail Back retraces the entry point, and falls back to Library on a direct load", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [detailShow()]);

  // Entered from Library → history-aware Back returns to Library.
  await page.goto("/library");
  await page.getByTestId("library-card").first().click();
  await expect(page.getByTestId("detail-title")).toContainText("The Detail Show");
  await page.getByTestId("detail-back").click();
  await expect(page.getByTestId("screen-library")).toBeVisible();
  await expect(page).toHaveURL(/\/library$/);

  // A direct load has no in-app history to pop → Back is the labelled fallback link.
  await page.goto("/show/1");
  await expect(page.getByTestId("detail-title")).toContainText("The Detail Show");
  await page.getByTestId("detail-back").click();
  await expect(page.getByTestId("screen-library")).toBeVisible();
});

test("renders the hero, continue bar, seasons accordion (Specials last), and About", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await expect(page.getByTestId("detail-title")).toContainText("The Detail Show");
  await expect(page).toHaveTitle("The Detail Show · Cue");
  await expect(page.getByTestId("hero-backdrop")).toBeVisible();
  await expect(page.getByTestId("screen-show-detail")).toContainText("Testnet");
  await expect(page.getByTestId("detail-overview")).toBeVisible();

  // The continue bar carries the next episode + honest series progress.
  const bar = page.getByTestId("continue-bar");
  await expect(bar).toHaveAttribute("data-variant", "next");
  await expect(bar).toContainText("S1 E3");
  await expect(bar).toContainText("2 of 7 watched · 5 left");
  await expect(bar.getByTestId("continue-check")).toHaveAttribute("data-state", "unwatched");

  // Season 1, Season 2, then Specials LAST (never first).
  const panels = page.getByTestId("season-panel");
  await expect(panels).toHaveCount(3);
  await expect(panels.nth(0)).toHaveAttribute("data-season", "1");
  await expect(panels.nth(1)).toHaveAttribute("data-season", "2");
  await expect(panels.nth(2)).toHaveAttribute("data-season", "0");

  // The current season (the next episode's) is auto-expanded: its rows are
  // mounted; watched rows read done (dimmed + filled check), unwatched hollow.
  await expect(season(page, 1).getByTestId("season-count")).toHaveText("2/4");
  await expect(episodeRow(page, 1, "Episode 2").getByTestId("episode-check")).toHaveAttribute(
    "data-state",
    "watched",
  );
  await expect(episodeRow(page, 1, "Episode 3").getByTestId("episode-check")).toHaveAttribute(
    "data-state",
    "unwatched",
  );

  // Season 2's unaired episodes carry a micro date chip, never a check.
  await expandSeason(page, 2);
  const unaired = episodeRow(page, 2, "Episode 4");
  await expect(unaired.getByTestId("episode-unaired")).toBeVisible();
  await expect(unaired.getByTestId("episode-check")).toHaveCount(0);
});

test("a mark from Up Next refreshes this show's detail progress: and it survives a reload", async ({
  page,
}) => {
  // The regression: marking from Up Next advanced the queue but left the
  // show-detail continue bar and season ticks reading the PRE-mark cache.
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/");

  const card = page.getByTestId("up-next-card").first();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");

  // Visit the show detail first so its caches hold the pre-mark state.
  await card.getByRole("link", { name: "The Detail Show" }).click();
  await expect(page.getByTestId("continue-bar")).toContainText("2 of 7 watched · 5 left");
  await expect(page.getByTestId("continue-bar")).toContainText("S1 E3");
  const e3check = episodeRow(page, 1, "Episode 3").getByTestId("episode-check");
  await expect(e3check).toHaveAttribute("data-state", "unwatched");

  // Back to Up Next (client-side) and mark S1 E3 (id 13); let the write land.
  await page.getByTestId("detail-back").click();
  await card.getByTestId("mark-watched").click();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E4");
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  await expect.poll(async () => await readStored(page, "cue.write-queue")).toBe("[]");

  // Re-open the detail over the now-stale in-memory cache: the continue bar
  // (3/7, next S1 E4) and the season tick must reflect the new progress.
  await card.getByRole("link", { name: "The Detail Show" }).click();
  await expect(page.getByTestId("continue-bar")).toContainText("3 of 7 watched · 4 left");
  await expect(page.getByTestId("continue-bar")).toContainText("S1 E4");
  await expect(e3check).toHaveAttribute("data-state", "watched");

  // Durable across a full reload: the persisted show-detail cache is corrected.
  await page.reload();
  await expect(page.getByTestId("continue-bar")).toContainText("3 of 7 watched · 4 left");
  await expect(page.getByTestId("continue-bar")).toContainText("S1 E4");
  await expect(e3check).toHaveAttribute("data-state", "watched");
  expect(await readStored(page, "cue.write-queue")).toBe("[]");
});

test("the continue-bar check runs the queue pipeline: optimistic advance + snackbar Undo", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");
  const bar = page.getByTestId("continue-bar");
  await expect(bar).toContainText("S1 E3");

  // The tracked entry drives the queue pipeline (advance-mode check), not the
  // untracked fallback: wait for the library snapshot to land first.
  const check = bar.getByTestId("continue-check");
  await expect(check).toHaveAttribute("data-mode", "advance");
  await check.click();

  // The bar advances in place, the one snackbar confirms, and the play lands.
  await expect(bar).toContainText("S1 E4");
  await expect(page.getByTestId("snackbar")).toContainText("The Detail Show S1 E3 marked");
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(13);
  await expect.poll(async () => await readStored(page, "cue.write-queue")).toBe("[]");

  // Undo removes exactly the play the mark created (by history id) and the bar
  // settles back on S1 E3.
  await page.getByTestId("snackbar-undo").click();
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.ids).toEqual([131]);
  await expect(bar).toContainText("S1 E3");
});

test("the season check opens the bulk ConfirmSheet with exact counts; confirming fires ONE batched POST", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  // Season 2: 3 aired, none watched → the all-unwatched copy.
  await season(page, 2).getByTestId("season-check").click();
  await expect(page.getByText("Mark Season 2 watched?")).toBeVisible();
  await expect(page.getByText("3 episodes will be added to your history.")).toBeVisible();
  const primary = page.getByTestId("confirm-sheet-primary");
  await expect(primary).toHaveText("Mark 3 episodes");
  await primary.click();

  // ONE batched POST enumerating only the aired episodes: never unaired, never
  // a bare season token, never specials.
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 2, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] },
  ]);
  // The snackbar states the season outcome with an Undo.
  await expect(page.getByTestId("snackbar")).toContainText("Season 2 marked · 3 episodes");
});

test("bulk marks are optimistic: episodes check before the write settles", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  controls.setWriteMode("delay"); // hold the POST open so the check can't depend on it
  await page.goto("/show/1");
  await expandSeason(page, 2);

  const s2e1 = episodeRow(page, 2, "Episode 1").getByTestId("episode-check");
  await expect(s2e1).toHaveAttribute("data-state", "unwatched");

  await season(page, 2).getByTestId("season-check").click();
  await page.getByTestId("confirm-sheet-primary").click();
  await expect(s2e1).toHaveAttribute("data-state", "watched");
});

test("a partially-watched season confirms with rewatch-safe copy and marks only the delta", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  // Season 1: 2 of 4 watched → the rewatch-safe partial copy.
  const season1 = season(page, 1);
  await expect(season1.getByTestId("season-count")).toHaveText("2/4");
  await season1.getByTestId("season-check").click();
  await expect(page.getByText("Mark Season 1 watched?")).toBeVisible();
  await expect(page.getByText("2 of 4 episodes are unwatched.")).toBeVisible();
  await expect(page.getByTestId("confirm-sheet-primary")).toHaveText("Mark 2 remaining");
  await expect(page.getByTestId("confirm-sheet-rewatch")).toHaveText("Mark all 4 again (rewatch)");

  // "Mark 2 remaining" logs ONLY the unwatched delta (E3/E4): the watched E1/E2
  // are never re-logged (no duplicate plays).
  await page.getByTestId("confirm-sheet-primary").click();
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 1, episodes: [{ number: 3 }, { number: 4 }] },
  ]);
  await expect(season1.getByTestId("season-count")).toHaveText("4/4");
  await expect(season1.getByTestId("season-check")).toHaveAttribute("data-state", "watched");

  // Undo removes EXACTLY that delta; the pre-existing E1/E2 plays stay intact,
  // so the season returns to 2/4, NEVER 0/4.
  await page.getByTestId("snackbar-undo").click();
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 1, episodes: [{ number: 3 }, { number: 4 }] },
  ]);
  await expect(season1.getByTestId("season-count")).toHaveText("2/4");
  await expect(episodeRow(page, 1, "Episode 1").getByTestId("episode-check")).toHaveAttribute(
    "data-state",
    "watched",
  );
});

test("the rewatch secondary re-marks every aired episode with a message-only snack (no Undo)", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await season(page, 1).getByTestId("season-check").click();
  await page.getByTestId("confirm-sheet-rewatch").click();

  // Every aired episode is enumerated: the deliberate rewatch adds plays over
  // the watched ones.
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 1, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }] },
  ]);
  // Fresh rewatch plays have no history ids to reverse yet: message-only, no Undo.
  await expect(page.getByTestId("snackbar")).toContainText("Season 1 marked again · 4 episodes");
  await expect(page.getByTestId("snackbar-undo")).toHaveCount(0);
});

test("unmarking a complete season confirms as danger and keeps rewatched plays intact", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [rewatchShow()]);
  await page.goto("/show/2");

  const season1 = season(page, 1);
  await expect(season1.getByTestId("season-check")).toHaveAttribute("data-state", "watched");
  await season1.getByTestId("season-check").click();

  await expect(page.getByText("Unmark Season 1?")).toBeVisible();
  await expect(page.getByText("Removes 3 episodes from your history.")).toBeVisible();
  const primary = page.getByTestId("confirm-sheet-primary");
  await expect(primary).toHaveText("Remove 3 episodes");
  await primary.click();

  // Removed by EXACT per-play history ids, single plays only: E2 (2021) and E3
  // (2031). The rewatched E1's two plays are untouchable by a season unmark.
  await expect.poll(() => controls.removePosts().length).toBe(1);
  const removed = controls.removePosts()[0];
  expect(removed?.ids).toEqual([2021, 2031]);
  expect(removed?.ids).not.toContain(2011);
  expect(removed?.ids).not.toContain(2012);
  await expect(page.getByTestId("snackbar")).toContainText("Season 1 unmarked");
  // The rewatched episode stays ticked; the single-play episodes un-ticked.
  await expandSeason(page, 1);
  await expect(episodeRow(page, 1, "Episode 1").getByTestId("episode-check")).toHaveAttribute(
    "data-state",
    "watched",
  );
  await expect(episodeRow(page, 1, "Episode 2").getByTestId("episode-check")).toHaveAttribute(
    "data-state",
    "unwatched",
  );
});

test("a per-episode mark with a gap offers the dual-action '+N earlier' backfill", async ({
  page,
}) => {
  // Season 1 fully watched (completed 4): tapping S2 E3 leaves S2 E1/E2 as the gap.
  const controls = await installLibraryRoutes(page.context(), [detailShow({ completed: 4 })]);
  // Hold writes open: the harness's linear watched counter can't represent a
  // gap once the out-of-order mark applies server-side, so the deferred
  // revalidate keeps the optimistic (gappy) tree the backfill computes from.
  controls.setWriteMode("delay");
  await page.goto("/show/1");
  await expandSeason(page, 2);

  await episodeRow(page, 2, "Episode 3").getByTestId("episode-check").click();

  // The single mark fires immediately (episodes body, id 23)…
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toEqual([23]);
  // …and the snackbar carries the dual action: `+2 earlier` · `Undo`.
  await expect(page.getByTestId("snackbar")).toContainText("S2 E3 marked");
  const backfill = page.getByTestId("snackbar-action-backfill");
  await expect(backfill).toHaveText("+2 earlier");

  // Accepting marks the gap through the season pipeline: the snackbar
  // re-labels to the whole range, the gap ticks optimistically, and ONE bulk
  // POST follows the held single mark through the queue.
  await backfill.click();
  await expect(page.getByTestId("snackbar")).toContainText("S2 E1–E3 marked");
  // The gap ticks optimistically: the season header count completes.
  await expect(season(page, 2).getByTestId("season-count")).toHaveText("3/3");
  await expect.poll(() => controls.historyPosts().length, { timeout: 15_000 }).toBe(2);
  expect(controls.historyPosts()[1]?.shows?.[0]?.seasons).toEqual([
    { number: 2, episodes: [{ number: 1 }, { number: 2 }] },
  ]);

  // Undo reverses the WHOLE absorbed delta — the tapped episode AND the gap —
  // whatever mix of remove bodies (per-play ids / enumerated episodes / season
  // subtrees) the reversal machinery routes them through.
  await page.getByTestId("snackbar-undo").click();
  const removedEpisodes = (): number[] =>
    controls.removePosts().flatMap((w) => {
      const fromIds = (w.ids ?? []).map((id) => Math.floor(id / 10));
      // Season-2 subtree entries map to the fixture's trakt ids (S2 En → 20+n).
      const fromSeasons = (w.shows ?? [])
        .flatMap((s) => s.seasons ?? [])
        .flatMap((season) => (season.episodes ?? []).map((e) => 20 + e.number));
      return [...w.episodeIds, ...fromIds, ...fromSeasons];
    });
  await expect.poll(() => removedEpisodes().sort(), { timeout: 15_000 }).toEqual([21, 22, 23]);
});

test("a gap-free per-episode mark confirms with a plain Undo: no backfill action", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow({ completed: 4 })]);
  await page.goto("/show/1");
  await expandSeason(page, 2);

  await episodeRow(page, 2, "Episode 1").getByTestId("episode-check").click();

  await expect(page.getByTestId("snackbar")).toContainText("The Detail Show S2 E1 marked");
  await expect(page.getByTestId("snackbar-action-backfill")).toHaveCount(0);
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toEqual([21]);
});

test("unchecking one settled episode removes only its play by history id: never an item-scoped wipe", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  // S1 E2 is the last watched episode (completed=2).
  const e2 = episodeRow(page, 1, "Episode 2").getByTestId("episode-check");
  await expect(e2).toHaveAttribute("data-state", "watched");
  await e2.click();
  await expect(e2).toHaveAttribute("data-state", "unwatched"); // optimistic

  await expect.poll(() => controls.removePosts().length).toBe(1);
  const removed = controls.removePosts()[0];
  expect(removed?.ids).toEqual([121]); // S1 E2 trakt 12 → play 121, by history id
  expect(removed?.episodeIds).toEqual([]); // never `{episodes:[{ids}]}`
  await expect(page.getByTestId("snackbar")).toContainText("Removed play");
});

test("unchecking a REWATCHED episode removes only the latest play; the check stays filled", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [rewatchShow()]);
  await page.goto("/show/2");

  const e1 = episodeRow(page, 1, "Episode 1").getByTestId("episode-check");
  await expect(e1).toHaveAttribute("data-state", "watched");
  await e1.click();

  // The silent latest-play removal: only play 2012 (the rewatch) goes; the
  // original play survives, the check settles back filled, and the snackbar
  // reads the honest remainder.
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.ids).toEqual([2012]);
  await expect(page.getByTestId("snackbar")).toContainText("Removed 1 play — 1 remain");
  await expect(e1).toHaveAttribute("data-state", "watched");
});

test("a double activation on the confirm primary fires exactly one bulk POST", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await season(page, 2).getByTestId("season-check").click();
  // Two synchronous activations before React re-renders: the season in-flight
  // guard must drop the second before it enqueues a second bulk op.
  await page.getByTestId("confirm-sheet-primary").evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  await page.waitForTimeout(2000);
  expect(controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 2, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] },
  ]);
});

test("a network-dropped season mark reconciles via progress, never a blind re-POST", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  controls.setWriteMode("network-drop"); // reaches Trakt (applies), response lost
  await page.goto("/show/1");
  const readsBefore = controls.progressReads();

  await season(page, 2).getByTestId("season-check").click();
  await page.getByTestId("confirm-sheet-primary").click();

  // The single dropped POST is reconciled away (progress shows it landed); the
  // queue re-reads progress rather than re-POSTing the bulk history (no dup plays).
  await expect.poll(() => controls.progressReads()).toBeGreaterThan(readsBefore);
  await page.waitForTimeout(1500);
  expect(controls.historyPosts().length).toBe(1);
});

test("a bulk op that already landed is reconciled away on reload, never re-POSTed", async ({
  page,
}) => {
  // The fixture already reflects Season 2 watched (completed past the mark), as if
  // a prior session's bulk POST applied but its response was lost before retire.
  const landed = detailShow({ completed: 7 });
  await seedOpLog(page.context(), [
    seededBulkOp({ showId: 1, season: 2, preCompleted: 2, watchedAt: AIRED }),
  ]);
  const controls = await installLibraryRoutes(page.context(), [landed]);
  await page.goto("/show/1");

  await expect(page.getByTestId("detail-title")).toBeVisible();
  await page.waitForTimeout(1500);
  // Startup reconcile retires the applied op instead of replaying it → no dup plays.
  expect(controls.historyPosts().length).toBe(0);
});

test("a hide op that already landed is reconciled away on reload, never re-POSTed", async ({
  page,
}) => {
  const alreadyHidden = detailShow({ hidden: true });
  await seedOpLog(page.context(), [seededHideOp(1)]);
  const controls = await installLibraryRoutes(page.context(), [alreadyHidden]);
  await page.goto("/show/1");

  await expect(page.getByTestId("detail-title")).toBeVisible();
  // Direct load: the overflow still resolves the hidden state, so the action
  // offers recovery instead of re-stopping an already-stopped show.
  await page.getByTestId("detail-overflow").click();
  await expect(page.getByTestId("overflow-stop")).toHaveText("Resume show");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  // The hidden-set read shows the op landed; it's retired, not blindly re-POSTed.
  expect(controls.hiddenPosts().length).toBe(0);
});

test("Stop show drops it from Up Next and moves it to the Library Stopped chip", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);

  await page.goto("/");
  await expect(page.getByTestId("up-next-card").filter({ hasText: "The Detail Show" })).toHaveCount(
    1,
  );

  await page.goto("/show/1");
  await page.getByTestId("detail-overflow").click();
  await expect(page.getByTestId("overflow-stop")).toHaveText("Stop show");
  await page.getByTestId("overflow-stop").click();
  await expect(page.getByTestId("snackbar")).toContainText("The Detail Show stopped");

  await expect.poll(() => controls.hiddenPosts().length).toBe(1);
  expect(controls.hiddenPosts()[0]?.showIds).toContain(1);

  // Gone from the aired-only Up Next queue (client-side hidden exclusion).
  await page.goto("/");
  await expect(page.getByTestId("up-next-card")).toHaveCount(0);

  // Present under the Library's Stopped chip.
  await page.goto("/library");
  await page.getByTestId("chip-stopped").click();
  await expect(page.getByTestId("library-card").filter({ hasText: "The Detail Show" })).toHaveCount(
    1,
  );
});

test("Stop show is reversible: the snackbar Undo clears the hidden set", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await page.getByTestId("detail-overflow").click();
  await page.getByTestId("overflow-stop").click();
  await expect.poll(() => controls.hiddenPosts().length).toBe(1);

  // Undo submits the inverse (unhide remove) and the action flips back.
  await page.getByTestId("snackbar-undo").click();
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);
  await page.getByTestId("detail-overflow").click();
  await expect(page.getByTestId("overflow-stop")).toHaveText("Stop show");
});

test("a bulk mark auto-resumes a Stopped show", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow({ hidden: true })]);
  await page.goto("/show/1");
  await page.getByTestId("detail-overflow").click();
  await expect(page.getByTestId("overflow-stop")).toHaveText("Resume show");
  await page.keyboard.press("Escape");

  // Marking Season 2 of a Stopped show clears the hidden flag (auto-resume):
  // state follows progress, no manual Resume required.
  await season(page, 2).getByTestId("season-check").click();
  await page.getByTestId("confirm-sheet-primary").click();
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  await page.getByTestId("detail-overflow").click();
  await expect(page.getByTestId("overflow-stop")).toHaveText("Stop show");
});

test("'Mark whole show watched…' confirms with the real count and excludes specials + unaired", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await page.getByTestId("detail-overflow").click();
  await page.getByTestId("overflow-mark-show").click();
  await expect(page.getByText("Mark whole show watched?")).toBeVisible();
  await expect(page.getByText("5 episodes will be added to your history.")).toBeVisible();
  await page.getByTestId("confirm-sheet-primary").click();

  // One batched POST: the S1 delta + S2's aired episodes. No S0, no unaired.
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 1, episodes: [{ number: 3 }, { number: 4 }] },
    { number: 2, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] },
  ]);
});

test("the Specials season's own check opts specials in: its confirm marks only S0", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await season(page, 0).getByTestId("season-check").click();
  await expect(page.getByText("Mark Specials watched?")).toBeVisible();
  await expect(page.getByTestId("confirm-sheet-primary")).toHaveText("Mark 1 episode");
  await page.getByTestId("confirm-sheet-primary").click();

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 0, episodes: [{ number: 1 }] },
  ]);
});

test("the overflow offers 'Move to Watchlist' only for a show not yet started, wired to the watchlist write", async ({
  page,
}) => {
  const notStarted = detailShow({ completed: 0, lastWatchedAt: null });
  const controls = await installLibraryRoutes(page.context(), [notStarted]);
  await page.goto("/show/1");

  await page.getByTestId("detail-overflow").click();
  await page.getByTestId("overflow-watchlist").click();

  await expect(page.getByTestId("snackbar")).toContainText("The Detail Show added to Watchlist");
  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.showIds).toContain(1);

  // Undo re-toggles the membership off.
  await page.getByTestId("snackbar-undo").click();
  await expect.poll(() => controls.watchlistRemovePosts().length).toBe(1);
});

test("a started show's overflow has no watchlist entry and links out to Trakt", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await page.getByTestId("detail-overflow").click();
  await expect(page.getByTestId("overflow-watchlist")).toHaveCount(0);
  await expect(page.getByTestId("overflow-trakt")).toBeVisible();
  await expect(page.getByTestId("overflow-mark-show")).toBeVisible();
});
