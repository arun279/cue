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
  // The Cue mark is the icon-only amber RING (an ACTION), never a "+"/"✓" pill: it has
  // no visible text, so its accessible name carries the whole action and the title
  // reclaims the width. The lead carries a "Next up" eyebrow so it reads as
  // what-to-watch-next — its emphasis is chrome, not a differently-styled mark.
  const leadMark = lead.getByTestId("mark-watched");
  await expect(leadMark).toHaveAttribute("aria-label", /^Mark .+ S01E02 watched$/);
  await expect(leadMark).toHaveText("");
  await expect(leadMark).toHaveClass(/cue-mark/);
  await expect(lead).toContainText("Next up");
  await expect(page.getByRole("heading", { name: "NoImage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Future" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hidden Show" })).toHaveCount(0);

  // Alpha (lead) has a Trakt inline poster; NoImage degrades to the text tile.
  await expect(lead.getByTestId("poster-image")).toBeVisible();
  await expect(cards.filter({ hasText: "NoImage" }).getByTestId("poster-text")).toBeVisible();

  // The lapsed show is NOT gone — it collapses into the drawer with Mark watched / Stop watching.
  const drawer = page.getByTestId("lapsed-drawer");
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId("lapsed-heading")).toContainText("Haven't watched in a while");
  await page.getByTestId("lapsed-heading").click();
  const lapsedRow = page.getByTestId("lapsed-row").filter({ hasText: "Lapsed Show" });
  await expect(lapsedRow).toHaveCount(1);
  // The drawer offers in-place catch-up + Stop watching — no "Keep". Its mark is the
  // same icon-only amber RING as every queue row (an ACTION, never a done ✓), its
  // accessible name carrying the whole action.
  const lapsedMark = lapsedRow.getByTestId("lapsed-mark");
  await expect(lapsedMark).toHaveAttribute("aria-label", /^Mark Lapsed Show .+ watched$/);
  await expect(lapsedMark).toHaveClass(/cue-mark/);
  await expect(lapsedRow.getByTestId("lapsed-stop")).toBeVisible();
  await expect(lapsedRow.getByTestId("lapsed-keep")).toHaveCount(0);
});

test("REGRESSION (coupling): the lead card's Cue mark is byte-for-byte the queue card's mark — one state-driven control, no lead/variant style, at a 56px target", async ({
  page,
}) => {
  // This bug has recurred THREE times: a lead-specific mark style (a `.card--lead
  // .cue-mark { … }` rule, or a lead/variant/size prop) making the first card's mark
  // look different from every other row's. The mark's look must be a pure function of
  // watched STATE, never of the container it sits in. This test fails the instant
  // any lead-driven mark style is reintroduced.
  await installLibraryRoutes(page.context(), [
    soloShow({ trakt: 1, title: "Alpha", lastWatchedAt: agoIso(2) }),
    soloShow({ trakt: 2, title: "Bravo", lastWatchedAt: agoIso(4) }),
  ]);
  await page.goto("/");

  const cards = page.getByTestId("up-next-card");
  await expect(cards).toHaveCount(2);
  const lead = cards.first();
  const queue = cards.nth(1);
  // The cards differ (the lead carries its emphasis in CHROME — poster + "Next up"),
  // which is exactly why the mark must NOT differ.
  await expect(lead).toHaveClass(/card--lead/);
  await expect(queue).not.toHaveClass(/card--lead/);

  const leadMark = lead.getByTestId("mark-watched");
  const queueMark = queue.getByTestId("mark-watched");
  // Same component, and the class attribute is EXACTLY "cue-mark" in both — no lead /
  // variant / size modifier class a per-container style could hook onto.
  await expect(leadMark).toHaveClass("cue-mark");
  await expect(queueMark).toHaveClass("cue-mark");

  // Every visual property a lead-specific SELECTOR could change must be identical, even
  // if the element's own class stayed "cue-mark". This is the deep lock.
  const MARK_PROPS = [
    "width",
    "height",
    "border-top-width",
    "border-top-style",
    "border-top-color",
    "border-radius",
    "background-color",
    "color",
    "box-sizing",
  ];
  const styleOf = (mark: typeof leadMark): Promise<Record<string, string>> =>
    mark.evaluate((el, props: string[]) => {
      const cs = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    }, MARK_PROPS);
  const [leadStyle, queueStyle] = await Promise.all([styleOf(leadMark), styleOf(queueMark)]);
  expect(leadStyle).toEqual(queueStyle);

  // …and the row mark is a 56px finger target (WCAG 2.5.5) in BOTH containers.
  const leadBox = await leadMark.boundingBox();
  const queueBox = await queueMark.boundingBox();
  expect(leadBox).not.toBeNull();
  expect(queueBox).not.toBeNull();
  for (const box of [leadBox, queueBox]) {
    expect(Math.round(box?.width ?? 0)).toBe(56);
    expect(Math.round(box?.height ?? 0)).toBe(56);
  }
});

