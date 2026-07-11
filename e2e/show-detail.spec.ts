import { expect, test } from "@playwright/test";
import {
  agoIso,
  type CalendarEpisodeFixture,
  type EpisodeFixture,
  installCalendarRoutes,
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
 * A show with a fully-aired Season 1, a partially-aired Season 2 (S2E4/E5 unaired),
 * and an aired Specials season. Episodes are in watch order (aired regular eps,
 * then unaired, then the special) so the fixture's linear `completed` counter maps
 * to consistent per-episode watched flags. `completed` = 2 keeps it in Up Next.
 */
function detailShow(): ShowFixture {
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
  };
}

/**
 * A show whose Season 1 is fully watched, with S01E01 watched TWICE (a rewatch).
 * The durable Unmark must remove the single-play episodes by id while keeping the
 * rewatched episode's plays intact.
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

async function expandSeason(page: import("@playwright/test").Page, season: number): Promise<void> {
  await page.locator(`[data-season="${season}"]`).getByTestId("season-trigger").click();
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

test("streams the hero then the season tree", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await expect(page.getByTestId("detail-title")).toContainText("The Detail Show");
  await expect(page).toHaveTitle("The Detail Show · Cue");
  await expect(page.getByTestId("detail-network")).toContainText("Testnet");
  await expect(page.getByTestId("detail-overview")).toBeVisible();
  await expect(page.getByTestId("overall-progress")).toHaveAttribute("aria-valuenow", "29");
  // Specials + Season 1 + Season 2, sorted ascending (specials first).
  await expect(page.getByTestId("season-panel")).toHaveCount(3);
});

test("surfaces per-show watched dates on the header and watched episode rows", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  // Header recognition cue: WHEN you last watched, not just that you did.
  await expect(page.getByTestId("last-watched")).toContainText("Last watched");

  await expandSeason(page, 1);
  const s1 = page.locator('[data-season="1"]');
  // S01E01/E02 are watched (completed: 2) → each shows its watched date inline.
  await expect(
    s1.getByTestId("episode-row").nth(0).getByTestId("episode-watched-date"),
  ).toContainText("Watched");
  // S01E03 is aired but unwatched → no watched-date line.
  await expect(
    s1.getByTestId("episode-row").nth(2).getByTestId("episode-watched-date"),
  ).toHaveCount(0);
});

test("renders the last-watched date in the viewer's local day, not UTC", async ({ page }) => {
  // 02:00Z on Jul 15 is 22:00 on Jul 14 in America/New_York (the pinned e2e tz).
  // A UTC format would misread this as Jul 15: but a watched date is a real
  // per-viewer event, bucketed to the local day exactly like the Diary.
  const boundaryShow: ShowFixture = { ...detailShow(), lastWatchedAt: "2026-07-15T02:00:00.000Z" };
  await installLibraryRoutes(page.context(), [boundaryShow]);
  await page.goto("/show/1");

  await expect(page.getByTestId("last-watched")).toContainText("Jul 14, 2026");
});

test("a mark from Up Next refreshes this show's detail progress: and it survives a reload", async ({
  page,
}) => {
  // The regression: marking an episode from Up Next advanced Up Next/Library but
  // left the show-detail header, season ticks and next-up reading the PRE-mark
  // cache: and it stayed wrong across reloads with the sync pill at rest, because
  // the mark invalidated only ['library'], not this show's header/seasons queries.
  // Navigation is client-side (Links, not full reloads) so the QueryClient stays in
  // memory and the stale-cache path the bug lived on is exercised faithfully.
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/");

  const card = page.getByTestId("up-next-card").first();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");

  // Visit the show detail first so its header/seasons are cached at the pre-mark
  // state (2/7, next up S01E03, S01E03 unwatched): this is the cache that went stale.
  await card.locator(".card__title-link").click();
  await expect(page.getByTestId("overall-progress")).toHaveAttribute("aria-valuenow", "29");
  await expect(page.getByTestId("next-callout")).toContainText("S01E03");
  await expandSeason(page, 1);
  const s1e3 = page
    .getByTestId("episode-row")
    .filter({ hasText: "S01E03" })
    .getByTestId("episode-toggle");
  await expect(s1e3).not.toBeChecked();

  // Back to Up Next (client-side) and mark S01E03 (id 13); let the write land.
  await page.getByTestId("detail-back").click();
  await expect(card.getByTestId("mark-watched")).toBeVisible();
  await card.getByTestId("mark-watched").click();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E04");
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "synced");

  // Re-open the show detail over the now-stale in-memory cache: header (3/7),
  // next-up (S01E04) and the season tick must reflect the new progress: this is
  // what the missing header/seasons invalidation used to leave reading 2/7 / S01E03.
  await card.locator(".card__title-link").click();
  await expect(page.getByTestId("overall-progress")).toHaveAttribute("aria-valuenow", "43");
  await expect(page.getByTestId("next-callout")).toContainText("S01E04");
  await expandSeason(page, 1);
  await expect(s1e3).toBeChecked();

  // Durable across a full reload: the persisted show-detail cache is corrected, so
  // it stays right even though nothing is left to sync (pill at rest, log drained).
  await page.reload();
  await expect(page.getByTestId("overall-progress")).toHaveAttribute("aria-valuenow", "43");
  await expect(page.getByTestId("next-callout")).toContainText("S01E04");
  await expandSeason(page, 1);
  await expect(s1e3).toBeChecked();

  await page.goto("/");
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "synced");
  expect(await readStored(page, "cue.write-queue")).toBe("[]");
});

// 12:00 in America/New_York (the fixed calendar tz), so the aired row (14:00Z =
// 10:00 local) reads as already-aired "today" and exposes the quick mark-watched.
const CALENDAR_NOW = new Date("2026-07-15T16:00:00.000Z");

/** An aired-today Calendar row for The Detail Show's next unwatched episode (S01E03, id 13). */
function detailShowCalendarRow(): CalendarEpisodeFixture {
  return {
    showId: 1,
    showTitle: "The Detail Show",
    season: 1,
    number: 3,
    title: "Episode 3",
    firstAired: "2026-07-15T14:00:00.000Z",
    traktId: 13,
  };
}

