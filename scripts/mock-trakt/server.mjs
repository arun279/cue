/**
 * A local fake Trakt for the core harness and native simulator flows. It lets
 * the app run against a signed-in account with no Trakt credentials or network.
 *
 * Dependency-free Node: `node:http` and the seed module, nothing else.
 *
 * Only the endpoints the app actually calls are modelled. Anything else answers
 * 404 with a logged line, never a silent empty success: a path with no route has
 * to be visible as a hole rather than look like an account with nothing in it.
 * The log line is where a caller reads back what it asked for; no response body
 * ever quotes the request.
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createFaults, FAULT_PROFILE_NAMES, faultResponse, faultsFromEnv } from "./faults.mjs";
import { createJournal } from "./journal.mjs";
import {
  applyHiddenWrite,
  applyHistoryWrite,
  applyWatchlistWrite,
  browseBody,
  calendarBody,
  createSeedLibrary,
  episodeDetailBody,
  hiddenBody,
  historyRows,
  itemPlaysBody,
  lastActivitiesBody,
  movieDetailBody,
  progressBody,
  relatedMoviesBody,
  relatedShowsBody,
  SEED_PROFILE_NAMES,
  searchBody,
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

/** Trakt's answer to a device-token poll nobody has approved yet. */
const pending = () => ({
  status: 400,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ error: "authorization_pending" }),
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

const PLACEHOLDERS = new Map(
  ["poster", "avatar", "fanart"].map((slot) => [
    slot,
    readFileSync(join(import.meta.dirname, `${slot}.png`)),
  ]),
);

function placeholderImage(slot) {
  return {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": "no-store" },
    body: PLACEHOLDERS.get(slot) ?? PLACEHOLDERS.get("fanart"),
  };
}

const browse = (ctx, kind) =>
  browseBody(ctx.library, ctx.origin, extendedOf(ctx.url), kind, ctx.params.rank === "trending");

/**
 * The surface the app reads, matched in order, so the fixed paths
 * (`/shows/trending`) win over the id patterns (`/shows/:id`) that would
 * otherwise swallow them.
 */
