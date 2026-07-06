import { expect, test } from "@playwright/test";
import {
  agoIso,
  installHermeticRoutes,
  installLibraryRoutes,
  readStored,
  type ShowFixture,
  seedAuth,
  seededMarkOp,
  seedOpLog,
} from "./helpers";

const AIRED = "2026-01-01T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";

/** One in-progress show, next = S01E02, with a following S01E03 to advance into.
 * Its episodes aired long ago, so its next is "Continue" (mid-run), not "New". */
function soloShow(overrides: Partial<ShowFixture> = {}): ShowFixture {
  return {
    trakt: 1,
    tmdb: 500,
    title: "Solo",
    status: "returning series",
    posters: ["media.trakt.tv/solo.webp"],
    lastWatchedAt: agoIso(2),
    aired: 3,
    completed: 1,
    episodes: [
      { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 11 },
      { season: 1, number: 2, title: "Two", firstAired: AIRED, traktId: 12 },
      { season: 1, number: 3, title: "Three", firstAired: AIRED, traktId: 13 },
    ],
    ...overrides,
  };
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("Continue queue: excludes future next episodes and hidden shows; lapsed drops to the drawer", async ({
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

  // Alpha + NoImage queue under Continue (most-recently-watched first; Alpha leads).
  const cards = page.getByTestId("up-next-card");
  await expect(cards).toHaveCount(2);
  const lead = cards.first();
  await expect(lead).toContainText("Alpha");
  await expect(lead.getByTestId("episode-code")).toHaveText("S01E02");
  await expect(lead.getByTestId("mark-watched")).toContainText("Watched");
  await expect(page.getByRole("heading", { name: "NoImage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Future" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hidden Show" })).toHaveCount(0);

  // Alpha (lead) has a Trakt inline poster; NoImage degrades to the text tile.
  await expect(lead.getByTestId("poster-image")).toBeVisible();
  await expect(cards.filter({ hasText: "NoImage" }).getByTestId("poster-text")).toBeVisible();

  // The lapsed show is NOT gone — it collapses into the drawer with Keep / Stop watching.
  const drawer = page.getByTestId("lapsed-drawer");
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId("lapsed-heading")).toContainText("Haven't watched in a while");
  await page.getByTestId("lapsed-heading").click();
  const lapsedRow = page.getByTestId("lapsed-row").filter({ hasText: "Lapsed Show" });
  await expect(lapsedRow).toHaveCount(1);
  await expect(lapsedRow.getByTestId("lapsed-keep")).toBeVisible();
  await expect(lapsedRow.getByTestId("lapsed-stop")).toBeVisible();
});

test("New group surfaces a freshly-aired episode, sorted newest first", async ({ page }) => {
  // Freshly-aired next episodes (yesterday, three days ago) land in "New"; a
  // long-idle show whose new episode just dropped is pulled into New, not the drawer.
  await installLibraryRoutes(page.context(), [
    {
      trakt: 1,
      title: "Older Drop",
      status: "returning series",
      lastWatchedAt: agoIso(2),
      aired: 2,
      completed: 1,
      episodes: [
        { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 11 },
        { season: 1, number: 2, title: "Two", firstAired: agoIso(3), traktId: 12 },
      ],
    },
    {
      trakt: 2,
      title: "Newest Drop",
      status: "returning series",
      lastWatchedAt: agoIso(30),
      aired: 2,
      completed: 1,
      episodes: [
        { season: 1, number: 1, title: "One", firstAired: AIRED, traktId: 21 },
        { season: 1, number: 2, title: "Two", firstAired: agoIso(1), traktId: 22 },
      ],
    },
  ]);
  await page.goto("/");

  const newGroup = page.getByTestId("up-next-new");
  await expect(newGroup).toBeVisible();
  const newCards = newGroup.getByTestId("up-next-card");
  await expect(newCards).toHaveCount(2);
  // Newest air first: Newest Drop (yesterday) leads Older Drop (three days ago).
  await expect(newCards.nth(0)).toContainText("Newest Drop");
  await expect(newCards.nth(1)).toContainText("Older Drop");
  // The long-idle "Newest Drop" is in New (fresh overrides idle), never the drawer.
  await expect(page.getByTestId("lapsed-drawer")).toHaveCount(0);
});

test("shows the 'nothing tracked' empty state when the library is empty", async ({ page }) => {
  await installLibraryRoutes(page.context(), []);
  await page.goto("/");
  await expect(page.getByTestId("empty-nothing-tracked")).toBeVisible();
});

test("shows the 'all caught up' empty state when tracked shows have no aired next episode", async ({
  page,
}) => {
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
});

test("finishing an ended show shows the quiet 'You finished' closure copy", async ({ page }) => {
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
  await expect(page.getByTestId("undo")).toContainText("You finished Wrapped");
});

test("Trakt read error over a warm cache shows the queue plus a retry affordance", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  await expect(page.getByTestId("up-next-card")).toHaveCount(1);

  // A later refetch fails, but the cached queue must remain with a retry banner.
  controls.setReadMode("abort");
  await page.getByTestId("mark-watched").click(); // triggers a revalidate that will fail
  await expect(page.getByTestId("cached-retry")).toBeVisible();
  await expect(page.getByTestId("up-next-card")).toHaveCount(1);

  controls.setReadMode("ok");
  await page.getByTestId("cached-retry-button").click();
  await expect(page.getByTestId("cached-retry")).toHaveCount(0);
});

test("one show's progress outage keeps the warm queue instead of erasing it", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  await expect(page.getByTestId("up-next-card")).toHaveCount(1);

  // A later revalidate hits a single-show progress failure; the cached queue must
  // survive with the retry banner, never silently collapse to "all caught up".
  controls.failProgressFor([1]);
  await page.getByTestId("mark-watched").click();
  await expect(page.getByTestId("cached-retry")).toBeVisible();
  await expect(page.getByTestId("up-next-card")).toHaveCount(1);
  await expect(page.getByTestId("empty-all-caught-up")).toHaveCount(0);

  controls.failProgressFor([]);
  await page.getByTestId("cached-retry-button").click();
  await expect(page.getByTestId("cached-retry")).toHaveCount(0);
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

  const logRaw = await readStored(page, "cue.write-queue");
  const log = JSON.parse(logRaw ?? "[]") as unknown[];
  expect(log).toHaveLength(1);
});

test("mark-watched advances the card optimistically before the history write settles", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  controls.setWriteMode("delay"); // hold the POST open so the advance can't depend on it
  await page.goto("/");

  const card = page.getByTestId("up-next-card").first();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E02");

  await card.getByTestId("mark-watched").click();

  // The card advances immediately, while the write is still in flight (button locked).
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");
  await expect(card.getByTestId("mark-watched")).toBeDisabled();

  // The write carries the pre-advance episode (S01E02 = id 12) and a frozen watched_at.
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  const post = controls.historyPosts()[0];
  expect(post?.episodeIds).toContain(12);
  expect(post?.watchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("a 429 then success still lands the card advanced", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  controls.setWriteMode("rate-limit-once");
  await page.goto("/");

  const card = page.getByTestId("up-next-card").first();
  await card.getByTestId("mark-watched").click();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");

  // The queue honors Retry-After and retries once; two POSTs, card still advanced.
  await expect.poll(() => controls.historyPosts().length, { timeout: 6000 }).toBe(2);
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");
  await expect(card.getByTestId("mark-watched")).toBeEnabled();
});

test("a network reject triggers a reconcile read, not a blind re-POST", async ({ page }) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  controls.setWriteMode("network-drop"); // reaches Trakt, response lost
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  const readsBefore = controls.progressReads();

  await card.getByTestId("mark-watched").click();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");

  // Exactly one history POST (the dropped one); the queue reconciles via a
  // progress re-read and never blindly re-POSTs.
  await page.waitForTimeout(2000);
  expect(controls.historyPosts().length).toBe(1);
  expect(controls.progressReads()).toBeGreaterThan(readsBefore);
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");
});

test("Undo issues the stored inverse /sync/history/remove and restores the card", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();

  await card.getByTestId("mark-watched").click();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");

  await expect(page.getByTestId("undo")).toBeVisible();
  await page.getByTestId("undo-action").click();

  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.path).toBe("/sync/history/remove");
  expect(controls.removePosts()[0]?.episodeIds).toContain(12);
  await expect(card.getByTestId("episode-code")).toHaveText("S01E02");
});

test("the durable op-log survives a reload and replays with the frozen watched_at", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  controls.setWriteMode("delay"); // keep the first POST in flight so the op stays durable
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  await card.getByTestId("mark-watched").click();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");

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