test("a mark from the Calendar refreshes this show's detail progress: and it survives a reload", async ({
  page,
}) => {
  // The same regression as the Up Next case, on the Calendar quick-mark surface:
  // that mark invalidated only the calendar window + `library`, never this show's
  // header/seasons/episode, so the show detail stayed at pre-mark progress across
  // reloads. Calendar routes are registered first so the library `/sync/history`
  // handler (which advances the fixture's `completed`) wins the shared path.
  await page.clock.setFixedTime(CALENDAR_NOW);
  await installCalendarRoutes(page.context(), [detailShowCalendarRow()]);
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);

  // Cache the show detail at the pre-mark state (2/7, next up S01E03, S01E03 unwatched).
  await page.goto("/show/1");
  await expect(page.getByTestId("overall-progress")).toHaveAttribute("aria-valuenow", "29");
  await expect(page.getByTestId("next-callout")).toContainText("S01E03");
  await expandSeason(page, 1);
  const s1e3 = page
    .getByTestId("episode-row")
    .filter({ hasText: "S01E03" })
    .getByTestId("episode-toggle");
  await expect(s1e3).not.toBeChecked();

  // Client-side to the Upcoming (calendar) view: Calendar is no longer a tab, so
  // go via Up Next then its one-tap Upcoming affordance; mark the aired S01E03 row.
  await page.getByRole("link", { name: "Up Next", exact: true }).first().click();
  await page.getByTestId("up-next-upcoming").click();
  await expect(page.getByTestId("screen-calendar")).toBeVisible();
  await page.getByTestId("calendar-mark").click();
  await expect(page.getByTestId("calendar-watched")).toBeVisible(); // optimistic
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toEqual([13]);

  // Re-open the show detail over the now-stale in-memory cache (Up Next → title
  // link): header (3/7), next-up (S01E04) and the S01E03 tick must reflect the mark,
  // this is what a `library`-only invalidation used to leave reading 2/7 / S01E03.
  await page.getByRole("link", { name: "Up Next", exact: true }).first().click();
  const card = page.getByTestId("up-next-card").first();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E04");
  await card.locator(".card__title-link").click();
  await expect(page.getByTestId("overall-progress")).toHaveAttribute("aria-valuenow", "43");
  await expect(page.getByTestId("next-callout")).toContainText("S01E04");
  await expandSeason(page, 1);
  await expect(s1e3).toBeChecked();

  // Durable across a full reload: the persisted show-detail cache is corrected.
  await page.reload();
  await expect(page.getByTestId("overall-progress")).toHaveAttribute("aria-valuenow", "43");
  await expect(page.getByTestId("next-callout")).toContainText("S01E04");
  await expandSeason(page, 1);
  await expect(s1e3).toBeChecked();

  await page.getByRole("link", { name: "Up Next", exact: true }).first().click();
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "synced");
  expect(await readStored(page, "cue.write-queue")).toBe("[]");
});

