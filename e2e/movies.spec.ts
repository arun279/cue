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

/** A movies-only viewer: shows turned off, movies on. */
const MOVIES_ONLY = { showsEnabled: false, moviesEnabled: true } as const;

const POSTER = "media.trakt.tv/p.webp";
const BACKDROP = "media.trakt.tv/b.webp";

/** A watched movie and a watchlist-only movie: one per honest movie chip. */
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

test("the Movies segment carries Watchlist/Watched status chips with counts", async ({ page }) => {
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library?type=movies");

  // Honest movie taxonomy: Watchlist / Watched: no fabricated episode progress.
  const watchlistChip = page.getByTestId("chip-watchlist");
  const watchedChip = page.getByTestId("chip-watched");
  await expect(watchlistChip).toContainText("Watchlist");
  await expect(watchlistChip).toContainText("1");
  await expect(watchedChip).toContainText("Watched");
  await expect(watchedChip).toContainText("1");

  // Watchlist (the actionable pool) is the default-active chip.
  await expect(watchlistChip).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Queued Movie" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Watched Movie" }),
  ).toHaveCount(0);

  // Switching chips swaps the grid; the watched tile carries no year badge but
  // its done state.
  await watchedChip.click();
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Watched Movie" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Queued Movie" }),
  ).toHaveCount(0);
});

test("the title filter lives behind its icon and scopes the active chip", async ({ page }) => {
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library?type=movies");

  // The filter field is hidden until the tool is toggled.
  await expect(page.getByTestId("library-filter")).toHaveCount(0);
  await page.getByTestId("library-filter-toggle").click();
  const field = page.getByTestId("library-filter");
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute("placeholder", "Filter by title…");

  // A non-match reads honest empty copy with a way back.
  await field.fill("watched movie");
  await expect(page.getByTestId("library-empty-watchlist")).toContainText(
    'No movies match "watched movie".',
  );
  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Queued Movie" }),
  ).toBeVisible();
});