test("the lead card shows its full title at 390px — no hero truncation", async ({ page }) => {
  // The reported regression: the elevated lead bumped the poster + title so the
  // title column collapsed and a normal show name clipped to a single letter on a
  // phone. The calmer lead (base-card metrics) must show the whole name.
  await installLibraryRoutes(page.context(), [soloShow({ title: "Severance" })]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const lead = page.getByTestId("up-next-card").first();
  await expect(lead).toHaveClass(/card--lead/);
  const title = lead.getByRole("heading", { name: "Severance" });
  await expect(title).toBeVisible();
  // A clipped .card__title (overflow:hidden + ellipsis) has scrollWidth > clientWidth;
  // a fully-shown title does not. This is the layout gate for the truncation fix.
  const clipped = await title.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(clipped).toBe(false);
});

test("the lapsed drawer's Mark watched marks in place and re-files the show into Continue", async ({
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
  // Hold the POST open so the fresh-activity re-file reflects the point-of-action
  // optimistic advance (the authoritative refetch is deferred behind the write).
  controls.setWriteMode("delay");
  await page.goto("/");

  // Lapsed Show sits in the drawer (idle 40d), not Continue.
  await expect(page.getByTestId("up-next-card").filter({ hasText: "Lapsed Show" })).toHaveCount(0);
  await page.getByTestId("lapsed-heading").click();
  const lapsedRow = page.getByTestId("lapsed-row").filter({ hasText: "Lapsed Show" });
  await expect(lapsedRow).toHaveCount(1);

  // One tap on Mark watched logs its next aired episode (S01E02 = id 52) in place…
  await lapsedRow.getByTestId("lapsed-mark").click();
  await expect(page.getByTestId("undo")).toContainText("Marked Lapsed Show S01E02 watched");
  await expect
    .poll(() => controls.historyPosts().some((w) => w.episodeIds.includes(52)))
    .toBe(true);

  // …and the fresh activity re-files it into Continue; it leaves the drawer.
  await expect(page.getByTestId("up-next-card").filter({ hasText: "Lapsed Show" })).toHaveCount(1);
  await expect(page.getByTestId("lapsed-drawer")).toHaveCount(0);
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

test("marking a season finale does not project a phantom episode into New/lead", async ({
  page,
}) => {
  // A show whose next is its last aired episode, dropped this week → it leads "New".
  // Marking it advances into a non-existent S01E03; the projection must NOT inherit
  // the finale's fresh air date and cling to the New/lead slot. It stays in Continue,
  // locked, until the authoritative refetch (which would then drop it as caught-up).
  const controls = await installLibraryRoutes(page.context(), [
    {
      trakt: 1,
      title: "Finale",
      status: "returning series",
      lastWatchedAt: agoIso(2),
      aired: 2,
      completed: 1,
      episodes: [
        { season: 1, number: 1, title: "One", firstAired: agoIso(9), traktId: 11 },
        { season: 1, number: 2, title: "Finale", firstAired: agoIso(1), traktId: 12 },
      ],
    },
  ]);
  controls.setWriteMode("delay"); // hold the POST open so the refetch can't replace the projection
  await page.goto("/");

  // Before: the freshly-aired finale (S01E02) leads the "New" group.
  const newGroup = page.getByTestId("up-next-new");
  await expect(newGroup.getByTestId("up-next-card")).toHaveCount(1);
  const card = page.getByTestId("up-next-card").first();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E02");

  await card.getByTestId("mark-watched").click();

  // The card advances to the (non-existent) S01E03 and locks…
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");
  await expect(card.getByTestId("mark-watched")).toBeDisabled();
  // …but the phantom NEVER clings to "New": that group empties, and the provisional
  // card sits under Continue instead — no fabricated finale-plus episode in the lead.
  await expect(page.getByTestId("up-next-new")).toHaveCount(0);
  await expect(page.getByTestId("up-next-continue").getByTestId("up-next-card")).toHaveCount(1);
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

test("an only-stopped library reads 'All your shows are stopped', not 'nothing tracked'", async ({
  page,
}) => {
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

test("a watchlist-only library reads 'Nothing started yet', not 'all caught up'", async ({
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

test("the Undo toast appears synchronously with the advance, before the write settles", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  controls.setWriteMode("delay"); // hold the POST open so the toast can't depend on it
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();

  await card.getByTestId("mark-watched").click();

  // The advance AND its confirmation/Undo appear together while the write is still
  // in flight — the button is still locked (pendingAdvance), so the toast is not
  // gated behind the write-queue pacing + network round-trip.
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");
  await expect(page.getByTestId("undo")).toContainText("Marked Solo S01E02 watched");
  await expect(page.getByTestId("undo-action")).toBeVisible();
  await expect(card.getByTestId("mark-watched")).toBeDisabled();
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

test("the point-of-action Undo is INLINE on the just-marked card — not only the bottom toast", async ({
  page,
}) => {
  // The core UX requirement here: "you still just have a toast as undo." The PRIMARY
  // reversal must live INLINE on the very card the mark happened on.
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E02");

  await card.getByTestId("mark-watched").click();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");

  // An inline Undo sits ON the card, confirming what just landed — not only the snackbar.
  const inlineUndo = card.getByTestId("mark-undo");
  await expect(inlineUndo).toContainText("Marked S01E02 watched");
  await expect(card.getByTestId("mark-undo-action")).toBeVisible();

  // It reuses the SAME reversal seam as the snackbar: it restores the card and issues
  // the stored inverse /sync/history/remove, then clears itself.
  await card.getByTestId("mark-undo-action").click();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E02");
  await expect(card.getByTestId("mark-undo")).toHaveCount(0);
  await expect.poll(() => controls.removePosts().length).toBe(1);
  expect(controls.removePosts()[0]?.episodeIds).toContain(12);
});

test("a double activation marks the episode exactly once — no duplicate history POST", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  // Immediate write mode ON PURPOSE (not `delay`): a second enqueued op would
  // dispatch on the next pacing tick (~1s, the write pacer's floor), so a 2s settle
  // window genuinely surfaces a duplicate if one ever escaped. `delay` would mask
  // it — the second POST would sit paced behind the 5s-held first, invisible to a
  // short poll no matter how broken the guard.
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E02");

  // Two synchronous activations in one task — before React can re-render and set
  // pendingAdvance — mimic a fast double-click / Enter key-repeat on the same card.
  await card.getByTestId("mark-watched").evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });

  // The card advances exactly once…
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");
  await expect.poll(() => controls.historyPosts().length).toBe(1);
  // …and no second POST reaches the network across a two-pacing-interval window.
  // The synchronous in-flight lock drops the second activation before it enqueues;
  // the queue's same-item coalescing is a second backstop for the pre-render burst.
  await page.waitForTimeout(2000);
  expect(controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(12);
});

test("a held-open write then an immediate Undo issues the ordered add-then-remove and restores the card", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [soloShow()]);
  // Keep the add POST in flight so Undo enqueues a compensating remove behind it —
  // the exact flow the opId-guarded failure path protects (never a lost intent).
  controls.setWriteMode("delay");
  await page.goto("/");
  const card = page.getByTestId("up-next-card").first();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E02");

  await card.getByTestId("mark-watched").click();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E03");
  await expect(page.getByTestId("undo")).toBeVisible();

  // Undo while the add is still held open: the card restores optimistically…
  await page.getByTestId("undo-action").click();
  await expect(card.getByTestId("episode-code")).toHaveText("S01E02");

  // …and both writes land in order — the add first (in flight), then its inverse remove.
  await expect.poll(() => controls.removePosts().length, { timeout: 12_000 }).toBe(1);
  expect(controls.writes().map((w) => w.path)).toEqual(["/sync/history", "/sync/history/remove"]);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(12);
  expect(controls.removePosts()[0]?.episodeIds).toContain(12);
  // The card stays restored once every write has settled (no bounce back to S01E03).
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
