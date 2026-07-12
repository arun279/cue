import { expect, test } from "@playwright/test";
import {
  agoIso,
  type CalendarEpisodeFixture,
  type HistoryRowFixture,
  installCalendarRoutes,
  installHermeticRoutes,
  installHistoryRoutes,
  installLibraryRoutes,
  readStored,
  type ShowFixture,
  seedAuth,
  seededMarkOp,
  seedOpLog,
  seedTutorialDismissed,
} from "./helpers";

const AIRED = "2026-01-01T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";

/** One in-progress show, next = S1 E2, with a following S1 E3 to advance into.
 * Episode ids derive from the show id (`trakt*10 + n`) so multi-show fixtures
 * never share episode ids (the stateful write engine matches marks by them). */
function soloShow(overrides: Partial<ShowFixture> = {}): ShowFixture {
  const trakt = overrides.trakt ?? 1;
  return {
    trakt,
    tmdb: 500 + trakt,
    title: "Solo",
    status: "returning series",
    posters: ["media.trakt.tv/solo.webp"],
    lastWatchedAt: agoIso(2),
    aired: 3,
    completed: 1,
    episodes: [
      { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: trakt * 10 + 1 },
      { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: trakt * 10 + 2 },
      { season: 1, number: 3, title: "Three", firstAired: AIRED, traktId: trakt * 10 + 3 },
    ],
    ...overrides,
  };
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("queue: excludes future next episodes and hidden shows; lapsed drops to the drawer", async ({
  page,
}) => {
  const shows: ShowFixture[] = [
    soloShow({ trakt: 1, title: "Alpha", lastWatchedAt: agoIso(2) }),
    {
      trakt: 2,
      title: "Future",
      status: "returning series",
      lastWatchedAt: agoIso(3),
      aired: 1,
      completed: 1,
      episodes: [{ season: 2, number: 1, title: "S2 Premiere", firstAired: FUTURE, traktId: 21 }],
    },
    {
      trakt: 3,
      title: "Hidden Show",
      status: "returning series",
      hidden: true,
      lastWatchedAt: agoIso(4),
      aired: 2,
      completed: 1,
      episodes: [
        { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 31 },
        { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: 32 },
      ],
    },
    {
      trakt: 4,
      title: "NoImage",
      status: "returning series",
      lastWatchedAt: agoIso(5),
      aired: 2,
      completed: 1,
      episodes: [
        { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 41 },
        { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: 42 },
      ],
    },
    {
      trakt: 5,
      title: "Lapsed Show",
      status: "returning series",
      lastWatchedAt: agoIso(40),
      aired: 2,
      completed: 1,
      episodes: [
        { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 51 },
        { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: 52 },
      ],
    },
  ];
  await installLibraryRoutes(page.context(), shows);
  await page.goto("/");

  // Alpha + NoImage queue as rows (fewer than 3 queued shows → no marquee, a lone
  // hero would read as filler). Ties on air date break on watch recency: Alpha leads.
  await expect(page.getByTestId("marquee-card")).toHaveCount(0);
  const cards = page.getByTestId("up-next-card");
  await expect(cards).toHaveCount(2);
  const lead = cards.first();
  await expect(lead).toContainText("Alpha");
  // The quiet tabular episode-code line: `S1 E2 · Two` (the amber S01E05 caps are dead).
  await expect(lead.locator(".ep-row__code")).toHaveText("S1 E2");
  // The check is the one CheckControl grammar: role=switch, unwatched at rest,
  // its accessible name carrying the whole action.
  const leadMark = lead.getByTestId("mark-watched");
  await expect(leadMark).toHaveAttribute("aria-label", "Mark Alpha S1 E2 watched");
  await expect(leadMark).toHaveAttribute("role", "switch");
  await expect(leadMark).toHaveAttribute("aria-checked", "false");
  await expect(leadMark).toHaveAttribute("data-state", "unwatched");
  // The remaining count is the earned signal on line 3.
  await expect(lead.locator(".ep-row__count")).toHaveText("2 left");

  await expect(page.getByText("Future", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Hidden Show", { exact: true })).toHaveCount(0);

  // Alpha has a Trakt inline poster; NoImage degrades to the monogram placeholder.
  await expect(lead.getByTestId("poster-image")).toBeVisible();
  await expect(cards.filter({ hasText: "NoImage" }).locator(".poster__initials")).toBeVisible();

  // The lapsed show is NOT gone: it collapses into the drawer, where relative
  // time IS the signal and Stop is offered (overflow, confirm-sheet backed).
  const drawer = page.getByTestId("lapsed-drawer");
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId("lapsed-heading")).toContainText("Haven't watched lately");
  await expect(page.getByTestId("lapsed-count")).toHaveText("1");
  await page.getByTestId("lapsed-heading").click();
  const lapsedRow = page.getByTestId("lapsed-row").filter({ hasText: "Lapsed Show" });
  await expect(lapsedRow).toHaveCount(1);
  await expect(lapsedRow.locator(".ep-row__count")).toContainText("last watched");
  const lapsedMark = lapsedRow.getByTestId("mark-watched");
  await expect(lapsedMark).toHaveAttribute("aria-label", "Mark Lapsed Show S1 E2 watched");
  await expect(lapsedRow.getByTestId("lapsed-overflow")).toBeVisible();
});

test("three or more queued shows promote the top of the queue into the marquee card", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [
    soloShow({ trakt: 1, title: "Alpha", lastWatchedAt: agoIso(2) }),
    soloShow({ trakt: 2, title: "Bravo", lastWatchedAt: agoIso(4) }),
    soloShow({ trakt: 3, title: "Charlie", lastWatchedAt: agoIso(6) }),
  ]);
  await page.goto("/");

  // The most recently watched show (air-date tie) leads as the marquee; the rest
  // render as standard queue rows beneath it.
  const marquee = page.getByTestId("marquee-card");
  await expect(marquee).toBeVisible();
  await expect(marquee).toContainText("Alpha");
  const rows = page.getByTestId("up-next-card");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Bravo");
  await expect(rows.nth(1)).toContainText("Charlie");

  // The marquee's check is the same control grammar (56px advance check), and
  // marking from it runs the same pipeline: snackbar included.
  const check = marquee.getByTestId("mark-watched");
  await expect(check).toHaveAttribute("aria-label", "Mark Alpha S1 E2 watched");
  await check.click();
  await expect(page.getByTestId("snackbar")).toContainText("Alpha S1 E2 marked");
});

