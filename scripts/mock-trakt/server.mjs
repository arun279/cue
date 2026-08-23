/**
 * A local fake Trakt: `pnpm mock:trakt`, then build or serve the app with
 * `--mode mock` (`.env.mock` points `VITE_TRAKT_API_BASE` here). It exists so the
 * built app, in a browser or in the iOS simulator, can run against a signed-in
 * account with no Trakt credentials and no network, where Playwright route
 * mocking is not available.
 *
 * Dependency-free Node: `node:http` and the seed module, nothing else.
 *
 * Only the endpoints the app actually calls are modelled. Anything else answers
 * 404 with a logged line, never a silent empty success: a path with no route has
 * to be visible as a hole rather than look like an account with nothing in it.
 */

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createJournal } from "./journal.mjs";
import {
  applyHiddenWrite,
  applyHistoryWrite,
  applyWatchlistWrite,
  calendarBody,
  createLibrary,
  episodeDetailBody,
  hiddenBody,
  historyRows,
  itemPlaysBody,
  lastActivitiesBody,
  movieDetailBody,
  progressBody,
  seasonsBody,
  showDetailBody,
  userSettingsBody,
  userStatsBody,
  watchedMoviesBody,
  watchedShowsBody,
  watchlistBody,
} from "./seed.mjs";

const DEFAULT_PORT = Number(process.env["MOCK_TRAKT_PORT"] ?? 8787);
const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
const AUTH_CODE = "mock-auth-code";

/** Every OAuth grant resolves to this one session; the mock authorizes anybody. */
const token = () => ({
  access_token: "mock-access-token",
  refresh_token: "mock-refresh-token",
  token_type: "bearer",
  scope: "public",
  created_at: Math.floor(Date.now() / 1000),
  expires_in: TOKEN_TTL_SECONDS,
});

const json = (data, headers = {}) => ({
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8", ...headers },
  body: JSON.stringify(data),
});

const notFound = (message) => ({
  status: 404,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ error: message }),
});

/** Trakt's `X-Pagination-*` headers, which the client walks list endpoints by. */
function page(rows, url, defaultLimit) {
  const limit = Number(url.searchParams.get("limit") ?? defaultLimit);
  const current = Number(url.searchParams.get("page") ?? 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / limit));
  return json(rows.slice((current - 1) * limit, current * limit), {
    "x-pagination-page": String(current),
    "x-pagination-limit": String(limit),
    "x-pagination-page-count": String(pageCount),
    "x-pagination-item-count": String(rows.length),
  });
}

const extendedOf = (url) => url.searchParams.get("extended") ?? "";

const findShow = (library, id) =>
  library.shows.find((show) => show.trakt === Number(id) || show.slug === id);

const findMovie = (library, id) =>
  library.movies.find((movie) => movie.trakt === Number(id) || movie.slug === id);

const ASPECTS = { poster: [400, 600], avatar: [240, 240] };