test("Mark up to here fires ONE batched POST with only the aired, unwatched delta: no unaired, no specials", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");
  await expandSeason(page, 2);

  await page
    .getByTestId("episode-row")
    .filter({ hasText: "S02E03" })
    .getByTestId("mark-up-to-here")
    .click();

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  const posted = controls.historyPosts()[0];
  // S01E01/E02 already watched (completed=2) → only the unwatched S01E03/E04 delta
  // is logged, never a whole-season token; S02E01–E03 are the aired unwatched delta.
  expect(posted?.shows?.[0]?.seasons).toEqual([
    { number: 1, episodes: [{ number: 3 }, { number: 4 }] },
    { number: 2, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] },
  ]);
});

test("Mark season fires ONE batched POST enumerating only the season's aired episodes", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await page.locator('[data-season="2"]').getByTestId("mark-season").click();

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 2, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] },
  ]);
});

test("specials are included in a bulk mark only when opted in", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");
  await page.getByTestId("include-specials").check();
  await expandSeason(page, 2);

  await page
    .getByTestId("episode-row")
    .filter({ hasText: "S02E03" })
    .getByTestId("mark-up-to-here")
    .click();

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  const seasons = controls.historyPosts()[0]?.shows?.[0]?.seasons ?? [];
  // The special (S00E01) and the unwatched Season 1 delta (S01E03/E04) are enumerated
  // per episode: a delta mark never collapses a season to a bare token.
  expect(seasons).toContainEqual({ number: 0, episodes: [{ number: 1 }] });
  expect(seasons).toContainEqual({ number: 1, episodes: [{ number: 3 }, { number: 4 }] });
});

test("bulk marks are optimistic: episodes check before the write settles", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  controls.setWriteMode("delay"); // hold the POST open so the check can't depend on it
  await page.goto("/show/1");
  await expandSeason(page, 2);

  const s2e1 = page
    .getByTestId("episode-row")
    .filter({ hasText: "S02E01" })
    .getByTestId("episode-toggle");
  await expect(s2e1).not.toBeChecked();

  await page.locator('[data-season="2"]').getByTestId("mark-season").click();
  await expect(s2e1).toBeChecked();
});

test("a per-episode toggle marks a single aired episode; unaired episodes are locked", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");
  await expandSeason(page, 2);

  const s2e1 = page
    .getByTestId("episode-row")
    .filter({ hasText: "S02E01" })
    .getByTestId("episode-toggle");
  await expect(s2e1).not.toBeChecked();
  await s2e1.click();
  await expect(s2e1).toBeChecked();

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(21);

  await expect(
    page.getByTestId("episode-row").filter({ hasText: "S02E04" }).getByTestId("episode-toggle"),
  ).toBeDisabled();
});

test("Undo on a season mark re-sends the stored remove-by-item inverse", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await page.locator('[data-season="2"]').getByTestId("mark-season").click();
  await expect(page.getByTestId("season-undo")).toBeVisible();
  await page.getByTestId("season-undo-action").click();

  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 2, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] },
  ]);
});