test("the lapsed drawer's mark catches up in place and re-files the show into the queue", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [
    soloShow({ trakt: 1, title: "Active", lastWatchedAt: agoIso(2) }),
    {
      trakt: 5,
      title: "Lapsed Show",
      status: "returning series",
      lastWatchedAt: agoIso(40),
      aired: 3,
      completed: 1,
      episodes: [
        { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 51 },
        { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: 52 },
        { season: 1, number: 3, title: "Three", firstAired: AIRED, traktId: 53 },
      ],
    },
  ]);
  // Hold the POST open so the re-file reflects the point-of-action optimistic
  // advance (the authoritative refetch is deferred behind the write).
  controls.setWriteMode("delay");
  await page.goto("/");

  // Lapsed Show sits in the drawer (idle 40d), not the queue.
  await expect(page.getByTestId("up-next-card").filter({ hasText: "Lapsed Show" })).toHaveCount(0);
  await page.getByTestId("lapsed-heading").click();
  const lapsedRow = page.getByTestId("lapsed-row").filter({ hasText: "Lapsed Show" });
  await expect(lapsedRow).toHaveCount(1);

  // One tap marks its next aired episode (S1 E2 = id 52) in place…
  await lapsedRow.getByTestId("mark-watched").click();
  await expect(page.getByTestId("snackbar")).toContainText("Lapsed Show S1 E2 marked");
  await expect
    .poll(() => controls.historyPosts().some((w) => w.episodeIds.includes(52)))
    .toBe(true);

  // …and the fresh watch re-files it into the queue; it leaves the drawer.
  await expect(page.getByTestId("up-next-card").filter({ hasText: "Lapsed Show" })).toHaveCount(1);
  await expect(page.getByTestId("lapsed-drawer")).toHaveCount(0);
});