/** Initials, so a poster in a screenshot is identifiable rather than a grey box. */
function imageLabel(library, kind, id) {
  if (kind === "episodes") {
    const show = library.shows.find((item) => item.episodes.some((ep) => ep.traktId === id));
    const episode = show?.episodes.find((ep) => ep.traktId === id);
    return episode === undefined ? "?" : `S${episode.season}E${episode.number}`;
  }
  const title =
    kind === "movies"
      ? findMovie(library, String(id))?.title
      : findShow(library, String(id))?.title;
  if (title === undefined) return kind === "users" ? "CD" : "?";
  return title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

/**
 * A generated placeholder for every image the seed points at. Trakt serves
 * host-relative image paths; these are absolute on the mock's own origin because
 * the app upgrades a scheme-less URL to https (`src/data/image-source.ts`), which
 * a local plain-HTTP mock could never answer.
 */
function placeholderImage(library, kind, id, slot) {
  const [width, height] = ASPECTS[slot] ?? [640, 360];
  const hue = (id * 37) % 360;
  const label = imageLabel(library, kind, id);
  return {
    status: 200,
    headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" },
    body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="hsl(${hue} 45% 32%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 40% 14%)"/>
</linearGradient></defs>
<rect width="${width}" height="${height}" fill="url(#g)"/>
<text x="50%" y="50%" fill="hsl(${hue} 60% 88%)" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(height / 4)}" font-weight="600" text-anchor="middle" dominant-baseline="central">${label}</text>
</svg>`,
  };
}

/**
 * The surface the app reads, matched in order, so the fixed paths
 * (`/shows/trending`) win over the id patterns (`/shows/:id`) that would
 * otherwise swallow them.
 */
const ROUTES = [
  [
    "GET",
    /^\/images\/(?<kind>[^/]+)\/(?<id>\d+)\/(?<slot>[^/.]+)\.svg$/,
    (ctx) => placeholderImage(ctx.library, ctx.params.kind, Number(ctx.params.id), ctx.params.slot),
  ],

  // ---- OAuth. Every grant resolves immediately: there is nobody to approve it.
  [
    "POST",
    /^\/oauth\/device\/code$/,
    (ctx) =>
      json({
        device_code: "mock-device-code",
        user_code: "CUE-MOCK",
        verification_url: `${ctx.origin}/activate`,
        expires_in: 600,
        interval: 1,
      }),
  ],
  ["POST", /^\/oauth\/device\/token$/, () => json(token())],
  ["POST", /^\/oauth\/token$/, () => json(token())],
  ["POST", /^\/oauth\/revoke$/, () => json({})],
  // The web PKCE flow's authorize page, reduced to the redirect it ends in: the
  // caller's `state` comes back untouched, so the app's nonce check is real.
  [
    "GET",
    /^\/oauth\/authorize$/,
    (ctx) => {
      const redirectUri = ctx.url.searchParams.get("redirect_uri");
      if (redirectUri === null) return notFound("authorize needs a redirect_uri");
      const back = new URL(redirectUri);
      back.searchParams.set("code", AUTH_CODE);
      back.searchParams.set("state", ctx.url.searchParams.get("state") ?? "");
      return { status: 302, headers: { location: back.toString() }, body: "" };
    },
  ],

  // ---- Account
  ["GET", /^\/users\/settings$/, (ctx) => json(userSettingsBody(ctx.library, ctx.origin))],
  ["GET", /^\/users\/me\/stats$/, (ctx) => json(userStatsBody(ctx.library))],
  [
    "GET",
    /^\/users\/me\/history(?:\/(?<section>episodes|movies))?$/,
    (ctx) =>
      page(
        historyRows(ctx.library, ctx.origin, extendedOf(ctx.url), ctx.params.section ?? "all"),
        ctx.url,
        10,
      ),
  ],
  [
    "GET",
    /^\/users\/hidden\/progress_watched$/,
    (ctx) => page(hiddenBody(ctx.library, ctx.origin), ctx.url, 10),
  ],
  [
    "POST",
    /^\/users\/hidden\/progress_watched$/,
    (ctx) => json(applyHiddenWrite(ctx.library, ctx.body, false)),
  ],
  [
    "POST",
    /^\/users\/hidden\/progress_watched\/remove$/,
    (ctx) => json(applyHiddenWrite(ctx.library, ctx.body, true)),
  ],

  // ---- Sync
  ["GET", /^\/sync\/last_activities$/, (ctx) => json(lastActivitiesBody(ctx.library))],
  [
    "GET",
    /^\/sync\/watched\/shows$/,
    (ctx) => page(watchedShowsBody(ctx.library, extendedOf(ctx.url)), ctx.url, 100),
  ],
  [
    "GET",
    /^\/sync\/watched\/movies$/,
    (ctx) => page(watchedMoviesBody(ctx.library, ctx.origin, extendedOf(ctx.url)), ctx.url, 100),
  ],
  [
    "GET",
    /^\/sync\/watchlist\/(?<type>shows|movies)$/,
    (ctx) =>
      page(
        watchlistBody(ctx.library, ctx.origin, extendedOf(ctx.url), ctx.params.type),
        ctx.url,
        100,
      ),
  ],
  [
    "GET",
    /^\/sync\/history\/(?<kind>shows|episodes|movies)\/(?<id>[^/]+)$/,
    (ctx) => {
      const { kind, id } = ctx.params;
      const rows = itemPlaysBody(ctx.library, ctx.origin, extendedOf(ctx.url), kind, id);
      if (rows === null) return notFound(`no seeded ${kind} ${id}`);
      return page(rows, ctx.url, 10);
    },
  ],
  ["POST", /^\/sync\/history$/, (ctx) => json(applyHistoryWrite(ctx.library, ctx.body, false))],
  [
    "POST",
    /^\/sync\/history\/remove$/,
    (ctx) => json(applyHistoryWrite(ctx.library, ctx.body, true)),
  ],
  ["POST", /^\/sync\/watchlist$/, (ctx) => json(applyWatchlistWrite(ctx.library, ctx.body, false))],
  [
    "POST",
    /^\/sync\/watchlist\/remove$/,
    (ctx) => json(applyWatchlistWrite(ctx.library, ctx.body, true)),
  ],

  // ---- Shows
  ["GET", /^\/shows\/(?:trending|popular)$/, () => json([])],
  [
    "GET",
    /^\/shows\/(?<id>[^/]+)\/progress\/watched$/,
    (ctx) => {
      const show = findShow(ctx.library, ctx.params.id);
      if (show === undefined) return notFound(`no seeded show ${ctx.params.id}`);
      return json(progressBody(show, ctx.library, ctx.origin, extendedOf(ctx.url)));
    },
  ],
  [
    "GET",
    /^\/shows\/(?<id>[^/]+)\/seasons\/(?<season>\d+)\/episodes\/(?<number>\d+)$/,
    (ctx) => {
      const show = findShow(ctx.library, ctx.params.id);
      const episode = show?.episodes.find(
        (ep) => ep.season === Number(ctx.params.season) && ep.number === Number(ctx.params.number),
      );
      if (episode === undefined) return notFound(`no seeded episode ${ctx.url.pathname}`);
      return json(episodeDetailBody(episode, ctx.origin, extendedOf(ctx.url)));
    },
  ],
  [
    "GET",
    /^\/shows\/(?<id>[^/]+)\/seasons$/,
    (ctx) => {
      const show = findShow(ctx.library, ctx.params.id);
      if (show === undefined) return notFound(`no seeded show ${ctx.params.id}`);
      return json(seasonsBody(show, ctx.origin, extendedOf(ctx.url)));
    },
  ],
  [
    "GET",
    /^\/shows\/(?<id>[^/]+)$/,
    (ctx) => {
      const show = findShow(ctx.library, ctx.params.id);
      if (show === undefined) return notFound(`no seeded show ${ctx.params.id}`);
      return json(showDetailBody(show, ctx.origin, extendedOf(ctx.url)));
    },
  ],

  // ---- Movies
  ["GET", /^\/movies\/(?:trending|popular)$/, () => json([])],
  [
    "GET",
    /^\/movies\/(?<id>[^/]+)$/,
    (ctx) => {
      const movie = findMovie(ctx.library, ctx.params.id);
      if (movie === undefined) return notFound(`no seeded movie ${ctx.params.id}`);
      return json(movieDetailBody(movie, ctx.origin, extendedOf(ctx.url)));
    },
  ],

  // ---- Calendar
  [
    "GET",
    /^\/calendars\/my\/shows\/(?<start>[\d-]+)\/(?<days>\d+)$/,
    (ctx) =>
      json(
        calendarBody(
          ctx.library,
          ctx.origin,
          extendedOf(ctx.url),
          Date.parse(`${ctx.params.start}T00:00:00.000Z`),
          Number(ctx.params.days),
        ),
      ),
  ],
];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, trakt-api-key, trakt-api-version",
  "access-control-max-age": "600",
};

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function resolve(library, method, url, origin, body) {
  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method) continue;
    const match = pattern.exec(url.pathname);
    if (match === null) continue;
    return handler({ library, url, origin, body, params: match.groups ?? {} });
  }
  return notFound(`no route for ${method} ${url.pathname}`);
}

/**
 * A mock instance: `listen()` resolves with the URL it bound, and `library` is
 * the live account state, so a caller can assert a write landed.
 */
export function createMockTrakt({
  port = DEFAULT_PORT,
  host = "127.0.0.1",
  log = true,
  journalFile = process.env["MOCK_TRAKT_JOURNAL"],
} = {}) {
  const library = createLibrary();
  const journal = createJournal(journalFile);
  const server = createServer((request, response) => {
    void (async () => {
      const origin = `http://${request.headers.host ?? `${host}:${port}`}`;
      const url = new URL(request.url ?? "/", origin);
      const method = request.method ?? "GET";
      if (method === "OPTIONS") {
        response.writeHead(204, CORS);
        response.end("");
        return;
      }
      const body = await readBody(request);
      // Journalled before the route runs, so a request with no route is still
      // in the record: a hole has to be visible on both sides of a comparison.
      journal.record(method, url.pathname, url.search, body);
      const result = resolve(library, method, url, origin, body);
      if (log) {
        process.stdout.write(
          `mock-trakt ${method} ${url.pathname}${url.search} ${result.status}\n`,
        );
      }
      response.writeHead(result.status, { ...CORS, ...result.headers });
      response.end(result.body);
    })();
  });

  return {
    library,
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, host, () => {
          const bound = server.address();
          const url = `http://${host}:${typeof bound === "object" && bound !== null ? bound.port : port}`;
          if (log) process.stdout.write(`mock-trakt listening on ${url}\n`);
          resolve(url);
        });
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createMockTrakt().listen();
}
