import { expect, test } from "@playwright/test";
import {
  agoIso,
  installHermeticRoutes,
  installLibraryRoutes,
  installMovieRoutes,
  type MovieFixture,
  type ShowFixture,
  seedAuth,
  seedMediaVisibility,
} from "./helpers";

/** A movies-only viewer: shows turned off, movies on. The movie home is
 * then their sole tab, so any `/sync/watchlist/shows` read is a wrong-medium spend. */
const MOVIES_ONLY = { showsEnabled: false, moviesEnabled: true } as const;

const POSTER = "media.trakt.tv/p.webp";
const BACKDROP = "media.trakt.tv/b.webp";

/** A watched movie and a watchlist-only movie: one per honest movie segment. */
function movies(): MovieFixture[] {
  return [
    {
      trakt: 100,
      tmdb: 500,
      title: "Watched Movie",
      year: 2021,
      overview: "A duke's son leads desert warriors.",
      runtime: 155,
      released: "2021-10-22",
      posters: [POSTER],
      backdrops: [BACKDROP],
      watched: true,
    },
    {
      trakt: 200,
      tmdb: 600,
      title: "Queued Movie",
      year: 2020,
      overview: "A heist across dream layers.",
      runtime: 148,
      released: "2020-07-16",
      posters: [POSTER],
      backdrops: [BACKDROP],
      watched: false,
      inWatchlist: true,
    },
  ];
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedAuth(page.context());
});

test("the Movies tab groups films into collapsible Watchlist and Watched segments", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library?type=movies");

  // Honest taxonomy: Watchlist / Watched: the same chevron+count-badge idiom Shows use.
  const headings = page.getByTestId("pile-heading");
  await expect(headings).toHaveCount(2);
  await expect(headings.nth(0)).toContainText("Watchlist");
  await expect(headings.nth(1)).toContainText("Watched");
  await expect(headings.nth(0).getByTestId("pile-count")).toHaveText("1");
  await expect(headings.nth(1).getByTestId("pile-count")).toHaveText("1");

  // Watchlist (the actionable pool) opens first; Watched is a collapsed header.
  await expect(headings.nth(0)).toHaveAttribute("data-state", "open");
  await expect(headings.nth(1)).toHaveAttribute("data-state", "closed");
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Queued Movie" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Watched Movie" }),
  ).toHaveCount(0);

  // Expanding Watched mounts its tile (no fabricated episode-progress piles).
  await headings.nth(1).click();
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Watched Movie" }),
  ).toBeVisible();
});

test("the Movies tab has the same filter + sort chrome as Shows, with honest options", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library?type=movies");

  // Parity: the filter box and Sort control render for Movies too (the dropped chrome).
  await expect(page.getByTestId("library-filter")).toHaveAttribute("placeholder", "Filter movies…");
  const sort = page.getByTestId("sort-select");
  await expect(sort).toBeVisible();
  // Movie-appropriate sort keys: Release year replaces the meaningless "Progress".
  await expect(sort.locator("option", { hasText: "Release year" })).toHaveCount(1);
  await expect(sort.locator("option", { hasText: "Progress" })).toHaveCount(0);

  // The cross-segment filter surfaces a match in the collapsed Watched segment.
  await page.getByTestId("library-filter").fill("watched movie");
  await expect(page.getByTestId("filter-summary")).toContainText("1 matching movie");
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Watched Movie" }),
  ).toBeVisible();
});

test("the movie Sort control reorders films within a segment", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), [
    {
      trakt: 10,
      title: "Arrival",
      year: 2016,
      posters: [POSTER],
      watched: false,
      inWatchlist: true,
    },
    { trakt: 20, title: "Dune", year: 2021, posters: [POSTER], watched: false, inWatchlist: true },
  ]);
  await page.goto("/library?type=movies");

  // Default (recently-watched → A–Z for unwatched films): Arrival leads Watchlist.
  await expect(page.getByTestId("movie-library-card").first()).toContainText("Arrival");
  await page.getByTestId("sort-select").selectOption("release-year");
  await expect(page.getByTestId("movie-library-card").first()).toContainText("Dune");
});

test("Movies → movie detail → Back returns to the Movies tab (not Shows)", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library");

  // Selecting Movies writes ?type=movies into the URL (view-state, not local state).
  await page.getByTestId("type-movies").click();
  await expect(page).toHaveURL(/\/library\?type=movies/);

  // Queued Movie sits in the open Watchlist segment.
  await page.getByTestId("movie-library-card").filter({ hasText: "Queued Movie" }).click();
  await expect(page.getByTestId("movie-detail-title")).toContainText("Queued Movie");

  // History-aware back returns to Movies; the confirmed pre-fix bug reset it to Shows.
  await page.getByTestId("movie-back").click();
  await expect(page).toHaveURL(/\/library\?type=movies/);
  await expect(page.getByTestId("type-movies")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("pile-heading").first()).toBeVisible();
});

test("a deep link to ?type=movies opens the Movies tab directly", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library?type=movies");

  await expect(page.getByTestId("type-movies")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("pile-heading")).toHaveCount(2);
});