test("Stop from the lapsed drawer confirms, snackbar-reversibly", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [
    soloShow({ trakt: 1, title: "Active", lastWatchedAt: agoIso(2) }),
    soloShow({ trakt: 5, title: "Lapsed Show", lastWatchedAt: agoIso(40) }),
  ]);
  await page.goto("/");

  await page.getByTestId("lapsed-heading").click();
  const lapsedRow = page.getByTestId("lapsed-row").filter({ hasText: "Lapsed Show" });
  await lapsedRow.getByTestId("lapsed-overflow").click();
  await page.getByTestId("lapsed-stop").click();

  // The hide write fires and the one snackbar confirms with an Undo.
  await expect.poll(() => controls.hiddenPosts().length).toBe(1);
  expect(controls.hiddenPosts()[0]?.showIds).toContain(5);
  await expect(page.getByTestId("snackbar")).toContainText("Lapsed Show stopped");
  await expect(page.getByTestId("lapsed-drawer")).toHaveCount(0);

  // Undo un-hides: the show returns to the drawer.
  await page.getByTestId("snackbar-undo").click();
  await expect
    .poll(
      () =>
        controls.writes().filter((w) => w.path === "/users/hidden/progress_watched/remove").length,
    )
    .toBe(1);
  await expect(page.getByTestId("lapsed-drawer")).toBeVisible();
});

test("shows the 'nothing queued' empty state when the library is empty", async ({ page }) => {
  await installLibraryRoutes(page.context(), []);
  await page.goto("/");
  await expect(page.getByTestId("empty-nothing-tracked")).toBeVisible();
  await expect(page.getByTestId("empty-nothing-tracked")).toContainText("Nothing queued.");
  await expect(page.getByTestId("empty-search-shows")).toBeVisible();
});

test("shows 'all caught up' when tracked shows have no aired next episode", async ({ page }) => {
  await installLibraryRoutes(page.context(), [
    {
      trakt: 9,
      title: "Done",
      status: "ended",
      lastWatchedAt: "2026-06-01T00:00:00.000Z",
      aired: 1,
      completed: 1,
      episodes: [{ season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 91 }],
    },
  ]);
  await page.goto("/");
  await expect(page.getByTestId("empty-all-caught-up")).toBeVisible();
  await expect(page.getByTestId("empty-all-caught-up")).toContainText("You're all caught up.");
});

test("an only-stopped library reads its own state, not 'nothing queued'", async ({ page }) => {
  await installLibraryRoutes(page.context(), [
    {
      trakt: 1,
      title: "Stopped Only",
      status: "returning series",
      hidden: true,
      lastWatchedAt: agoIso(3),
      aired: 3,
      completed: 1,
      episodes: [
        { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 11 },
        { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: 12 },
        { season: 1, number: 3, title: "Three", firstAired: AIRED, traktId: 13 },
      ],
    },
  ]);
  await page.goto("/");
  await expect(page.getByTestId("empty-only-stopped")).toBeVisible();
  await expect(page.getByTestId("empty-nothing-tracked")).toHaveCount(0);
  await expect(page.getByTestId("empty-to-library")).toBeVisible();
});