test("a partially-watched season mark logs only the unwatched delta, and Undo removes only that", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");
  await expandSeason(page, 1);

  // Season 1: S01E01/E02 already watched (completed=2); S01E03/E04 aired-unwatched.
  const e3 = page
    .getByTestId("episode-row")
    .filter({ hasText: "S01E03" })
    .getByTestId("episode-toggle");
  const e1 = page
    .getByTestId("episode-row")
    .filter({ hasText: "S01E01" })
    .getByTestId("episode-toggle");
  await expect(e3).not.toBeChecked();
  await expect(e1).toBeChecked();

  const season1 = page.locator('[data-season="1"]');
  await expect(season1.getByTestId("season-count")).toHaveText("2/4");
  await season1.getByTestId("mark-season").click();

  // The ADD marks ONLY the previously-unwatched aired episodes (E03/E04): never the
  // whole season: so the already-watched E01/E02 are not re-logged (no duplicate plays).
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 1, episodes: [{ number: 3 }, { number: 4 }] },
  ]);
  await expect(e3).toBeChecked();
  // Now complete, the header shows a non-interactive "Watched" status + a mark Undo toast.
  await expect(season1.getByTestId("season-count")).toHaveText("4/4");
  await expect(season1.getByTestId("season-complete")).toBeVisible();
  await expect(page.getByTestId("season-undo")).toBeVisible();

  // Undo removes EXACTLY that delta; the pre-existing E01/E02 plays stay intact, so the
  // season returns to 2/4, NEVER 0/4, and the mark action comes back.
  await page.getByTestId("season-undo-action").click();
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 1, episodes: [{ number: 3 }, { number: 4 }] },
  ]);
  await expect(e3).not.toBeChecked();
  await expect(e1).toBeChecked();
  await expect(season1.getByTestId("season-count")).toHaveText("2/4");
  await expect(season1.getByTestId("mark-season")).toBeVisible();
});

test("a durable Unmark reverses ONLY the mark's delta: surviving the toast's expiry, never touching a pre-existing play", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");
  await expandSeason(page, 1);

  const season1 = page.locator('[data-season="1"]');
  // Season 1 is partial (S01E01/E02 watched, E03/E04 aired-unwatched) → mark action.
  await expect(season1.getByTestId("mark-season")).toHaveText(/Mark season watched/);

  // Marking the S01E03/E04 delta completes the season; the mark ACTION is replaced by
  // a "Watched" STATUS badge PLUS a durable "Unmark" that reverses THIS mark.
  await season1.getByTestId("mark-season").click();
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  await expect(season1.getByTestId("season-complete")).toBeVisible();
  await expect(season1.getByTestId("unmark-season")).toBeVisible();

  // The transient mark Undo is up now; the DURABLE reversal must not depend on it:
  // wait for the toast to auto-dismiss (UNDO_MS), then unmark anyway.
  await expect(page.getByTestId("season-undo")).toBeVisible();
  await expect(page.getByTestId("season-undo")).toBeHidden({ timeout: 9000 });
  controls.clearWrites();

  await season1.getByTestId("unmark-season").click();
  await expect.poll(() => controls.removePosts().length).toBe(1);
  const removed = controls.removePosts()[0];
  // Removed by EXACT per-play history ids for the DELTA ONLY (E03/E04 → 131/141).
  // The pre-existing E01/E02 plays (111/121) are NOT in the body: "Unmark" reverses
  // the mark, it does not clear the season.
  expect(removed?.ids).toEqual([131, 141]);
  expect(removed?.ids).not.toContain(111);
  expect(removed?.ids).not.toContain(121);
  expect(removed?.shows).toEqual([]);
  // The season falls back to its PRE-MARK count (2/4), not to zero, and E01/E02 stay
  // watched; the mark action returns.
  await expect(season1.getByTestId("mark-season")).toBeVisible();
  await expect(season1.getByTestId("season-count")).toHaveText("2/4");
  await expect(
    page.getByTestId("episode-row").filter({ hasText: "S01E01" }).getByTestId("episode-toggle"),
  ).toBeChecked();
  await expect(
    page.getByTestId("episode-row").filter({ hasText: "S01E02" }).getByTestId("episode-toggle"),
  ).toBeChecked();
});