test("a movie card routes to the movie detail page", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library?type=movies");

  // Watched Movie lives in the collapsed Watched segment; open it, then tap through.
  await page.getByTestId("pile-heading").filter({ hasText: "Watched" }).click();
  await page.getByTestId("movie-library-card").filter({ hasText: "Watched Movie" }).click();
  await expect(page.getByTestId("movie-detail-title")).toContainText("Watched Movie");
  await expect(page).toHaveTitle("Watched Movie · Cue");
  await expect(page.getByTestId("movie-detail-overview")).toBeVisible();
  await expect(page.getByTestId("movie-runtime")).toContainText("155 min");
});

test("shows an empty state when the movie library is empty", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), []);
  await page.goto("/library?type=movies");
  await expect(page.getByTestId("movies-empty")).toBeVisible();
});

test("a watched-only library renders just Watched: no phantom empty Watchlist segment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), [
    { trakt: 100, tmdb: 500, title: "Watched Movie", year: 2021, posters: [POSTER], watched: true },
  ]);
  await page.goto("/library?type=movies");

  // Only the non-empty segment renders (parity with Shows, which drops empty buckets):
  // one "Watched" header, and crucially no "Watchlist (0)" phantom.
  const headings = page.getByTestId("pile-heading");
  await expect(headings).toHaveCount(1);
  await expect(headings.nth(0)).toContainText("Watched");
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Watchlist" })).toHaveCount(0);
  await expect(headings.nth(0).getByTestId("pile-count")).toHaveText("1");

  // Default-open falls back to the first non-empty segment when the preferred pile
  // (Watchlist) is absent, so the film is visible immediately: never stranded behind
  // a collapsed header with nothing else expanded.
  await expect(headings.nth(0)).toHaveAttribute("data-state", "open");
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Watched Movie" }),
  ).toBeVisible();
});

test("a watchlist-only library renders just the Watchlist segment, opened", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), [
    {
      trakt: 200,
      tmdb: 600,
      title: "Queued Movie",
      year: 2020,
      posters: [POSTER],
      watched: false,
      inWatchlist: true,
    },
  ]);
  await page.goto("/library?type=movies");

  const headings = page.getByTestId("pile-heading");
  await expect(headings).toHaveCount(1);
  await expect(headings.nth(0)).toContainText("Watchlist");
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Watched" })).toHaveCount(0);
  // Watchlist is the default-open segment, so the queued film is visible immediately.
  await expect(headings.nth(0)).toHaveAttribute("data-state", "open");
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Queued Movie" }),
  ).toBeVisible();
});

test("movie detail shows a 'More like this' related rail with inline watchlist add", async ({
  page,
}) => {
  const controls = await installMovieRoutes(
    page.context(),
    [
      {
        trakt: 100,
        tmdb: 500,
        title: "Watched Movie",
        year: 2021,
        posters: [POSTER],
        watched: true,
      },
    ],
    [
      {
        trakt: 300,
        tmdb: 700,
        title: "Related One",
        year: 2019,
        posters: [POSTER],
        watched: false,
      },
      {
        trakt: 400,
        tmdb: 800,
        title: "Related Two",
        year: 2018,
        posters: [POSTER],
        watched: false,
      },
    ],
  );
  await page.goto("/movie/100");

  const rail = page.getByTestId("movie-related");
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("heading", { name: "More like this" })).toBeVisible();
  await expect(rail.getByTestId("search-result")).toHaveCount(2);

  // Inline add on a related tile fires a movies[] watchlist POST (the SearchHit pipeline).
  await rail.getByTestId("search-add").first().click();
  await expect(rail.getByTestId("search-add").first()).toHaveText("Added");
  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.movieIds).toEqual([300]);
});

test("marks a movie watched with the movies[] history body and undoes it", async ({ page }) => {
  const controls = await installMovieRoutes(page.context(), movies());
  await page.goto("/movie/200"); // the watchlist-only (unwatched) movie

  const toggle = page.getByTestId("movie-watched-toggle");
  await expect(toggle).toHaveAttribute("data-on", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-on", "true"); // optimistic

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  const posted = controls.historyPosts()[0];
  expect(posted?.movieIds).toEqual([200]);
  expect(posted?.watchedAt).not.toBeNull();
  // The mark body is `{ movies: [{ ids, watched_at }] }`: the movie history shape.
  expect(posted?.movieItemKeys).toEqual(["ids", "watched_at"]);

  // Undo re-sends the stored movies[] remove-by-item inverse.
  await page.getByTestId("movie-undo-action").click();
  await expect.poll(() => controls.historyRemovePosts().length).toBe(1);
  expect(controls.historyRemovePosts()[0]?.movieIds).toEqual([200]);
});

test("adds a movie to the watchlist with the movies[] body", async ({ page }) => {
  const controls = await installMovieRoutes(page.context(), [
    { trakt: 100, tmdb: 500, title: "Watched Movie", year: 2021, posters: [POSTER], watched: true },
  ]);
  await page.goto("/movie/100");

  const watchlist = page.getByTestId("movie-watchlist-toggle");
  await expect(watchlist).toHaveText(/Add to watchlist/);
  await watchlist.click();
  await expect(watchlist).toHaveText(/On watchlist/); // optimistic

  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.movieIds).toEqual([100]);
});

