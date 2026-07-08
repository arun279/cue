import { TRAKT_API_BASE, TraktClient } from "@data/trakt/client";
import {
  getEpisode,
  getEpisodePlays,
  getHidden,
  getHistory,
  getLastActivities,
  getMovie,
  getMyShowsCalendar,
  getPopularMovies,
  getPopularShows,
  getRatings,
  getRelatedMovies,
  getShow,
  getShowPlays,
  getShowProgress,
  getShowSeasons,
  getTrendingMovies,
  getTrendingShows,
  getUserStats,
  getWatchedMovies,
  getWatchedShows,
  getWatchlist,
  itemsBody,
  searchTrakt,
} from "@data/trakt/endpoints";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "./_msw";

const server = mswServer();
const client = new TraktClient({ clientId: "cid" });

function getJson(path: string, body: unknown): void {
  server.use(http.get(`${TRAKT_API_BASE}${path}`, () => HttpResponse.json(body as never)));
}

const showObj = {
  title: "Severance",
  year: 2022,
  status: "returning series",
  ids: { trakt: 1, tmdb: 95396 },
};
const movieObj = { title: "Dune", year: 2021, ids: { trakt: 5, tmdb: 438631 } };
const episodeObj = {
  season: 1,
  number: 3,
  title: "In Perpetuity",
  first_aired: "2022-02-25T13:00:00.000Z",
  ids: { trakt: 42 },
};