test("a genuinely-watched season offers no one-tap Unmark; a rewatched episode's extra play is protected", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [rewatchShow()]);
  await page.goto("/show/2");
  await expandSeason(page, 1);

  const season1 = page.locator('[data-season="1"]');
  await expect(season1.getByTestId("season-complete")).toBeVisible();
  // No `Mark season watched` was made this session, so there is nothing to reverse:
  // a genuinely-watched season shows "Watched" alone: no destructive one-tap wipe.
  await expect(season1.getByTestId("unmark-season")).toHaveCount(0);

  // Removing real history is a per-play job. Unchecking the rewatched S01E01 (two
  // plays) is REFUSED: neither play is removed and the tick returns.
  const e1 = page
    .getByTestId("episode-row")
    .filter({ hasText: "S01E01" })
    .getByTestId("episode-toggle");
  await expect(e1).toBeChecked();
  await e1.click();
  await expect(page.getByTestId("season-notice")).toContainText(/plays/i);
  expect(controls.removePosts()).toHaveLength(0);
  await expect(e1).toBeChecked();

  // A single-play episode (S01E02 → play 2021) unchecks per-play-safely by history id.
  const e2 = page
    .getByTestId("episode-row")
    .filter({ hasText: "S01E02" })
    .getByTestId("episode-toggle");
  await e2.click();
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.ids).toEqual([2021]);
});

test("unchecking one settled episode removes only its play by history id: never an item-scoped wipe", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");
  await expandSeason(page, 1);

  // S01E02 is the last watched episode (completed=2), so unchecking it is consistent
  // with the fixture's linear counter.
  const e2 = page
    .getByTestId("episode-row")
    .filter({ hasText: "S01E02" })
    .getByTestId("episode-toggle");
  await expect(e2).toBeChecked();
  await e2.click();
  await expect(e2).not.toBeChecked(); // optimistic

  await expect.poll(() => controls.removePosts().length).toBe(1);
  const removed = controls.removePosts()[0];
  expect(removed?.ids).toEqual([121]); // S01E02 trakt 12 → play 121, by history id
  expect(removed?.episodeIds).toEqual([]); // never `{episodes:[{ids}]}`
});

test("a double activation on Mark season fires exactly one bulk POST", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  // Two synchronous activations in one task: before React re-renders the button into
  // its aria-busy / status-flipped state: mimic a fast double-click. The synchronous
  // pendingSeasonsRef guard must drop the second before it enqueues a second bulk op.
  await page
    .locator('[data-season="2"]')
    .getByTestId("mark-season")
    .evaluate((el: HTMLElement) => {
      el.click();
      el.click();
    });

  // Exactly one POST enumerating Season 2's aired delta reaches the network, and no
  // duplicate surfaces across a two-pacing-interval window.
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

  await page.locator('[data-season="2"]').getByTestId("mark-season").click();

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
  const landed = { ...detailShow(), completed: 7 };
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
  const alreadyHidden = { ...detailShow(), hidden: true };
  await seedOpLog(page.context(), [seededHideOp(1)]);
  const controls = await installLibraryRoutes(page.context(), [alreadyHidden]);
  await page.goto("/show/1");

  await expect(page.getByTestId("detail-title")).toBeVisible();
  // Direct load (library cache cold): the snapshot still resolves the hidden state,
  // so the action offers recovery instead of re-stopping an already-stopped show.
  await expect(page.getByTestId("hide-show")).toHaveText("Resume");
  await page.waitForTimeout(1500);
  // The hidden-set read shows the op landed; it's retired, not blindly re-POSTed.
  expect(controls.hiddenPosts().length).toBe(0);
});