test("the movie library shows only the user's own piles: no discovery browse wall", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await seedMediaVisibility(page.context(), MOVIES_ONLY);
  // Discovery routes are installed but must never be reached: the Library open path
  // no longer bolts a browse zone below the user's piles: discovery lives in the
  // Discover tab alone.
  const controls = await installMovieRoutes(page.context(), movies(), [], {
    trending: [
      {
        trakt: 900,
        tmdb: 950,
        title: "Trending Film",
        year: 2024,
        posters: [POSTER],
        watched: false,
      },
    ],
    popular: [
      {
        trakt: 901,
        tmdb: 951,
        title: "Popular Film",
        year: 2023,
        posters: [POSTER],
        watched: false,
      },
    ],
  });
  await page.goto("/library?type=movies");

  // The user's own library is what renders: the Watchlist pile of their tracked movies.
  await expect(page.getByTestId("screen-library")).toBeVisible();
  await expect(page.getByTestId("pile-heading").filter({ hasText: "Watchlist" })).toBeVisible();

  // No discovery browse zone colonizes the library. The two browse GETs left the
  // Library open path, so the trending/popular charts never fire.
  await expect(page.getByTestId("movie-discover")).toHaveCount(0);
  await expect(page.getByText("More to watch")).toHaveCount(0);
  // Give any errant discovery fetch the debounce/settle window to fire, then assert none did.
  await page.waitForTimeout(600);
  expect(controls.movieDiscoverReads()).toBe(0);
  expect(controls.showWatchlistReads()).toBe(0);
});

test("an empty movie library shows just its empty state: no discovery browse wall", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await seedMediaVisibility(page.context(), MOVIES_ONLY);
  const controls = await installMovieRoutes(page.context(), [], [], {
    trending: [
      {
        trakt: 900,
        tmdb: 950,
        title: "Trending Film",
        year: 2024,
        posters: [POSTER],
        watched: false,
      },
    ],
  });
  await page.goto("/library?type=movies");

  // The empty state stands alone: no browse wall dressed up as a "home". A
  // movies-only user with nothing tracked finds things in the Discover tab.
  await expect(page.getByTestId("movies-empty")).toBeVisible();
  await expect(page.getByTestId("movie-discover")).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(controls.movieDiscoverReads()).toBe(0);
  expect(controls.showWatchlistReads()).toBe(0);
});

test("the Watchlist orders by recently added (the movie's queue), newest first", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await installMovieRoutes(page.context(), [
    {
      trakt: 10,
      title: "Added First",
      year: 2016,
      posters: [POSTER],
      watched: false,
      inWatchlist: true,
      listedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      trakt: 20,
      title: "Added Later",
      year: 2015,
      posters: [POSTER],
      watched: false,
      inWatchlist: true,
      listedAt: "2026-06-01T00:00:00.000Z",
    },
  ]);
  await page.goto("/library?type=movies");

  // Default (recently-*) means recently ADDED for the unwatched Watchlist: a film
  // has no watch date: so the most recently queued film leads, even though it
  // sorts later by both title and release year.
  await expect(page.getByTestId("movie-library-card").first()).toContainText("Added Later");
  // A–Z still sorts by title, so the earlier-added-but-alphabetically-first leads.
  await page.getByTestId("sort-select").selectOption("alphabetical");
  await expect(page.getByTestId("movie-library-card").first()).toContainText("Added First");
});

test("a both-user on the Shows tab does not fetch the movie library until Movies is opened", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  const show: ShowFixture = {
    trakt: 1,
    title: "A Show",
    status: "returning series",
    lastWatchedAt: agoIso(2),
    aired: 3,
    completed: 1,
    episodes: [
      { season: 1, number: 1, title: "E1", firstAired: agoIso(10), traktId: 11 },
      { season: 1, number: 2, title: "E2", firstAired: agoIso(9), traktId: 12 },
      { season: 1, number: 3, title: "E3", firstAired: agoIso(8), traktId: 13 },
    ],
  };
  await installLibraryRoutes(page.context(), [show]);
  const movieControls = await installMovieRoutes(page.context(), movies());
  await page.goto("/library");

  // A both-user boots into Shows; the read must be gated by the ACTIVE medium, so
  // the movie library is not fetched while the user is looking at shows.
  await expect(page.getByTestId("type-shows")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("pile-heading").first()).toBeVisible();
  await expect.poll(() => movieControls.movieLibraryReads()).toBe(0);

  // Opening Movies pulls the movie library exactly then: not a moment sooner.
  await page.getByTestId("type-movies").click();
  await expect(page).toHaveURL(/\/library\?type=movies/);
  await expect(page.getByTestId("pile-heading").first()).toBeVisible();
  await expect.poll(() => movieControls.movieLibraryReads()).toBeGreaterThan(0);
});