test("a watchlist-only library reads 'nothing started' with watchlist tiles, not 'all caught up'", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [
    {
      trakt: 2,
      title: "Not Started",
      status: "returning series",
      inWatchlist: true,
      lastWatchedAt: null,
      aired: 0,
      completed: 0,
      episodes: [{ season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 21 }],
    },
  ]);
  await page.goto("/");
  await expect(page.getByTestId("empty-nothing-started")).toBeVisible();
  await expect(page.getByTestId("empty-all-caught-up")).toHaveCount(0);
  // The watchlist section beneath the empty state offers a way in.
  await expect(page.getByTestId("watchlist-tile")).toHaveCount(1);
  await expect(page.getByTestId("watchlist-tile")).toContainText("Not Started");
});

test("finishing an ended show lands on the 'all caught up' state after the write settles", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [
    {
      trakt: 7,
      title: "Wrapped",
      status: "ended",
      lastWatchedAt: agoIso(2),
      aired: 2,
      completed: 1,
      episodes: [
        { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 71 },
        { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: 72 },
      ],
    },
  ]);
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  await card.getByTestId("mark-watched").click();
  await expect(page.getByTestId("snackbar")).toContainText("Wrapped S1 E2 marked");

  // Once the authoritative refetch lands there is nothing left to queue: the
  // finished show leaves and the honest caught-up state takes over.
  await expect(page.getByTestId("empty-all-caught-up")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("up-next-card")).toHaveCount(0);
});

test("a read error over a warm cache keeps the queue under the SyncStrip error variant", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  await expect(page.getByTestId("up-next-card")).toHaveCount(1);
  await expect(page.getByTestId("sync-strip")).toHaveCount(0);

  // A later refetch fails: the cached queue must remain, with the ambient strip
  // (not a banner, not a wipe) carrying the error + Retry.
  controls.setReadMode("abort");
  await page.getByTestId("mark-watched").click(); // triggers a revalidate that will fail
  const strip = page.getByTestId("sync-strip");
  await expect(strip).toHaveAttribute("data-state", "error");
  await expect(strip).toContainText("Trakt unreachable. Showing your cached data.");
  await expect(page.getByTestId("up-next-card")).toHaveCount(1);

  controls.setReadMode("ok");
  await strip.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("sync-strip")).toHaveCount(0);
});

test("one show's progress outage keeps the warm queue instead of erasing it", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  await expect(page.getByTestId("up-next-card")).toHaveCount(1);

  // A later revalidate hits a single-show progress failure; the cached queue must
  // survive under the strip, never silently collapse to "all caught up".
  controls.failProgressFor([1]);
  await page.getByTestId("mark-watched").click();
  await expect(page.getByTestId("sync-strip")).toHaveAttribute("data-state", "error");
  await expect(page.getByTestId("up-next-card")).toHaveCount(1);
  await expect(page.getByTestId("empty-all-caught-up")).toHaveCount(0);

  controls.failProgressFor([]);
  await page.getByTestId("sync-strip").getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("sync-strip")).toHaveCount(0);
});

test("boot survives a startup-reconcile outage: the app mounts instead of hanging", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  // A mark left durable by a prior session, plus reads that fail on boot: the
  // startup reconcile can't determine landing, but boot must still mount (never
  // stick on the loading spinner) and keep the op durable for a later flush.
  await seedOpLog(page.context(), [
    seededMarkOp({ episodeId: 12, showId: 1, preCompleted: 1, watchedAt: AIRED }),
  ]);
  controls.setReadMode("abort");
  controls.setWriteMode("abort"); // fully offline: neither reconcile nor flush can land
  await page.goto("/");

  await expect(page.getByTestId("screen-up-next")).toBeVisible();
  await expect(page.getByTestId("runtime-loading")).toHaveCount(0);
  await expect(page.getByTestId("up-next-error")).toBeVisible();
  await expect(page.getByTestId("sync-strip")).toHaveAttribute("data-state", "error");

  const logRaw = await readStored(page, "cue.write-queue");
  const log = JSON.parse(logRaw ?? "[]") as unknown[];
  expect(log).toHaveLength(1);
});