test("the sort sheet reorders films within a chip (movie-honest options)", async ({ page }) => {
  await installMovieRoutes(page.context(), [
    {
      trakt: 10,
      title: "Arrival",
      year: 2016,
      posters: [POSTER],
      watched: false,
      inWatchlist: true,
      listedAt: "2026-06-01T00:00:00.000Z",
    },
    {
      trakt: 20,
      title: "Dune",
      year: 2021,
      posters: [POSTER],
      watched: false,
      inWatchlist: true,
      listedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  await page.goto("/library?type=movies");

  // Default (recently added for an unwatched Watchlist): Arrival (June) leads.
  await expect(page.getByTestId("movie-library-card").first()).toContainText("Arrival");

  // Release year is offered instead of the meaningless "Progress".
  await page.getByTestId("library-sort").click();
  await expect(page.getByTestId("sort-progress")).toHaveCount(0);
  await page.getByTestId("sort-release-year").click();
  await expect(page.getByTestId("movie-library-card").first()).toContainText("Dune");

  // A-Z still sorts by title.
  await page.getByTestId("library-sort").click();
  await page.getByTestId("sort-alphabetical").click();
  await expect(page.getByTestId("movie-library-card").first()).toContainText("Arrival");
});

test("Movies → movie detail → Back returns to the Movies segment (not Shows)", async ({ page }) => {
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library");

  // Selecting Movies writes ?type=movies into the URL (view-state, not local state).
  await page.getByTestId("type-movies").click();
  await expect(page).toHaveURL(/\/library\?type=movies/);

  await page.getByTestId("movie-library-card").filter({ hasText: "Queued Movie" }).click();
  await expect(page.getByTestId("movie-detail-title")).toContainText("Queued Movie");
  await expect(page).toHaveTitle("Queued Movie · Cue");

  // History-aware back returns to Movies; the confirmed pre-fix bug reset it to Shows.
  await page.getByTestId("movie-back").click();
  await expect(page).toHaveURL(/\/library\?type=movies/);
  await expect(page.getByTestId("chip-watchlist")).toBeVisible();
});

test("a deep link to ?type=movies opens the Movies segment directly", async ({ page }) => {
  await installMovieRoutes(page.context(), movies());
  await page.goto("/library?type=movies");

  await expect(page.getByTestId("chip-watchlist")).toBeVisible();
  await expect(page.getByTestId("chip-watched")).toBeVisible();
  // The show chips are absent: this is the movie taxonomy.
  await expect(page.getByTestId("chip-watching")).toHaveCount(0);
});

test("movie detail renders the hero, meta, overview, and mark row", async ({ page }) => {
  await installMovieRoutes(page.context(), movies());
  await page.goto("/movie/100");

  await expect(page.getByTestId("movie-detail-title")).toContainText("Watched Movie");
  await expect(page.getByTestId("screen-movie-detail")).toContainText("155 min");
  await expect(page.getByTestId("movie-detail-overview")).toBeVisible();
  const markRow = page.getByTestId("movie-mark-row");
  await expect(markRow).toContainText("Watched");
  await expect(page.getByTestId("movie-check")).toHaveAttribute("data-state", "watched");
});

test("shows honest empty copy when the movie library is empty", async ({ page }) => {
  await installMovieRoutes(page.context(), []);
  await page.goto("/library?type=movies");
  await expect(page.getByTestId("library-empty-watchlist")).toContainText(
    "Things you want to watch land here.",
  );
});

test("marks a movie watched with the movies[] history body and undoes it", async ({ page }) => {
  const controls = await installMovieRoutes(page.context(), movies());
  await page.goto("/movie/200"); // the watchlist-only (unwatched) movie

  const check = page.getByTestId("movie-check");
  await expect(check).toHaveAttribute("data-state", "unwatched");
  await expect(page.getByTestId("movie-mark-row")).toContainText("Not watched yet");
  await check.click();
  await expect(check).toHaveAttribute("data-state", "watched"); // optimistic

  await expect.poll(() => controls.historyPosts().length).toBe(1);
  const posted = controls.historyPosts()[0];
  expect(posted?.movieIds).toEqual([200]);
  expect(posted?.watchedAt).not.toBeNull();
  // The mark body is `{ movies: [{ ids, watched_at }] }`: the movie history shape.
  expect(posted?.movieItemKeys).toEqual(["ids", "watched_at"]);

  // The one snackbar confirms; Undo re-sends the stored movies[] remove-by-item inverse.
  await expect(page.getByTestId("snackbar")).toContainText("Queued Movie marked");
  await page.getByTestId("snackbar-undo").click();
  await expect.poll(() => controls.historyRemovePosts().length).toBe(1);
  expect(controls.historyRemovePosts()[0]?.movieIds).toEqual([200]);
  await expect(check).toHaveAttribute("data-state", "unwatched");
});

test("unmarking a settled watch removes the single play by its exact history id", async ({
  page,
}) => {
  const controls = await installMovieRoutes(page.context(), movies());
  await page.goto("/movie/100"); // watched long ago (a settled play)

  const check = page.getByTestId("movie-check");
  await expect(check).toHaveAttribute("data-state", "watched");
  await check.click();

  // Per-play-safe: the resolved history id (trakt 100 → play 1001), never an
  // item-scoped movies[] wipe.
  await expect.poll(() => controls.historyRemovePosts().length).toBe(1);
  const removed = controls.historyRemovePosts()[0];
  expect(removed?.ids).toEqual([1001]);
  expect(removed?.movieItemKeys).toBeUndefined();
  await expect(page.getByTestId("snackbar")).toContainText("Removed play");
  await expect(check).toHaveAttribute("data-state", "unwatched");
});

test("unmarking a REWATCHED movie is refused and routed to the watch history", async ({ page }) => {
  const rewatched: MovieFixture[] = [
    {
      trakt: 100,
      tmdb: 500,
      title: "Watched Movie",
      year: 2021,
      posters: [POSTER],
      watched: true,
      rewatched: true,
    },
  ];
  const controls = await installMovieRoutes(page.context(), rewatched);
  await page.goto("/movie/100");

  const check = page.getByTestId("movie-check");
  await expect(check).toHaveAttribute("data-state", "watched");
  await check.click();

  // Two plays: the wipe is refused; the notice routes per-play removal to History.
  await expect(page.getByTestId("snackbar")).toContainText("2 plays");
  await expect(page.getByTestId("snackbar")).toContainText("watch history");
  await expect(check).toHaveAttribute("data-state", "watched");
  expect(controls.historyRemovePosts()).toHaveLength(0);
});

test("the overflow toggles the watchlist with the movies[] body", async ({ page }) => {
  const controls = await installMovieRoutes(page.context(), [
    { trakt: 100, tmdb: 500, title: "Watched Movie", year: 2021, posters: [POSTER], watched: true },
  ]);
  await page.goto("/movie/100");

  await page.getByTestId("movie-overflow").click();
  await expect(page.getByTestId("overflow-watchlist")).toHaveText("Add to Watchlist");
  await page.getByTestId("overflow-watchlist").click();

  await expect(page.getByTestId("snackbar")).toContainText("Watched Movie added to Watchlist");
  await expect.poll(() => controls.watchlistPosts().length).toBe(1);
  expect(controls.watchlistPosts()[0]?.movieIds).toEqual([100]);

  // The membership flipped: the overflow now offers removal.
  await page.getByTestId("movie-overflow").click();
  await expect(page.getByTestId("overflow-watchlist")).toHaveText("Remove from Watchlist");
});

test("movie detail shows a 'More like this' grid routing to other movies", async ({ page }) => {
  await installMovieRoutes(
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
      {
        trakt: 300,
        tmdb: 700,
        title: "Related One",
        year: 2019,
        posters: [POSTER],
        watched: false,
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
  await expect(rail.getByTestId("movie-related-tile")).toHaveCount(2);

  await rail.getByTestId("movie-related-tile").first().click();
  await expect(page.getByTestId("movie-detail-title")).toContainText("Related One");
});

test("the movie library never reaches for discovery charts or the show watchlist", async ({
  page,
}) => {
  await seedMediaVisibility(page.context(), MOVIES_ONLY);
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

  await expect(page.getByTestId("screen-library")).toBeVisible();
  await expect(
    page.getByTestId("movie-library-card").filter({ hasText: "Queued Movie" }),
  ).toBeVisible();

  // No discovery browse zone colonizes the library, and no wrong-medium read
  // fires: discovery lives on the Search tab alone.
  await page.waitForTimeout(600);
  expect(controls.movieDiscoverReads()).toBe(0);
  expect(controls.showWatchlistReads()).toBe(0);
});

test("the Watchlist chip orders by recently added (the movie's queue), newest first", async ({
  page,
}) => {
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

  // Default (recently-*) means recently ADDED for the unwatched Watchlist: the
  // most recently queued film leads, even though it sorts later by both title
  // and release year.
  await expect(page.getByTestId("movie-library-card").first()).toContainText("Added Later");
  await page.getByTestId("library-sort").click();
  await page.getByTestId("sort-alphabetical").click();
  await expect(page.getByTestId("movie-library-card").first()).toContainText("Added First");
});

test("a both-user on the Shows segment does not fetch the movie library until Movies is opened", async ({
  page,
}) => {
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

  // A both-user boots into Shows; the read must be gated by the ACTIVE medium.
  await expect(page.getByTestId("library-card").first()).toBeVisible();
  await expect.poll(() => movieControls.movieLibraryReads()).toBe(0);

  // Opening Movies pulls the movie library exactly then: not a moment sooner.
  await page.getByTestId("type-movies").click();
  await expect(page).toHaveURL(/\/library\?type=movies/);
  await expect(page.getByTestId("movie-library-card").first()).toBeVisible();
  await expect.poll(() => movieControls.movieLibraryReads()).toBeGreaterThan(0);
});
