import { expect, test } from "@playwright/test";
import {
  agoIso,
  buildPersistedLibrary,
  gateReadsUntilRefreshed,
  installHermeticRoutes,
  installLibraryRoutes,
  installMovieRoutes,
  installOAuthRoutes,
  type MovieFixture,
  readStored,
  type ShowFixture,
  seedActivities,
  seedAuth,
  seededMarkOp,
  seedOpLog,
  seedQueryCacheAtStart,
} from "./helpers";

const AIRED = "2026-01-01T00:00:00.000Z";

/**
 * A baseline that MATCHES the library harness's fixture stamps (2026-07-04), so the
 * boot poll is a clean no-op and the test starts from a settled, gated state: no
 * cold-boot commit race before we drive a change.
 */
const MATCHING_BASELINE = {
  episodes: { watched_at: "2026-07-04T00:00:00.000Z" },
  shows: { rated_at: "2026-07-04T00:00:00.000Z", watchlisted_at: "2026-07-04T00:00:00.000Z" },
  movies: { watched_at: "2026-07-04T00:00:00.000Z" },
  watchlist: { updated_at: "2026-07-04T00:00:00.000Z" },
};

/** Two in-progress shows, each with an aired unwatched next (a queue row apiece). */
function shows(): ShowFixture[] {
  const make = (trakt: number, title: string, base: number): ShowFixture => ({
    trakt,
    title,
    status: "returning series",
    lastWatchedAt: agoIso(2),
    aired: 3,
    completed: 1,
    episodes: [
      { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: base + 1 },
      { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: base + 2 },
      { season: 1, number: 3, title: "Three", firstAired: AIRED, traktId: base + 3 },
    ],
  });
  return [make(1, "Alpha", 10), make(2, "Beta", 20)];
}

/** Force a freshness poll: the reconnect path runs it immediately (headless is visible). */
async function pollNow(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => globalThis.dispatchEvent(new Event("online")));
}

test("navigating between pages with nothing changed fires zero Trakt data calls; silence means synced", async ({
  page,
}) => {
  await installHermeticRoutes(page.context());
  const controls = await installLibraryRoutes(page.context(), shows());
  await seedAuth(page.context());
  await seedActivities(page.context(), MATCHING_BASELINE);

  await page.goto("/");
  await expect(page.getByTestId("up-next-card")).toHaveCount(2);
  // Ambient sync: nothing renders while healthy. No strip or pill appears anywhere.
  await expect(page.getByTestId("sync-strip")).toHaveCount(0);

  // The progress read carries `extended=full,images` (the episode still rides
  // along free on the read every queue surface already makes).
  expect(controls.progressExtended()).toBe("full,images");

  // Baseline after the one legitimate initial load; re-navigation must add nothing.
  const baseline = controls.progressReads();
  expect(baseline).toBeGreaterThan(0);

  const sidebar = page.locator(".sidebar");
  const go = async (name: string, screen: string): Promise<void> => {
    await sidebar.getByRole("link", { name, exact: true }).click();
    await expect(page.getByTestId(screen)).toBeVisible();
  };
  await go("Library", "screen-library");
  await go("Up Next", "screen-up-next");
  await go("Library", "screen-library");
  await go("Up Next", "screen-up-next");

  // The shared library snapshot never re-fetched on navigation (staleTime Infinity),
  // and with nothing pending the strip stayed silent.
  expect(controls.progressReads()).toBe(baseline);
  await expect(page.getByTestId("sync-strip")).toHaveCount(0);
});