test("mark-watched advances the row in place before the history write settles", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  controls.setWriteMode("delay"); // hold the POST open so the advance can't depend on it
  await page.goto("/");

  const card = page.getByTestId("up-next-card").first();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E2");
  await expect(card.locator(".ep-row__count")).toHaveText("2 left");

  await card.getByTestId("mark-watched").click();

  // The row advances immediately, while the write is still in flight: the meta
  // line rolls to the provisional next episode, the count steps down, and the
  // filled check stays a LIVE undo toggle (`just-marked`), never a lock.
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");
  await expect(card.locator(".ep-row__count")).toHaveText("1 left");
  await expect(card.getByTestId("mark-watched")).toHaveAttribute("data-state", "just-marked");
  await expect(card.getByTestId("mark-watched")).toHaveAttribute("aria-checked", "true");

  // The write carries the pre-advance episode (S1 E2 = id 12) and a frozen watched_at.
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  const post = controls.historyPosts()[0];
  expect(post?.episodeIds).toContain(12);
  expect(post?.watchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("the snackbar appears synchronously with the advance, before the write settles", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  controls.setWriteMode("delay"); // hold the POST open so the snackbar can't depend on it
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();

  await card.getByTestId("mark-watched").click();

  // The advance AND its confirmation appear together while the write is in
  // flight: the ONE app snackbar, with its Undo action: no inline undo pill.
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");
  await expect(page.getByTestId("snackbar")).toContainText("Solo S1 E2 marked");
  await expect(page.getByTestId("snackbar-undo")).toBeVisible();
  await expect(page.getByTestId("mark-undo")).toHaveCount(0);
});

test("snackbar Undo of a LANDED mark removes exactly its play, by history id", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();

  await card.getByTestId("mark-watched").click();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");
  // Let the add fully land (op retired from the durable log) so the Undo takes
  // the per-play path: resolve the mark's own play and remove it by exact id,
  // never a remove-by-item that could wipe plays predating the mark.
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  await expect.poll(async () => await readStored(page, "cue.write-queue")).toBe("[]");

  await page.getByTestId("snackbar-undo").click();

  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.ids).toEqual([121]); // S1 E2 trakt 12 → play 121
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E2");
});

test("the just-marked check is a live reverse toggle: one tap silently takes the mark back", async ({
  page,
}) => {
  const fixtures = [soloShow()];
  const controls = await installLibraryRoutes(page.context(), fixtures);
  controls.setWriteMode("delay"); // the held write keeps the reverse window open deterministically
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();

  await card.getByTestId("mark-watched").click();
  await expect(card.getByTestId("mark-watched")).toHaveAttribute("data-state", "just-marked");
  await expect(page.getByTestId("snackbar")).toBeVisible();

  // Tap the filled check inside the window: the row rolls back, the snackbar
  // retracts, and NO error/confirmation appears: the silent "oops" path.
  await card.getByTestId("mark-watched").click();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E2");
  await expect(card.getByTestId("mark-watched")).toHaveAttribute("data-state", "unwatched");
  await expect(page.getByTestId("snackbar")).toHaveCount(0);

  // Server state settles consistent: the held add is compensated by the remove
  // (ordered behind it), leaving the fixture exactly where it started.
  await expect.poll(() => controls.removePosts().length, { timeout: 12_000 }).toBe(1);
  expect(controls.writes().map((w) => w.path)).toEqual(["/sync/history", "/sync/history/remove"]);
  await expect.poll(() => fixtures[0]?.completed).toBe(1);
});