describe("Trakt read endpoints zod-parse well-formed fixtures", () => {
  it("parses watched shows", async () => {
    getJson("/sync/watched/shows", [
      {
        last_watched_at: "2026-07-01T00:00:00.000Z",
        plays: 3,
        show: { ...showObj, images: { poster: ["media.trakt.tv/p.webp"] } },
      },
    ]);
    const result = await getWatchedShows(client);
    expect(result.ok && result.data[0]?.show.title).toBe("Severance");
    expect(result.ok && result.data[0]?.show.images?.poster).toEqual(["media.trakt.tv/p.webp"]);
  });

  it("parses watched movies", async () => {
    getJson("/sync/watched/movies", [{ plays: 1, movie: movieObj }]);
    const result = await getWatchedMovies(client);
    expect(result.ok && result.data[0]?.movie.title).toBe("Dune");
  });

  it("parses the extended movie detail payload", async () => {
    getJson("/movies/5", {
      ...movieObj,
      overview: "A duke's son leads desert warriors.",
      runtime: 155,
      released: "2021-10-22",
      genres: ["science fiction"],
      images: { poster: ["media.trakt.tv/p.webp"], fanart: ["media.trakt.tv/b.webp"] },
    });
    const result = await getMovie(client, 5);
    expect(result.ok && result.data.title).toBe("Dune");
    expect(result.ok && result.data.runtime).toBe(155);
    expect(result.ok && result.data.released).toBe("2021-10-22");
    expect(result.ok && result.data.images?.fanart).toEqual(["media.trakt.tv/b.webp"]);
  });

  it("parses per-show progress with next_episode", async () => {
    getJson("/shows/1/progress/watched", {
      aired: 9,
      completed: 3,
      last_watched_at: "2026-07-01T00:00:00.000Z",
      next_episode: episodeObj,
      seasons: [{ number: 1, aired: 9, completed: 3, episodes: [{ number: 3, completed: true }] }],
    });
    const result = await getShowProgress(client, 1);
    expect(result.ok && result.data.next_episode?.number).toBe(3);
    expect(result.ok && result.data.aired).toBe(9);
  });

  it("parses a null next_episode (caught up)", async () => {
    getJson("/shows/1/progress/watched", { aired: 9, completed: 9, next_episode: null });
    const result = await getShowProgress(client, 1);
    expect(result.ok && result.data.next_episode).toBeNull();
  });

  it("opts specials into the progress payload only when asked", async () => {
    const specialsSeen: (string | null)[] = [];
    server.use(
      http.get(`${TRAKT_API_BASE}/shows/1/progress/watched`, ({ request }) => {
        specialsSeen.push(new URL(request.url).searchParams.get("specials"));
        return HttpResponse.json({ aired: 1, completed: 0, next_episode: null });
      }),
    );
    await getShowProgress(client, 1);
    await getShowProgress(client, 1, true);
    expect(specialsSeen).toEqual(["false", "true"]);
  });

  it("parses the extended show detail payload", async () => {
    getJson("/shows/1", {
      ...showObj,
      overview: "A workplace mystery.",
      network: "Apple TV+",
      first_aired: "2022-02-18T00:00:00.000Z",
      images: { poster: ["media.trakt.tv/p.webp"], fanart: ["media.trakt.tv/b.webp"] },
    });
    const result = await getShow(client, 1);
    expect(result.ok && result.data.network).toBe("Apple TV+");
    expect(result.ok && result.data.images?.fanart).toEqual(["media.trakt.tv/b.webp"]);
  });

  it("parses the seasons tree with episodes", async () => {
    getJson("/shows/1/seasons", [
      { number: 1, title: "Season 1", episodes: [episodeObj] },
      { number: 0, title: "Specials", episodes: [] },
    ]);
    const result = await getShowSeasons(client, 1);
    expect(result.ok && result.data.map((s) => s.number)).toEqual([1, 0]);
    expect(result.ok && result.data[0]?.episodes?.[0]?.number).toBe(3);
  });

  it("parses a single extended episode with overview + runtime", async () => {
    getJson("/shows/1/seasons/1/episodes/3", {
      ...episodeObj,
      overview: "A workplace mystery deepens.",
      runtime: 47,
      images: { screenshot: ["media.trakt.tv/still.webp"] },
    });
    const result = await getEpisode(client, 1, 1, 3);
    expect(result.ok && result.data.overview).toBe("A workplace mystery deepens.");
    expect(result.ok && result.data.runtime).toBe(47);
    expect(result.ok && result.data.images?.screenshot).toEqual(["media.trakt.tv/still.webp"]);
  });

  it("parses watchlist items", async () => {
    getJson("/sync/watchlist/shows", [
      { rank: 1, listed_at: "2026-06-01T00:00:00.000Z", type: "show", show: showObj },
    ]);
    const result = await getWatchlist(client, "shows");
    expect(result.ok && result.data[0]?.type).toBe("show");
  });

  it("parses ratings items", async () => {
    getJson("/sync/ratings/shows", [
      { rated_at: "2026-06-01T00:00:00.000Z", rating: 9, type: "show", show: showObj },
    ]);
    const result = await getRatings(client, "shows");
    expect(result.ok && result.data[0]?.rating).toBe(9);
  });

  it("parses the personalized shows calendar", async () => {
    getJson("/calendars/my/shows/2026-07-05/7", [
      { first_aired: "2026-07-06T01:00:00.000Z", episode: episodeObj, show: showObj },
    ]);
    const result = await getMyShowsCalendar(client, "2026-07-05", 7);
    expect(result.ok && result.data[0]?.episode.number).toBe(3);
  });

  it("parses search results", async () => {
    getJson("/search/show,movie", [{ type: "show", score: 42.5, show: showObj }]);
    const result = await searchTrakt(client, "severance");
    expect(result.ok && result.data[0]?.show?.title).toBe("Severance");
  });

  it("parses trending shows (watcher-wrapped rows)", async () => {
    getJson("/shows/trending", [
      { watchers: 120, show: { ...showObj, images: { poster: ["t.webp"] } } },
    ]);
    const result = await getTrendingShows(client);
    expect(result.ok && result.data[0]?.watchers).toBe(120);
    expect(result.ok && result.data[0]?.show.title).toBe("Severance");
  });

  it("parses popular shows (bare show list)", async () => {
    getJson("/shows/popular", [showObj]);
    const result = await getPopularShows(client);
    expect(result.ok && result.data[0]?.ids.trakt).toBe(1);
  });

  it("parses trending movies (watcher-wrapped rows)", async () => {
    getJson("/movies/trending", [
      { watchers: 80, movie: { ...movieObj, images: { poster: ["m.webp"] } } },
    ]);
    const result = await getTrendingMovies(client);
    expect(result.ok && result.data[0]?.watchers).toBe(80);
    expect(result.ok && result.data[0]?.movie.title).toBe("Dune");
  });

  it("parses popular movies (bare movie list)", async () => {
    getJson("/movies/popular", [movieObj]);
    const result = await getPopularMovies(client);
    expect(result.ok && result.data[0]?.ids.trakt).toBe(5);
  });

  it("parses related movies (bare movie list)", async () => {
    getJson("/movies/5/related", [movieObj]);
    const result = await getRelatedMovies(client, 5);
    expect(result.ok && result.data[0]?.title).toBe("Dune");
  });

  it("parses hidden progress_watched items", async () => {
    getJson("/users/hidden/progress_watched", [
      { hidden_at: "2026-05-01T00:00:00.000Z", type: "show", show: showObj },
    ]);
    const result = await getHidden(client);
    expect(result.ok && result.data[0]?.show?.ids.trakt).toBe(1);
  });

  it("parses user stats, stripping the sections Profile ignores", async () => {
    getJson("/users/me/stats", {
      movies: { plays: 200, watched: 114, minutes: 15_650, collected: 933 },
      shows: { watched: 40, collected: 46 },
      seasons: { ratings: 2 },
      episodes: { plays: 552, watched: 534, minutes: 17_330 },
      network: { friends: 1 },
    });
    const result = await getUserStats(client);
    expect(result.ok && result.data.episodes.watched).toBe(534);
    expect(result.ok && result.data.episodes.minutes).toBe(17_330);
    expect(result.ok && result.data.movies.watched).toBe(114);
    expect(result.ok && result.data.shows.watched).toBe(40);
    // Stripped extras must not survive the parse.
    expect(result.ok && "network" in result.data).toBe(false);
  });

  it("parses last_activities into the domain shape", async () => {
    getJson("/sync/last_activities", {
      all: "2026-07-01T00:00:00.000Z",
      episodes: { watched_at: "2026-07-01T00:00:00.000Z" },
    });
    const result = await getLastActivities(client);
    expect(result.ok && result.data.episodes?.["watched_at"]).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("watched endpoints send the honest post-#775 payload params", () => {
  it("requests compact watched shows (no extended) with an explicit page limit", async () => {
    let seen: URL | undefined;
    server.use(
      http.get(`${TRAKT_API_BASE}/sync/watched/shows`, ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json([]);
      }),
    );
    await getWatchedShows(client);
    // No `extended`: `full` is a no-op and images aren't returned inline; shows get
    // their art from `/shows/:id` in the library fan-out.
    expect(seen?.searchParams.get("extended")).toBeNull();
    expect(seen?.searchParams.get("limit")).toBe("100");
  });

  it("keeps images (drops full) on watched movies so their posters survive", async () => {
    let seen: URL | undefined;
    server.use(
      http.get(`${TRAKT_API_BASE}/sync/watched/movies`, ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json([]);
      }),
    );
    await getWatchedMovies(client);
    // Movies have no per-movie detail fetch in the library, so their poster art
    // comes from THIS call — `images` must stay (only the no-op `full` is dropped).
    expect(seen?.searchParams.get("extended")).toBe("images");
    expect(seen?.searchParams.get("limit")).toBe("100");
  });
});

describe("malformed bodies throw a zod error", () => {
  it("throws when a watched show is missing its ids", async () => {
    getJson("/sync/watched/shows", [{ show: { title: "No Ids" } }]);
    await expect(getWatchedShows(client)).rejects.toThrow();
  });

  it("throws when a movie payload is missing its title", async () => {
    getJson("/movies/5", { year: 2021, ids: { trakt: 5 } });
    await expect(getMovie(client, 5)).rejects.toThrow();
  });

  it("throws when progress omits required counts", async () => {
    getJson("/shows/1/progress/watched", { next_episode: null });
    await expect(getShowProgress(client, 1)).rejects.toThrow();
  });

  it("throws when user stats omit a required section", async () => {
    getJson("/users/me/stats", { movies: { watched: 1, minutes: 90 }, shows: { watched: 1 } });
    await expect(getUserStats(client)).rejects.toThrow();
  });

  it("throws when the body is not JSON (null)", async () => {
    server.use(
      http.get(
        `${TRAKT_API_BASE}/sync/last_activities`,
        () => new HttpResponse("not json", { headers: { "content-type": "text/plain" } }),
      ),
    );
    await expect(getLastActivities(client)).rejects.toThrow();
  });

  it("passes transport failures through without parsing", async () => {
    server.use(
      http.get(
        `${TRAKT_API_BASE}/sync/watched/shows`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    );
    expect(await getWatchedShows(client)).toEqual({ ok: false, error: { kind: "unauthorized" } });
  });
});

describe("getHistory (the Diary feed)", () => {
  const historyRow = {
    id: 1982,
    watched_at: "2026-07-05T21:00:00.000Z",
    action: "scrobble",
    type: "episode",
    episode: episodeObj,
    show: showObj,
  };

  it("reads one page of /users/me/history with paging + inline art, carrying pagination", async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${TRAKT_API_BASE}/users/me/history`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json([historyRow] as never, {
          headers: { "X-Pagination-Page": "1", "X-Pagination-Page-Count": "4" },
        });
      }),
    );
    const result = await getHistory(client, "all", 1);
    expect(result.ok && result.data[0]?.id).toBe(1982);
    // The paging position is what the infinite query walks; NEVER a full page walk.
    expect(result.ok && result.pagination?.pageCount).toBe(4);
    expect(url?.searchParams.get("page")).toBe("1");
    expect(url?.searchParams.get("limit")).toBe("30");
    expect(url?.searchParams.get("extended")).toBe("full,images");
  });

  it("scopes to the episodes slice for the TV filter", async () => {
    let path: string | undefined;
    server.use(
      http.get(`${TRAKT_API_BASE}/users/me/history/episodes`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json([] as never, {
          headers: { "X-Pagination-Page": "2", "X-Pagination-Page-Count": "2" },
        });
      }),
    );
    const result = await getHistory(client, "episodes", 2);
    expect(result.ok).toBe(true);
    expect(path).toBe("/users/me/history/episodes");
  });

  it("throws on a malformed history row (missing the play id)", async () => {
    getJson("/users/me/history", [{ watched_at: "x", type: "movie" }]);
    await expect(getHistory(client, "all", 1)).rejects.toThrow();
  });
});

describe("scoped-history resolvers (durable per-play unmark)", () => {
  const playRow = (id: number, season: number, number: number, episodeTrakt: number) => ({
    id,
    watched_at: "2026-07-05T21:00:00.000Z",
    action: "scrobble",
    type: "episode",
    episode: { season, number, title: `E${number}`, ids: { trakt: episodeTrakt } },
    show: { title: "The Detail Show", ids: { trakt: 1 } },
  });

  it("walks every page of /sync/history/shows/:id, flattening the plays", async () => {
    let firstUrl: URL | undefined;
    server.use(
      http.get(`${TRAKT_API_BASE}/sync/history/shows/1`, ({ request }) => {
        const url = new URL(request.url);
        const page = url.searchParams.get("page");
        if (firstUrl === undefined) firstUrl = url;
        return HttpResponse.json(
          page === "2" ? ([playRow(2, 1, 2, 12)] as never) : ([playRow(1, 1, 1, 11)] as never),
          { headers: { "X-Pagination-Page": page ?? "1", "X-Pagination-Page-Count": "2" } },
        );
      }),
    );
    const result = await getShowPlays(client, 1);
    expect(result.ok && result.data.map((r) => r.id)).toEqual([1, 2]);
    expect(firstUrl?.pathname).toBe("/sync/history/shows/1");
    expect(firstUrl?.searchParams.get("extended")).toBe("full");
  });

  it("reads one item's plays from /sync/history/episodes/:id", async () => {
    let path: string | undefined;
    server.use(
      http.get(`${TRAKT_API_BASE}/sync/history/episodes/12`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json([playRow(1, 1, 2, 12), playRow(2, 1, 2, 12)] as never, {
          headers: { "X-Pagination-Page": "1", "X-Pagination-Page-Count": "1" },
        });
      }),
    );
    const result = await getEpisodePlays(client, 12);
    expect(path).toBe("/sync/history/episodes/12");
    // Two rows for one episode = a rewatch; both plays (with distinct ids) come back.
    expect(result.ok && result.data.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("itemsBody composes remove-by-item bodies", () => {
  it("builds a single populated section", () => {
    expect(itemsBody({ episodes: [{ trakt: 42 }] })).toEqual({
      episodes: [{ ids: { trakt: 42 } }],
    });
  });

  it("builds multiple sections and omits empty ones", () => {
    expect(itemsBody({ shows: [{ trakt: 1 }], movies: [{ trakt: 5 }], episodes: [] })).toEqual({
      shows: [{ ids: { trakt: 1 } }],
      movies: [{ ids: { trakt: 5 } }],
    });
  });

  it("returns an empty body when nothing is selected", () => {
    expect(itemsBody({})).toEqual({});
  });
});