const ROUTES = [
  [
    "GET",
    /^\/images\/(?<kind>[^/]+)\/(?<id>\d+)\/(?<slot>[^/.]+)\.png$/,
    (ctx) => placeholderImage(ctx.params.slot),
  ],

  // ---- OAuth. A device grant waits for `/__approve` the way the real one waits
  // for a person at the activation page, so the code stays on screen until the
  // caller says it was entered.
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
  ["POST", /^\/oauth\/device\/token$/, (ctx) => (ctx.device.approved ? json(token()) : pending())],
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
      if (rows === null) return notFound("no seeded item");
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

  // ---- Search and browse
  [
    "GET",
    /^\/search\/[^/]+$/,
    (ctx) =>
      json(
        searchBody(
          ctx.library,
          ctx.origin,
          extendedOf(ctx.url),
          ctx.url.searchParams.get("query") ?? "",
        ),
      ),
  ],

  // ---- Shows
  ["GET", /^\/shows\/(?<rank>trending|popular)$/, (ctx) => json(browse(ctx, "shows"))],
  [
    "GET",
    /^\/shows\/(?<id>[^/]+)\/related$/,
    (ctx) => {
      const show = findShow(ctx.library, ctx.params.id);
      if (show === undefined) return notFound("no seeded show");
      return page(relatedShowsBody(show, ctx.library, ctx.origin, extendedOf(ctx.url)), ctx.url, 6);
    },
  ],
  [
    "GET",
    /^\/shows\/(?<id>[^/]+)\/progress\/watched$/,
    (ctx) => {
      const show = findShow(ctx.library, ctx.params.id);
      if (show === undefined) return notFound("no seeded show");
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
      if (episode === undefined) return notFound("no seeded episode");
      return json(episodeDetailBody(episode, ctx.origin, extendedOf(ctx.url)));
    },
  ],
  [
    "GET",
    /^\/shows\/(?<id>[^/]+)\/seasons$/,
    (ctx) => {
      const show = findShow(ctx.library, ctx.params.id);
      if (show === undefined) return notFound("no seeded show");
      return json(seasonsBody(show, ctx.origin, extendedOf(ctx.url)));
    },
  ],
  [
    "GET",
    /^\/shows\/(?<id>[^/]+)$/,
    (ctx) => {
      const show = findShow(ctx.library, ctx.params.id);
      if (show === undefined) return notFound("no seeded show");
      return json(showDetailBody(show, ctx.origin, extendedOf(ctx.url)));
    },
  ],

  // ---- Movies
  ["GET", /^\/movies\/(?<rank>trending|popular)$/, (ctx) => json(browse(ctx, "movies"))],
  [
    "GET",
    /^\/movies\/(?<id>[^/]+)\/related$/,
    (ctx) => {
      const movie = findMovie(ctx.library, ctx.params.id);
      if (movie === undefined) return notFound("no seeded movie");
      return page(
        relatedMoviesBody(movie, ctx.library, ctx.origin, extendedOf(ctx.url)),
        ctx.url,
        12,
      );
    },
  ],
  [
    "GET",
    /^\/movies\/(?<id>[^/]+)$/,
    (ctx) => {
      const movie = findMovie(ctx.library, ctx.params.id);
      if (movie === undefined) return notFound("no seeded movie");
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
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, trakt-api-key, trakt-api-version",
  // The app reads pagination off the headers and its backoff off `Retry-After`.
  // Neither is CORS-safelisted, so without this the browser hands the app a
  // response with those headers stripped and the mock silently stops modelling
  // the thing under test.
  "access-control-expose-headers":
    "retry-after, x-pagination-page, x-pagination-limit, x-pagination-page-count, x-pagination-item-count",
  "access-control-max-age": "600",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A fault's effect on the connection itself, before any response is composed.
 * False when the fault ends the request without one.
 */
async function stall(fault, request, hold) {
  if (fault.drop === true) {
    request.socket.destroy();
    return false;
  }
  if (fault.hold === true) await hold();
  if (fault.delayMs !== undefined) await sleep(fault.delayMs);
  return true;
}

/**
 * POST puts the account back to a seed, for a flow whose assertions are about
 * what is IN the account rather than about the order the flows ran in. `?seed=`
 * names one of the profiles in `seed.mjs`; without it the account goes back to
 * the default eight shows and three movies. It is the one control that returns
 * the whole mock to a known state, so it disarms any faults with it and lets go
 * of anything a hold fault left waiting.
 */
function resetRoute(reset, releaseHeld, method, url) {
  if (method !== "POST") return notFound("no control route");
  const seed = url.searchParams.get("seed") ?? "default";
  if (!reset(seed)) return notFound("no seed profile");
  releaseHeld();
  return json({ reset: true });
}

/**
 * POST arms a rule (or `{ rules: [...] }`), or the named profile a `?<name>`
 * query flag selects, and answers with the durable op-log that profile seeds.
 * GET reports what is armed, DELETE clears.
 */
function faultRoute(faults, method, url, body, releaseHeld) {
  if (method === "POST") {
    const profile = FAULT_PROFILE_NAMES.find((name) => url.searchParams.has(name));
    if (profile === undefined) return json({ armed: faults.arm(body) });
    return json({ armed: faults.armProfile(profile), profile, opLog: faults.opLog() });
  }
  if (method === "DELETE") {
    faults.clear();
    releaseHeld();
    return json({ armed: 0 });
  }
  if (method === "GET") return json({ rules: faults.describe(), opLog: faults.opLog() });
  return notFound("no control route");
}

/**
 * POST approves the pending device grant, standing in for the person who opens
 * the activation page and types the code. Until it is called the token poll
 * answers `authorization_pending`, which is what keeps the code on screen for
 * as long as a caller needs it there.
 */
function approveRoute(device, method) {
  if (method !== "POST") return notFound("no control route");
  device.approved = true;
  return json({ approved: true });
}

/**
 * The harness control plane, on the mock's own origin under a `__` prefix that
 * no Trakt path can collide with.
 */
function controlRoute(faults, device, reset, releaseHeld, method, url, body) {
  if (url.pathname === "/__reset") return resetRoute(reset, releaseHeld, method, url);
  if (url.pathname === "/__fault") return faultRoute(faults, method, url, body, releaseHeld);
  if (url.pathname === "/__approve") return approveRoute(device, method);
  return null;
}

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

function resolve(library, device, method, url, origin, body) {
  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method) continue;
    const match = pattern.exec(url.pathname);
    if (match === null) continue;
    return handler({ library, device, url, origin, body, params: match.groups ?? {} });
  }
  return notFound("no route");
}

function finishFault(request, fault, result) {
  if (fault?.dropAfter !== true) return result;
  request.socket.destroy();
  return null;
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
  faults: faultSpec = faultsFromEnv(process.env["MOCK_TRAKT_FAULTS"]),
  onRequest = (_entry) => {},
} = {}) {
  let library = createSeedLibrary();
  const device = { approved: false };
  const journal = createJournal(journalFile);
  const faults = createFaults(faultSpec);
  const held = new Set();
  const hold = () => new Promise((resolve) => held.add(resolve));
  const releaseHeld = () => {
    const releases = [...held];
    held.clear();
    for (const release of releases) release();
  };

  /** The response to send, or null when a fault ended the request without one. */
  const answer = async (request, method, url, origin) => {
    const body = await readBody(request);
    // Journalled before the route runs, so a request with no route is still
    // in the record: a hole has to be visible on both sides of a comparison.
    // The `__` control plane is the harness talking to the mock, not the app
    // talking to Trakt, so it stays out of a recording that exists to be
    // compared against another app's.
    if (!url.pathname.startsWith("/__")) {
      journal.record(method, url.pathname, url.search, body);
      onRequest({ method, path: url.pathname, search: url.search, body });
    }
    const control = controlRoute(
      faults,
      device,
      (seed) => {
        if (!SEED_PROFILE_NAMES.includes(seed)) return false;
        library = createSeedLibrary(seed);
        device.approved = false;
        faults.clear();
        return true;
      },
      releaseHeld,
      method,
      url,
      body,
    );
    const fault = control === null ? faults.next(method, url) : null;
    if (fault !== null) {
      if (log) process.stdout.write(`mock-trakt fault ${method} ${url.pathname}\n`);
      if (!(await stall(fault, request, hold))) return null;
    }
    return finishFault(
      request,
      fault,
      control ?? faultResponse(fault ?? {}) ?? resolve(library, device, method, url, origin, body),
    );
  };

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
      const result = await answer(request, method, url, origin);
      if (result === null) return;
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
    // A getter, because `/__reset` replaces the account wholesale.
    get library() {
      return library;
    },
    faults,
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, host, () => {
          const bound = server.address();
          const url = `http://${host}:${typeof bound === "object" && bound !== null ? bound.port : port}`;
          if (log) process.stdout.write(`mock-trakt listening on ${url}\n`);
          resolve(url);
        });
      }),
    close: () => {
      releaseHeld();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createMockTrakt().listen();
}