test("rapid marks coalesce into one batch snackbar whose Undo reverses everything", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [
    soloShow({ trakt: 1, title: "Alpha", lastWatchedAt: agoIso(2) }),
    soloShow({ trakt: 2, title: "Bravo", lastWatchedAt: agoIso(4) }),
  ]);
  await page.goto("/");
  const cards = page.getByTestId("up-next-card");
  await expect(cards).toHaveCount(2);

  // Two marks inside the 5s rolling window: the snackbar coalesces (replaces,
  // never stacks) and counts the batch.
  await cards.nth(0).getByTestId("mark-watched").click();
  await cards.nth(1).getByTestId("mark-watched").click();
  await expect(page.getByTestId("snackbar")).toContainText("2 episodes marked");
  await expect(page.getByTestId("snackbar")).toHaveCount(1);

  // Undo reverses the entire coalesced batch: both rows restore and both plays
  // are removed from Trakt (per-play or coalesced, depending on flush timing).
  await page.getByTestId("snackbar-undo").click();
  await expect(cards.nth(0).locator(".ep-row__code")).toHaveText("S1 E2");
  await expect(cards.nth(1).locator(".ep-row__code")).toHaveText("S1 E2");
  await expect.poll(() => controls.removePosts().length, { timeout: 12_000 }).toBe(2);
  const removed = controls
    .removePosts()
    .flatMap((w) => [...w.episodeIds, ...(w.ids ?? []).map((id) => Math.floor(id / 10))]);
  expect(removed).toContain(12); // Alpha S1 E2
  expect(removed).toContain(22); // Bravo S1 E2
});

test("the check re-arms for the next episode once the authoritative next lands", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  const check = card.getByTestId("mark-watched");

  await check.click();
  await expect(check).toHaveAttribute("data-state", "just-marked");

  // After the write lands and the refetch resolves the REAL S1 E3, the check
  // re-arms: unwatched again, aimed at the next episode: ready for the binge.
  await expect(check).toHaveAttribute("data-state", "unwatched", { timeout: 10_000 });
  await expect(check).toHaveAttribute("aria-label", "Mark Solo S1 E3 watched");

  // A tap now marks S1 E3 (id 13) through the same pipeline.
  await check.click();
  await expect.poll(() => controls.historyPosts().flatMap((w) => w.episodeIds)).toContain(13);
});

test("a double activation marks the episode exactly once: no duplicate history POST", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  // Immediate write mode ON PURPOSE (not `delay`): a second enqueued op would
  // dispatch on the next pacing tick (~1s), so a 2s settle window genuinely
  // surfaces a duplicate if one ever escaped.
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E2");

  // Two synchronous activations in one task: before React can re-render the
  // just-marked state: mimic a fast double-click / Enter key-repeat.
  await card.getByTestId("mark-watched").evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });

  // The row advances exactly once…
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  // …and no second POST reaches the network across a two-pacing-interval window.
  await page.waitForTimeout(2000);
  expect(controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(12);
});

test("a 429 then success still lands the row advanced and re-armed", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  controls.setWriteMode("rate-limit-once");
  await page.goto("/");

  const card = page.getByTestId("up-next-card").first();
  await card.getByTestId("mark-watched").click();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");

  // The queue honors Retry-After and retries once; two POSTs, row still advanced.
  await expect.poll(() => controls.historyPosts().length, { timeout: 6000 }).toBe(2);
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");
  await expect(card.getByTestId("mark-watched")).toHaveAttribute("data-state", "unwatched", {
    timeout: 10_000,
  });
});

test("a network reject triggers a reconcile read, not a blind re-POST", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  controls.setWriteMode("network-drop"); // reaches Trakt, response lost
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  const readsBefore = controls.progressReads();

  await card.getByTestId("mark-watched").click();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");

  // Exactly one history POST (the dropped one); the queue reconciles via a
  // progress re-read and never blindly re-POSTs.
  await page.waitForTimeout(2000);
  expect(controls.historyPosts().length).toBe(1);
  expect(controls.progressReads()).toBeGreaterThan(readsBefore);
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");
});