test("Stop watching drops the show from Up Next and moves it to the Stopped segment", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);

  await page.goto("/");
  // The lone tracked show leads Up Next as the first card.
  await expect(page.getByTestId("up-next-card").filter({ hasText: "The Detail Show" })).toHaveCount(
    1,
  );

  await page.goto("/show/1");
  await expect(page.getByTestId("hide-show")).toHaveText("Stop watching");
  await page.getByTestId("hide-show").click();
  await expect(page.getByTestId("hide-undo")).toContainText("Stopped watching The Detail Show");

  await expect.poll(() => controls.hiddenPosts().length).toBe(1);
  expect(controls.hiddenPosts()[0]?.showIds).toContain(1);

  // Gone from the aired-only Up Next queue (client-side hidden exclusion): no cards.
  await page.goto("/");
  await expect(page.getByTestId("up-next-card")).toHaveCount(0);

  // Present only under the Stopped segment in Library: the only non-empty pile now,
  // so it opens by default (never a fully-collapsed library) and the tile is visible.
  await page.setViewportSize({ width: 1000, height: 1400 });
  await page.goto("/library");
  const stopped = page.getByTestId("pile-heading").filter({ hasText: "Stopped" });
  await expect(stopped).toBeVisible();
  await expect(page.getByTestId("library-card").filter({ hasText: "The Detail Show" })).toHaveCount(
    1,
  );
});

test("marking an episode of a Stopped show auto-resumes it", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [{ ...detailShow(), hidden: true }]);
  await page.goto("/show/1");

  // Loads as Stopped: the action offers Resume and it is absent from Up Next.
  await expect(page.getByTestId("hide-show")).toHaveText("Resume");

  // Record a watch on the next aired episode from the detail "Up next" module.
  await page.getByTestId("next-up-mark").click();

  // The mark logs the play AND clears the hidden flag (unhide remove), so the show
  // un-stops with no manual Resume: state follows progress.
  await expect.poll(() => controls.historyPosts().length).toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);

  // The detail action flips back to "Stop watching".
  await expect(page.getByTestId("hide-show")).toHaveText("Stop watching");

  // And it re-enters the aired-only Up Next queue.
  await page.goto("/");
  await expect(page.getByTestId("up-next-card").filter({ hasText: "The Detail Show" })).toHaveCount(
    1,
  );
});

test("the Up-next strip mark offers a point-of-action Undo that reverses the play", async ({
  page,
}) => {
  // Consistency gap: marking the next episode from the show-detail "Up next" strip
  // logged the play silently, no Undo, while the identical one-tap mark on the Up
  // Next LIST offered one. The strip now surfaces the same reversal safety net.
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  // The next unwatched aired episode is S01E03 (id 13); the header reads 2/7.
  await expect(page.getByTestId("next-callout")).toContainText("S01E03");
  await expect(page.getByTestId("overall-progress")).toHaveAttribute("aria-valuenow", "29");

  await page.getByTestId("next-up-mark").click();

  // The play lands AND a point-of-action Undo appears synchronously with the mark.
  await expect(page.getByTestId("season-undo")).toBeVisible();
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(13);
  await expect(page.getByTestId("next-callout")).toContainText("S01E04"); // advanced

  // Undo re-sends the stored remove-by-item inverse for exactly that episode and the
  // strip returns to S01E03: the reversal, not a silent commit.
  await page.getByTestId("season-undo-action").click();
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.episodeIds).toEqual([13]);
  await expect(page.getByTestId("next-callout")).toContainText("S01E03");
  await expect(page.getByTestId("overall-progress")).toHaveAttribute("aria-valuenow", "29");
});

test("the hero Mark-next button offers the same point-of-action Undo as the strip", async ({
  page,
}) => {
  // Symmetry: the hero's primary "Mark next watched" action funnels through the same
  // one-tap mark as the "Up next" strip, so it must raise the same reversible toast,
  // not a silent commit: for the identical play.
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await page.getByTestId("mark-next").click();

  await expect(page.getByTestId("season-undo")).toBeVisible();
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(13);
});

test("a double activation on the strip Mark-watched logs exactly one play", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");
  await expect(page.getByTestId("next-callout")).toContainText("S01E03");

  // Two synchronous activations in one task: before React re-renders the advanced
  // next-up state: mimic a fast double-tap. The synchronous per-episode in-flight
  // guard must drop the second before it enqueues a duplicate /sync/history play.
  await page.getByTestId("next-up-mark").evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });

  // Exactly one play for S01E03 (id 13) reaches the network, and no duplicate surfaces
  // across a two-pacing-interval window.
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  await page.waitForTimeout(2000);
  expect(controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(13);
});

