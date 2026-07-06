import { expect, test } from "@playwright/test";
import {
  agoIso,
  type EpisodeFixture,
  installHermeticRoutes,
  installLibraryRoutes,
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

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

async function expandSeason(page: import("@playwright/test").Page, season: number): Promise<void> {
  await page.locator(`[data-season="${season}"]`).getByTestId("season-trigger").click();
}

test("streams the hero then the season tree", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1");

  await expect(page.getByTestId("detail-title")).toContainText("The Detail Show");
  await expect(page.getByTestId("detail-network")).toContainText("Testnet");
  await expect(page.getByTestId("detail-overview")).toBeVisible();
  await expect(page.getByTestId("overall-progress")).toHaveAttribute("aria-valuenow", "29");
  // Specials + Season 1 + Season 2, sorted ascending (specials first).
  await expect(page.getByTestId("season-panel")).toHaveCount(3);
});

test("Mark up to here fires ONE batched POST with only aired eps / tokens, no unaired, no specials", async ({
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
  expect(posted?.shows?.[0]?.seasons).toEqual([
    { number: 1 },
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
  expect(seasons).toContainEqual({ number: 0 });
  expect(seasons).toContainEqual({ number: 1 });
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

  // Present only under the Stopped segment in Library (collapsed by default; expand it).
  await page.setViewportSize({ width: 1000, height: 1400 });
  await page.goto("/library");
  const stopped = page.getByTestId("pile-heading").filter({ hasText: "Stopped" });
  await expect(stopped).toBeVisible();
  await stopped.click();
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
  // un-stops with no manual Resume — state follows progress.
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

  // Undo reverses BOTH sides — not just the re-hide: it re-sends the stored inverse
  // /sync/history/remove AND re-stops (re-hides) the show it had auto-resumed.
  await page.getByTestId("season-undo-action").click();
  await expect.poll(() => controls.removePosts().length).toBe(1);
  // Season 1 is fully aired, so the mark (and its inverse remove) carry a bare
  // season token rather than enumerated episodes.
  expect(controls.removePosts()[0]?.shows?.[0]?.seasons).toEqual([{ number: 1 }]);
  await expect.poll(() => controls.hiddenPosts().length).toBe(1);
  await expect(page.getByTestId("hide-show")).toHaveText("Resume");
});