test("a held-open write then an immediate snackbar Undo issues the ordered add-then-remove", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  // Keep the add POST in flight so Undo enqueues a compensating remove behind it:
  // the exact flow the opId-guarded failure path protects (never a lost intent).
  controls.setWriteMode("delay");
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E2");

  await card.getByTestId("mark-watched").click();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");
  await expect(page.getByTestId("snackbar-undo")).toBeVisible();

  // Undo while the add is still held open: the row restores optimistically…
  await page.getByTestId("snackbar-undo").click();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E2");

  // …and both writes land in order: the add first (held in flight while the undo
  // WAITS for it rather than cancelling a POST that may land), then the
  // per-play remove of exactly the play it created.
  await expect.poll(() => controls.removePosts().length, { timeout: 15_000 }).toBe(1);
  expect(controls.writes().map((w) => w.path)).toEqual(["/sync/history", "/sync/history/remove"]);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(12);
  expect(controls.removePosts()[0]?.ids).toEqual([121]);
  // The row stays restored once every write has settled (no bounce back to S1 E3).
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E2");
});

test("the durable op-log survives a reload and replays with the frozen watched_at", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  controls.setWriteMode("delay"); // keep the first POST in flight so the op stays durable
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  await card.getByTestId("mark-watched").click();
  await expect(card.locator(".ep-row__code")).toHaveText("S1 E3");

  // The op is persisted to the durable log before the write resolves.
  const logRaw = await readStored(page, "cue.write-queue");
  expect(logRaw).not.toBeNull();
  const log = JSON.parse(logRaw ?? "[]") as {
    request: { path: string; body: { episodes: { ids: { trakt: number }; watched_at: string }[] } };
  }[];
  expect(log).toHaveLength(1);
  expect(log[0]?.request.path).toBe("/sync/history");
  const frozenWatchedAt = log[0]?.request.body.episodes[0]?.watched_at;
  expect(frozenWatchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  controls.clearWrites();
  await page.reload();

  // On reload the restored queue replays the write with the identical watched_at.
  await expect
    .poll(() => controls.historyPosts().find((w) => w.watchedAt === frozenWatchedAt) ?? null, {
      timeout: 8000,
    })
    .not.toBeNull();
  const replay = controls.historyPosts().find((w) => w.watchedAt === frozenWatchedAt);
  expect(replay?.episodeIds).toContain(12);
});

test("'On the way' lists the next 72 hours, check-free, linking to the Calendar", async ({
  page,
}) => {
  // Calendar routes FIRST so the library's write engine (registered later) wins
  // the shared paths; the calendar feed itself has no conflicts.
  const inThreeHours = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const nextWeek = new Date(Date.now() + 6 * 86_400_000).toISOString();
  const items: CalendarEpisodeFixture[] = [
    {
      showId: 30,
      showTitle: "Tonight Show",
      season: 3,
      number: 4,
      title: "A Dark Web",
      firstAired: inThreeHours,
      traktId: 301,
    },
    {
      showId: 31,
      showTitle: "Far Out Show",
      season: 1,
      number: 1,
      title: "Beyond Scope",
      firstAired: nextWeek,
      traktId: 311,
    },
  ];
  await installCalendarRoutes(page.context(), items);
  await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");

  const section = page.getByTestId("on-the-way");
  await expect(section).toBeVisible();
  // Only the ≤72h episode qualifies; the +6d one waits for the Calendar tab.
  const rows = section.getByTestId("on-the-way-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Tonight Show");
  await expect(rows.first().locator(".ep-row__code")).toHaveText("S3 E4");
  // Nothing to mark yet: no check anywhere in the section.
  await expect(section.getByTestId("mark-watched")).toHaveCount(0);

  await page.getByTestId("on-the-way-calendar").click();
  await expect(page.getByTestId("screen-calendar")).toBeVisible();
  await expect(page).toHaveURL(/\/calendar$/);
});