test("at 390px the season row stacks: single-line title + meta, reachable chevron, full-width mark control", async ({
  page,
}) => {
  // Regression: the fixed-width mark-season control + ring + chevron crushed the
  // title/meta column on a phone, wrapping "Season 1" to two lines and the meta one
  // word per line, and burying the disclosure chevron mid-text. The head now wraps so
  // the mark control drops to its own full-width row beneath the title/meta.
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/show/1");

  const season1 = page.locator('[data-season="1"]');
  await expect(season1).toBeVisible();

  // The row itself never overflows its box (the crushed layout used to push content
  // past the card edge) and it fits inside the 390px viewport.
  const rowBox = await season1.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(rowBox?.width ?? 0).toBeLessThanOrEqual(390);
  const rowOverflow = await season1.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(rowOverflow).toBeLessThanOrEqual(0);

  // The title text node and the meta each render on exactly ONE line box: a wrapped
  // title or a word-per-line meta would yield >1 client rect over the same text.
  const titleLines = await season1.locator(".season__name").evaluate((el) => {
    const range = document.createRange();
    range.selectNode(el.firstChild as Node);
    return range.getClientRects().length;
  });
  expect(titleLines).toBe(1);
  const metaLines = await season1.locator(".season__sub").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length;
  });
  expect(metaLines).toBe(1);

  // The mark control dropped to its own full-width row BELOW the title (not squeezed
  // beside it): wider than half the card and starting past the title's bottom.
  const nameBox = await season1.locator(".season__name").boundingBox();
  const markBox = await season1.getByTestId("mark-season").boundingBox();
  expect(markBox?.y ?? 0).toBeGreaterThan(nameBox?.y ?? 0);
  expect(markBox?.width ?? 0).toBeGreaterThan((rowBox?.width ?? 0) * 0.6);

  // The disclosure chevron is a reachable tap target: fully within the viewport and
  // it actually expands the shelf on tap.
  const chevron = season1.locator(".season__chevron");
  await expect(chevron).toBeVisible();
  const chBox = await chevron.boundingBox();
  expect((chBox?.x ?? 0) + (chBox?.width ?? 0)).toBeLessThanOrEqual(390);
  await season1.getByTestId("season-trigger").click();
  await expect(season1.getByTestId("episode-row").first()).toBeVisible();
});

test("Stop watching is reversible: Undo clears the hidden set and re-files the show", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");
  await expect(page.getByTestId("hide-show")).toHaveText("Stop watching");

  await page.getByTestId("hide-show").click();
  await expect.poll(() => controls.hiddenPosts().length).toBe(1);
  await expect(page.getByTestId("hide-show")).toHaveText("Resume");

  // Undo submits the inverse (unhide remove) and the action flips back to Stop watching.
  await page.getByTestId("hide-undo-action").click();
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);
  await expect(page.getByTestId("hide-show")).toHaveText("Stop watching");
});

test("a bulk mark auto-resumes a Stopped show and its Undo re-stops it", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [{ ...detailShow(), hidden: true }]);
  await page.goto("/show/1");
  await expect(page.getByTestId("hide-show")).toHaveText("Resume");

  // Marking Season 1 of a Stopped show clears the hidden flag (auto-resume).
  await page.locator('[data-season="1"]').getByTestId("mark-season").click();
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);
  await expect(page.getByTestId("hide-show")).toHaveText("Stop watching");

  // Undo reverses BOTH sides, not just the re-hide: it re-sends the stored inverse
  // /sync/history/remove AND re-stops (re-hides) the show it had auto-resumed.
  await page.getByTestId("season-undo-action").click();
  await expect.poll(() => controls.removePosts().length).toBe(1);
  // Season 1 is partially watched (S01E01/E02 already logged), so the mark: and its
  // inverse remove: carry only the unwatched delta (S01E03/E04), never the whole
  // season, so Undo can't delete the pre-existing E01/E02 plays.
  expect(controls.removePosts()[0]?.shows?.[0]?.seasons).toEqual([
    { number: 1, episodes: [{ number: 3 }, { number: 4 }] },
  ]);
  await expect.poll(() => controls.hiddenPosts().length).toBe(1);
  await expect(page.getByTestId("hide-show")).toHaveText("Resume");
});