test("a last_activities change refetches only the affected keys: an episode watch, not an unmapped stamp", async ({
  page,
}) => {
  await installHermeticRoutes(page.context());
  const controls = await installLibraryRoutes(page.context(), shows());
  await seedAuth(page.context());
  await seedActivities(page.context(), MATCHING_BASELINE);

  await page.goto("/");
  await expect(page.getByTestId("up-next-card")).toHaveCount(2);
  const baseline = controls.progressReads();

  // A shows-ratings stamp maps to nothing (ratings left the product): NOT the library.
  controls.bumpActivity("shows", "rated_at");
  await pollNow(page);
  await page.waitForTimeout(600);
  expect(controls.progressReads()).toBe(baseline);

  // An episode-watched change maps to the library (+ stats): the queue re-syncs.
  controls.bumpActivity("episodes", "watched_at");
  await pollNow(page);
  await expect.poll(() => controls.progressReads()).toBeGreaterThan(baseline);
});

test("a 429 mid-fan-out keeps cached data: no Offline wipe", async ({ page }) => {
  await installHermeticRoutes(page.context());
  const controls = await installLibraryRoutes(page.context(), shows());
  await seedAuth(page.context());
  await seedActivities(page.context(), MATCHING_BASELINE);

  await page.goto("/");
  const cards = page.getByTestId("up-next-card");
  await expect(cards).toHaveCount(2);

  // The next change-driven refetch hits a 429 on its first progress reads; with
  // Retry-After honored and the cap absorbing it, the queue stays put and recovers.
  controls.rateLimitProgressReads(2);
  controls.bumpActivity("episodes", "watched_at");
  await pollNow(page);

  // Cached cards never vanish and the screen is never wiped to a full error.
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId("up-next-error")).toHaveCount(0);
  // The refetch eventually completes (the rate-limit was absorbed, not fatal).
  await expect.poll(() => controls.progressReads()).toBeGreaterThan(2);
});

test("sign out flushes the pending write and clears this device's caches", async ({ page }) => {
  await installHermeticRoutes(page.context());
  await installOAuthRoutes(page.context());
  const controls = await installLibraryRoutes(page.context(), shows());
  await seedAuth(page.context());
  // A durable mark left pending by a prior session: it must reach Trakt, never be
  // dropped when the op-log is cleared on sign-out.
  await seedOpLog(page.context(), [
    seededMarkOp({ episodeId: 12, showId: 1, preCompleted: 1, watchedAt: AIRED }),
  ]);

  await page.goto("/");
  await expect(page.getByTestId("up-next-card").first()).toBeVisible();
  // The seeded write reaches Trakt (flushed), not lost.
  await expect.poll(() => controls.historyPosts().length).toBeGreaterThanOrEqual(1);
  // The op-log is present (persisted) before we sign out.
  await expect.poll(async () => await readStored(page, "cue.write-queue")).not.toBeNull();

  await page.goto("/settings");
  await expect(page.getByTestId("screen-settings")).toBeVisible();
  await page.getByTestId("button-disconnect").click();
  await page.getByTestId("button-disconnect-confirm").click();
  await expect(page.getByTestId("screen-onboarding")).toBeVisible();

  // endLocalSession removed the durable op-log, the activities baseline, and the
  // persisted query cache, the next account starts clean, and the write survived.
  expect(await readStored(page, "cue.write-queue")).toBeNull();
  expect(await readStored(page, "cue.query-cache")).toBeNull();
  expect(await readStored(page, "cue.last-activities")).toBeNull();
  expect(controls.historyPosts().length).toBeGreaterThanOrEqual(1);
});

test("watched movies keep their posters (images stay on /sync/watched/movies)", async ({
  page,
}) => {
  await installHermeticRoutes(page.context());
  const watched: MovieFixture[] = [
    {
      trakt: 100,
      tmdb: 500,
      title: "Watched Movie",
      year: 2021,
      posters: ["media.trakt.tv/p.webp"],
      watched: true,
    },
  ];
  await installMovieRoutes(page.context(), watched);
  await seedAuth(page.context());
  await page.goto("/library?type=movies");

  // Watched films sit behind the Watched chip.
  await page.getByTestId("chip-watched").click();
  const card = page.getByTestId("movie-library-card").filter({ hasText: "Watched Movie" });
  await expect(card).toHaveCount(1);
  // The poster resolved to a real image (from the watched-movies `images`), not the
  // text-initials fallback: proof the posters survived the payload trim.
  await expect(card.getByTestId("poster-image")).toBeVisible();
});