test("'Previously' shows recent plays whose green check removes exactly that play", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [soloShow()]);
  // History routes AFTER the library so their /users/me/history read and
  // /sync/history(+/remove) writes win: the Previously section is theirs.
  const rows: HistoryRowFixture[] = [
    {
      id: 71,
      type: "episode",
      showId: 1,
      showTitle: "Solo",
      season: 1,
      number: 1,
      episodeTitle: "One",
      watchedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    },
    {
      id: 72,
      type: "movie",
      movieId: 200,
      movieTitle: "Interstellar",
      year: 2014,
      watchedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    },
  ];
  const history = await installHistoryRoutes(page.context(), rows);
  await page.goto("/");

  const section = page.getByTestId("previously");
  await expect(section).toBeVisible();
  const entries = section.getByTestId("previously-row");
  await expect(entries).toHaveCount(2);
  // Each entry's trailing check renders WATCHED (green, filled): the durable
  // unmark affordance, right on the home scroll.
  const check = entries.first().getByTestId("mark-watched");
  await expect(check).toHaveAttribute("data-state", "watched");
  await expect(check).toHaveAttribute("aria-label", "Watched. Tap to remove.");

  // Tapping it removes that exact play (by history event id) with an Undo.
  await check.click();
  await expect(entries).toHaveCount(1);
  await expect(page.getByTestId("snackbar")).toContainText("Removed play");
  await expect.poll(() => history.removePosts().length).toBe(1);
  expect(history.removePosts()[0]?.ids).toEqual([71]);

  // Undo re-adds it best-effort and the entry returns.
  await page.getByTestId("snackbar-undo").click();
  await expect.poll(() => history.addPosts().length).toBeGreaterThan(0);
  await expect(entries).toHaveCount(2);

  // The section links to the full History screen.
  await page.getByTestId("previously-history").click();
  await expect(page.getByTestId("screen-history")).toBeVisible();
});

test("shows beyond the progress budget render as sync-pending rows with disabled checks", async ({
  page,
}) => {
  // 61 shows: one past the 60-show cold-sync progress budget. The oldest-watched
  // show misses the budget and must read as honestly syncing: striped bar,
  // disabled check: never fabricated as caught-up or markable.
  const many: ShowFixture[] = Array.from({ length: 61 }, (_, i) => ({
    trakt: 1000 + i,
    title: `Bulk Show ${i + 1}`,
    status: "returning series",
    lastWatchedAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
    aired: 2,
    completed: 1,
    episodes: [
      { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: (1000 + i) * 10 + 1 },
      { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: (1000 + i) * 10 + 2 },
    ],
  }));
  await installLibraryRoutes(page.context(), many);
  await page.goto("/");

  const pending = page.getByTestId("sync-pending-row");
  await expect(pending).toHaveCount(1, { timeout: 15_000 });
  await expect(pending).toContainText("Bulk Show 61");
  await expect(pending).toContainText("Syncing progress…");
  const check = pending.getByTestId("mark-watched");
  await expect(check).toHaveAttribute("data-state", "syncing");
  await expect(check).toHaveAttribute("aria-disabled", "true");
  await expect(check).toHaveAttribute("aria-label", "Progress syncing. Check back shortly.");
});

test("the one-time tutorial caption shows on a first session and dies on the first mark", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");

  // First-ever session: the caption sits under the first row's check.
  await expect(page.getByTestId("tutorial-caption")).toBeVisible();
  await expect(page.getByTestId("tutorial-caption")).toContainText("Tap to mark watched");

  // The first mark dismisses it permanently.
  await page.getByTestId("up-next-card").first().getByTestId("mark-watched").click();
  await expect(page.getByTestId("tutorial-caption")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("up-next-card").first()).toBeVisible();
  await expect(page.getByTestId("tutorial-caption")).toHaveCount(0);
});

test("a pre-dismissed tutorial never renders the caption", async ({ page }) => {
  await seedTutorialDismissed(page.context());
  await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  await expect(page.getByTestId("up-next-card").first()).toBeVisible();
  await expect(page.getByTestId("tutorial-caption")).toHaveCount(0);
});
