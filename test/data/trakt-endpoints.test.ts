import { TRAKT_API_BASE, TraktClient } from "@data/trakt/client";
import {
  getEpisode,
  getHidden,
  getLastActivities,
  getMyShowsCalendar,
  getRatings,
  getShow,
  getShowProgress,
  getShowSeasons,
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

  it("parses hidden progress_watched items", async () => {
    getJson("/users/hidden/progress_watched", [
      { hidden_at: "2026-05-01T00:00:00.000Z", type: "show", show: showObj },
    ]);
    const result = await getHidden(client);
    expect(result.ok && result.data[0]?.show?.ids.trakt).toBe(1);
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

describe("malformed bodies throw a zod error", () => {
  it("throws when a watched show is missing its ids", async () => {
    getJson("/sync/watched/shows", [{ show: { title: "No Ids" } }]);
    await expect(getWatchedShows(client)).rejects.toThrow();
  });

  it("throws when progress omits required counts", async () => {
    getJson("/shows/1/progress/watched", { next_episode: null });
    await expect(getShowProgress(client, 1)).rejects.toThrow();
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