test("a pre-gate persisted cache with no baseline is dropped, not trusted forever", async ({
  page,
}) => {
  await installHermeticRoutes(page.context());
  const controls = await installLibraryRoutes(page.context(), shows());
  await seedAuth(page.context());
  // The migration shape: a library cache persisted by an earlier build (any buster
  // but this build's), and NO last-activities baseline. Under staleTime:Infinity a
  // baseline-less restored cache would be trusted forever: the build-derived buster
  // must drop it so the app loads fresh instead of stranding the user on stale data.
  await seedQueryCacheAtStart(page.context(), buildPersistedLibrary(1, 0, "an-earlier-build"));

  await page.goto("/");
  // Real network reads ran (the stale cache was NOT trusted); the live library
  // (two shows) painted, not the single stale entry, whose title never appeared.
  await expect(page.getByTestId("up-next-card")).toHaveCount(2);
  expect(controls.progressReads()).toBeGreaterThan(0);
  await expect(page.getByText("Cached Show 1")).toHaveCount(0);
});

test("sign out is refused, writes preserved, when a pending write can't be flushed", async ({
  page,
}) => {
  await installHermeticRoutes(page.context());
  await installOAuthRoutes(page.context());
  const controls = await installLibraryRoutes(page.context(), shows());
  await seedAuth(page.context());
  await seedOpLog(page.context(), [
    seededMarkOp({ episodeId: 12, showId: 1, preCompleted: 1, watchedAt: AIRED }),
  ]);
  // Reads AND writes fail: the seeded mark can neither land nor be reconciled, so it
  // stays durably queued (a defer, not a drop) all the way through the sign-out.
  controls.setWriteMode("abort");
  controls.setReadMode("abort");

  await page.goto("/settings");
  await expect(page.getByTestId("screen-settings")).toBeVisible();
  await page.getByTestId("button-disconnect").click();
  await page.getByTestId("button-disconnect-confirm").click();

  // The sign-out is refused: the user stays connected (still on Settings, not
  // onboarding) with an honest message, and the durable op-log survives: the
  // queued write is neither lost nor cleared to replay under another account.
  await expect(page.getByTestId("disconnect-error")).toBeVisible();
  await expect(page.getByTestId("screen-onboarding")).toHaveCount(0);
  await expect(page.getByTestId("screen-settings")).toBeVisible();
  expect(await readStored(page, "cue.write-queue")).not.toBeNull();
});

test("a dead refresh token force-clears the pending op-log (no cross-account replay)", async ({
  page,
}) => {
  await installHermeticRoutes(page.context());
  const oauth = await installOAuthRoutes(page.context());
  oauth.setTokenStatus(401); // invalid_grant: the refresh token itself is dead
  const controls = await installLibraryRoutes(page.context(), shows());
  await seedAuth(page.context());
  await seedOpLog(page.context(), [
    seededMarkOp({ episodeId: 12, showId: 1, preCompleted: 1, watchedAt: AIRED }),
  ]);
  await seedActivities(page.context(), MATCHING_BASELINE);
  // The mark can't land (writes + reconcile reads abort → it stays queued); the
  // watched read 401s to trigger the dead-refresh-token teardown.
  controls.setWriteMode("abort");
  controls.setReadMode("abort");
  await gateReadsUntilRefreshed(page.context(), ["**/api.trakt.tv/sync/watched/shows*"]);

  await page.goto("/");

  // The dead token tears the session down to onboarding AND force-clears this
  // device's per-account state: the leftover op-log can't replay under the next
  // account, and the stale baseline is gone too.
  await expect(page.getByTestId("screen-onboarding")).toBeVisible();
  expect(await readStored(page, "cue.write-queue")).toBeNull();
  expect(await readStored(page, "cue.last-activities")).toBeNull();
});
