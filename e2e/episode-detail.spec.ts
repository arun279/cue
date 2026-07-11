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

/** A show with two watched episodes, an aired-unwatched next, and an unaired tail. */
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

test("shows the still, title, code, air date, overview, and prev/next within the show", async ({
  page,
}) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1/episode/1/2");

  await expect(page.getByTestId("episode-detail-code")).toHaveText("S01E02");
  await expect(page.getByTestId("episode-detail-title")).toContainText("Episode 2");
  await expect(page).toHaveTitle("The Detail Show · S01E02 · Cue");
  await expect(page.getByTestId("episode-detail-overview")).toContainText("deepens the mystery");
  await expect(page.getByTestId("episode-air-date")).toBeVisible();
  await expect(page.getByTestId("episode-still")).toBeVisible();
  // A watched episode: the Cue mark reads as done and surfaces its watched date.
  await expect(page.getByTestId("episode-watched-toggle")).toHaveAttribute("data-on", "true");
  await expect(page.getByTestId("episode-watched-date")).toBeVisible();

  // Prev = S01E01, Next = S01E03.
  await expect(page.getByTestId("episode-prev")).toContainText("S01E01");
  await expect(page.getByTestId("episode-next")).toContainText("S01E03");
});

test("toggling watched OFF removes the single play by its exact history id: never an item-scoped wipe", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1/episode/1/2");

  const toggle = page.getByTestId("episode-watched-toggle");
  await expect(toggle).toHaveAttribute("data-on", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-on", "false"); // optimistic

  await expect.poll(() => controls.removePosts().length).toBe(1);
  const removed = controls.removePosts()[0];
  // Per-play-safe: removed by the resolved history-event id (S01E02 trakt 12 → play
  // 121), NOT an item-scoped `{episodes:[{ids}]}` body that would wipe every play.
  expect(removed?.ids).toEqual([121]);
  expect(removed?.episodeIds).toEqual([]);
  expect(removed?.episodeItemKeys).toBeUndefined();
});

test("unchecking a REWATCHED episode is refused: the extra play survives, per-play removal points to the Diary", async ({
  page,
}) => {
  const rewatch: ShowFixture = { ...detailShow(), rewatchedEpisodeIds: [12] };
  const controls = await installLibraryRoutes(page.context(), [rewatch]);
  await page.goto("/show/1/episode/1/2");

  const toggle = page.getByTestId("episode-watched-toggle");
  await expect(toggle).toHaveAttribute("data-on", "true");
  await toggle.click();

  // The unmark is refused: no destructive remove fires and the done state returns.
  await expect(page.getByTestId("episode-watched-notice")).toContainText(/plays/i);
  await expect(toggle).toHaveAttribute("data-on", "true");
  expect(controls.removePosts()).toHaveLength(0);
});

test("toggling watched ON marks via POST /sync/history and shows the watched date", async ({
  page,
}) => {
  const controls = await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1/episode/1/3"); // aired but unwatched

  const toggle = page.getByTestId("episode-watched-toggle");
  await expect(toggle).toHaveAttribute("data-on", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-on", "true");

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  expect(controls.historyPosts()[0]?.episodeIds).toContain(13);
  await expect(page.getByTestId("episode-watched-date")).toBeVisible();
});

test("a details-unavailable episode still renders and the watched toggle still works", async ({
  page,
}) => {
  const show = detailShow();
  // Episode 3 has no overview → the "details not available yet" partial state.
  const noOverview: ShowFixture = {
    ...show,
    episodes: show.episodes.map((e) => (e.number === 3 ? { ...e, overview: undefined } : e)),
  };
  const controls = await installLibraryRoutes(page.context(), [noOverview]);
  await page.goto("/show/1/episode/1/3");

  await expect(page.getByTestId("episode-detail-empty")).toBeVisible();
  await page.getByTestId("episode-watched-toggle").click();
  await expect.poll(() => controls.historyPosts().length).toBe(1);
});

test("an unaired episode locks the watched toggle", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1/episode/1/4"); // future
  await expect(page.getByTestId("episode-watched-toggle")).toBeDisabled();
});

test("prev/next navigate between episodes within the show", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/show/1/episode/1/2");

  await page.getByTestId("episode-next").click();
  await expect(page.getByTestId("episode-detail-code")).toHaveText("S01E03");
  await page.getByTestId("episode-prev").click();
  await expect(page.getByTestId("episode-detail-code")).toHaveText("S01E02");
});

test("Up Next links into the episode detail of the next episode", async ({ page }) => {
  await installLibraryRoutes(page.context(), [detailShow()]);
  await page.goto("/");

  await page.getByTestId("up-next-card-link").first().click();
  await expect(page.getByTestId("screen-episode-detail")).toBeVisible();
  await expect(page.getByTestId("episode-detail-code")).toHaveText("S01E03");
});
