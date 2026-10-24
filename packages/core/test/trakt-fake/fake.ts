/**
 * The one Trakt fake: the account, the OAuth sessions, the rate limiter and the
 * routes the app calls, as MSW handlers. Tests run them in process; the smoke
 * flows reach them through `serve.ts`.
 *
 * Statuses, headers and bodies follow recordings of real Trakt
 * (`recordings.json`, checked by `conformance.test.ts`). What could not be
 * recorded follows Trakt's documentation, cited where it is modelled.
 */

import { getResponse, HttpResponse, http, type JsonBodyType, type RequestHandler } from "msw";
import { z } from "zod";
import { type Account, defaultAccount } from "./account.ts";
import * as B from "./bodies.ts";
import {
  applyDroppedWrite,
  applyHiddenWrite,
  applyHistoryWrite,
  applyWatchlistWrite,
  catalogueOnly,
  type WriteBody,
  writeBodySchema,
} from "./writes.ts";

const TRAKT = "https://api.trakt.tv";
const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Access tokens live 7 days (https://docs.trakt.tv/reference/postoauthdevicetoken). */
const TOKEN_LIFETIME_S = 604_800;
/** A revoked access token still answered 200 a second later and 401 by 10.5 minutes (recorded). */
const REVOKE_SETTLES_MS = 10 * MINUTE;
const DEVICE_CODE_LIFETIME_S = 600;
const DEVICE_INTERVAL_S = 6;

/** Trakt's limits (https://developer.trakt.tv/docs/rate-limiting). */
const POST_LIMIT = { name: "AUTHED_API_POST_LIMIT", period: 1, limit: 1 };
const GET_LIMIT = { period: 300, limit: 500 };

export interface Token {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly token_type: string;
  readonly scope: string;
  readonly created_at: number;
  readonly expires_in: number;
}

/** The session the account is signed in with before any OAuth grant. */
export const SESSION = {
  access_token: "fake-access-token",
  refresh_token: "fake-refresh-token",
} as const;

export interface LoggedRequest {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  status: number;
  bytes: number;
}

export interface FaultMatch {
  readonly method?: "GET" | "POST";
  readonly path?: RegExp;
  readonly query?: RegExp;
  /** Let this many matching requests through first. */
  readonly after?: number;
  /** Apply to this many matching requests; one unless said otherwise. */
  readonly times?: number;
}

type Effect =
  | { readonly kind: "status"; readonly status: number; readonly retryAfter?: number }
  | { readonly kind: "hold"; readonly until: Promise<void> }
  | { readonly kind: "drop" }
  | { readonly kind: "drop-after" };

interface Armed {
  readonly match: FaultMatch;
  readonly effect: Effect;
  skip: number;
  remaining: number;
}

export interface FakeOptions {
  readonly account?: (multiplePlays: boolean) => Account;
  readonly multiplePlays?: boolean;
  readonly clock?: () => number;
  readonly baseUrl?: string;
  readonly art?: B.Art;
}

interface Session {
  readonly createdAt: number;
  revokedAt: number | null;
}

interface Device {
  readonly code: string;
  readonly issuedAt: number;
  approved: boolean;
  denied: boolean;
  used: boolean;
  lastPollAt: number | null;
}

interface State {
  account: Account;
  readonly sessions: Map<string, Session>;
  /** Refresh token to the access token it was issued with; a used one is gone. */
  readonly refresh: Map<string, string>;
  device: Device | null;
  issued: number;
  readonly lastPost: Map<string, number>;
  readonly getWindows: Map<string, { start: number; count: number }>;
}

const objectBody = z.record(z.string(), z.unknown()).catch({});

const JSON_TYPE = "application/json; charset=utf-8";

const json = (body: JsonBodyType, status = 200, headers: Record<string, string> = {}) =>
  HttpResponse.json(body, { status, headers: { "content-type": JSON_TYPE, ...headers } });

/** OAuth answers carry `application/json` with no charset (recorded). */
const oauthJson = (body: JsonBodyType, status = 200) =>
  HttpResponse.json(body, { status, headers: { "content-type": "application/json" } });

/** A 404 is an empty `text/plain;charset=UTF-8` body (recorded). */
const notFound = () =>
  new HttpResponse(null, { status: 404, headers: { "content-type": "text/plain;charset=UTF-8" } });

/** A 401 is the text `Unauthorized` (recorded). */
const unauthorized = () =>
  new HttpResponse("Unauthorized", {
    status: 401,
    headers: { "content-type": "text/plain; charset=UTF-8" },
  });

/** A pending device poll and a revoke answer with an empty body and no content type (recorded). */
const empty = (status: number) => new HttpResponse(null, { status });

/** The OAuth answer for a refresh token Trakt no longer knows (recorded). */
const invalidGrant = () =>
  oauthJson({ error: "invalid_grant", error_description: "session not found" }, 400);

const isoSecond = (ms: number): string => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

/**
 * A 429. From the rate limiter it names its bucket in `X-Ratelimit` and says when
 * to retry; one from the security layer carries neither
 * (https://developer.trakt.tv/docs/rate-limiting). No body was ever documented.
 */
function rateLimited(
  retryAfter: number | undefined,
  now: number,
  bucket = { name: "AUTHED_API_GET_LIMIT", ...GET_LIMIT },
) {
  if (retryAfter === undefined) return empty(429);
  const until = isoSecond(now + retryAfter * SECOND);
  return new HttpResponse(null, {
    status: 429,
    headers: {
      "retry-after": String(retryAfter),
      "x-ratelimit": JSON.stringify({ ...bucket, remaining: 0, until }),
    },
  });
}

/** What a fault answers: the recorded or documented body for its status. */
function faultAnswer(status: number, retryAfter: number | undefined, now: number): Response {
  if (status === 401) return unauthorized();
  if (status === 404) return notFound();
  if (status === 429) return rateLimited(retryAfter, now);
  return new HttpResponse(null, {
    status,
    headers: retryAfter === undefined ? {} : { "retry-after": String(retryAfter) },
  });
}

/**
 * Trakt's `X-Pagination-*` headers. Every endpoint measured defaults to 100 rows
 * and caps a page at 250, except watched shows with progress at 100; an empty list
 * has a page count of 0 (recorded).
 */
function page(rows: readonly unknown[], url: URL, max = 250) {
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), max);
  const current = Number(url.searchParams.get("page") ?? 1);
  return json(rows.slice((current - 1) * limit, current * limit), 200, {
    "x-pagination-page": String(current),
    "x-pagination-limit": String(limit),
    "x-pagination-page-count": String(Math.ceil(rows.length / limit)),
    "x-pagination-item-count": String(rows.length),
  });
}

const bearer = (request: Request): string | null =>
  request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;

interface Context {
  readonly request: Request;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly view: B.View;
  readonly body: Record<string, unknown>;
  readonly token: string | null;
}

type Resolver = (ctx: Context) => Response | Promise<Response>;

export interface TraktFake {
  readonly handlers: readonly RequestHandler[];
  readonly account: Account;
  /** Every request the fake received, in order. */
  readonly requests: readonly LoggedRequest[];
  /** Requests `fetch` was handed that no route answers. */
  readonly noRoute: readonly string[];
  /** The signed-in session, valid for 7 days from the last reset. */
  session(): Token;
  /** `fetch` over the handlers without a socket, for code that takes a fetch. */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  /** Back to a fresh default account and session; disarms faults and releases held requests. */
  reset(): void;
  /** The person at the activation page enters the code, or refuses it. */
  approve(): void;
  deny(): void;
  /** Answer matching requests with `status` and the body Trakt sends with it. */
  fail(match: FaultMatch, status: number, retryAfter?: number): void;
  /** Hold matching requests until the returned release is called. */
  hold(match: FaultMatch): () => void;
  /** End matching requests without an answer, before or after the account applies them. */
  drop(match: FaultMatch, when?: "before" | "after"): void;
}

export function createTraktFake(options: FakeOptions = {}): TraktFake {
  const clock = options.clock ?? (() => Date.now());
  const base = (options.baseUrl ?? TRAKT).replace(/\/+$/, "");
  const art = options.art ?? B.traktArt;
  const makeAccount = options.account ?? ((multiplePlays) => defaultAccount(multiplePlays));
  const requests: LoggedRequest[] = [];
  const noRoute: string[] = [];
  let faults: Armed[] = [];
  let releases: (() => void)[] = [];

  const fresh = (): State => ({
    account: makeAccount(options.multiplePlays ?? true),
    sessions: new Map([[SESSION.access_token, { createdAt: clock(), revokedAt: null }]]),
    refresh: new Map([[SESSION.refresh_token, SESSION.access_token]]),
    device: null,
    issued: 0,
    lastPost: new Map(),
    getWindows: new Map(),
  });
  let state = fresh();

  const tokenOf = (access: string, refresh: string): Token => ({
    access_token: access,
    refresh_token: refresh,
    token_type: "bearer",
    scope: "public offline_access",
    created_at: Math.floor((state.sessions.get(access)?.createdAt ?? clock()) / SECOND),
    expires_in: TOKEN_LIFETIME_S,
  });

  const issue = (): Token => {
    state.issued += 1;
    const access = `fake-access-${state.issued}`;
    const refresh = `fake-refresh-${state.issued}`;
    state.sessions.set(access, { createdAt: clock(), revokedAt: null });
    state.refresh.set(refresh, access);
    return tokenOf(access, refresh);
  };

  const valid = (token: string | null): boolean => {
    const session = token === null ? undefined : state.sessions.get(token);
    if (session === undefined) return false;
    const now = clock();
    const live = now < session.createdAt + TOKEN_LIFETIME_S * SECOND;
    return live && (session.revokedAt === null || now < session.revokedAt + REVOKE_SETTLES_MS);
  };

  function postLimit(key: string, now: number): Response | null {
    const last = state.lastPost.get(key);
    if (last !== undefined && now - last < SECOND) {
      return rateLimited(Math.ceil((last + SECOND - now) / SECOND), now, POST_LIMIT);
    }
    state.lastPost.set(key, now);
    return null;
  }

  function getLimit(token: string | null, now: number): Response | null {
    const window = state.getWindows.get(token ?? "unauthed");
    if (window === undefined || now >= window.start + GET_LIMIT.period * SECOND) {
      state.getWindows.set(token ?? "unauthed", { start: now, count: 1 });
      return null;
    }
    window.count += 1;
    if (window.count <= GET_LIMIT.limit) return null;
    const name = token === null ? "UNAUTHED_API_GET_LIMIT" : "AUTHED_API_GET_LIMIT";
    const retryAfter = Math.ceil((window.start + GET_LIMIT.period * SECOND - now) / SECOND);
    return rateLimited(retryAfter, now, { name, ...GET_LIMIT });
  }

  /** One authed POST a second, and 500 GETs per 5 minutes per user (or per client without a token). */
  function limit(method: string, token: string | null, authed: boolean): Response | null {
    if (method === "GET") return getLimit(token, clock());
    return authed ? postLimit(token ?? "unauthed", clock()) : null;
  }

  function takeFault(method: string, url: URL): Effect | null {
    const armed = faults.find(
      ({ match, remaining }) =>
        remaining > 0 &&
        (match.method === undefined || match.method === method) &&
        (match.path === undefined || match.path.test(url.pathname)) &&
        (match.query === undefined || match.query.test(url.searchParams.toString())),
    );
    if (armed === undefined) return null;
    if (armed.skip > 0) {
      armed.skip -= 1;
      return null;
    }
    armed.remaining -= 1;
    return armed.effect;
  }

  const arm = (match: FaultMatch, effect: Effect): void => {
    faults.push({ match, effect, skip: match.after ?? 0, remaining: match.times ?? 1 });
  };

  async function pipeline(
    request: Request,
    params: Context["params"],
    authed: boolean,
    resolve: Resolver,
  ) {
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.clone().text();
    const entry: LoggedRequest = {
      method: request.method,
      path: url.pathname,
      search: url.search,
      headers: Object.fromEntries(request.headers),
      body: text === "" ? null : JSON.parse(text),
      status: 0,
      bytes: 0,
    };
    requests.push(entry);
    const response = await answer(request, url, params, authed, resolve, entry.body);
    entry.status = response.status;
    entry.bytes = response.type === "error" ? 0 : (await response.clone().arrayBuffer()).byteLength;
    return response;
  }

  async function faulted(fault: Effect | null): Promise<Response | null> {
    if (fault?.kind === "drop") return HttpResponse.error();
    if (fault?.kind === "hold") await fault.until;
    return fault?.kind === "status" ? faultAnswer(fault.status, fault.retryAfter, clock()) : null;
  }

  /** Trakt checks the session, then the rate limits. */
  function admit(request: Request, authed: boolean): Response | null {
    const token = bearer(request);
    if (authed && !valid(token)) return unauthorized();
    return limit(request.method, token, authed);
  }

  async function answer(
    request: Request,
    url: URL,
    params: Context["params"],
    authed: boolean,
    resolve: Resolver,
    body: unknown,
  ): Promise<Response> {
    const fault = takeFault(request.method, url);
    const refused = (await faulted(fault)) ?? admit(request, authed);
    if (refused !== null) return refused;
    const token = bearer(request);
    const view: B.View = {
      account: state.account,
      art,
      extended: url.searchParams.get("extended") ?? "",
    };
    const response = await resolve({
      request,
      url,
      params,
      view,
      token,
      body: objectBody.parse(body),
    });
    return fault?.kind === "drop-after" ? HttpResponse.error() : response;
  }

  const route = (method: "get" | "post", path: string, authed: boolean, resolve: Resolver) =>
    http[method](`${base}${path}`, ({ request, params }) =>
      pipeline(
        request,
        Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
        authed,
        resolve,
      ),
    );

  const write =
    (
      apply: (account: Account, body: WriteBody, remove: boolean, now: number) => JsonBodyType,
      remove: boolean,
    ) =>
    (ctx: Context) =>
      json(
        apply(state.account, writeBodySchema.parse(ctx.body), remove, clock()),
        remove ? 200 : 201,
      );

  const withShow = (
    ctx: Context,
    answerFor: (show: NonNullable<ReturnType<typeof B.findShow>>) => Response,
  ) => {
    const show = B.findShow(state.account, ctx.params["id"]);
    return show === undefined ? notFound() : answerFor(show);
  };

  const withMovie = (
    ctx: Context,
    answerFor: (movie: NonNullable<ReturnType<typeof B.findMovie>>) => Response,
  ) => {
    const movie = B.findMovie(state.account, ctx.params["id"]);
    return movie === undefined ? notFound() : answerFor(movie);
  };

  function deviceToken(ctx: Context): Response {
    const device = state.device;
    if (device === null || device.code !== ctx.body["code"]) return empty(404);
    const now = clock();
    if (now >= device.issuedAt + DEVICE_CODE_LIFETIME_S * SECOND) return empty(410);
    if (device.used) return empty(409);
    if (device.denied) return empty(418);
    const tooSoon =
      device.lastPollAt !== null && now - device.lastPollAt < DEVICE_INTERVAL_S * SECOND;
    device.lastPollAt = now;
    if (tooSoon) return empty(429);
    if (!device.approved) return empty(400);
    device.used = true;
    const { access_token, refresh_token, token_type, expires_in, scope, created_at } = issue();
    return oauthJson({ access_token, token_type, expires_in, refresh_token, scope, created_at });
  }

  /** Refresh tokens rotate: each answers once with a new pair, and the old access token runs on (recorded). */
  function refresh(ctx: Context): Response {
    const sent = String(ctx.body["refresh_token"] ?? "");
    const access = state.refresh.get(sent);
    if (ctx.body["grant_type"] !== "refresh_token" || access === undefined) return invalidGrant();
    state.refresh.delete(sent);
    const token = issue();
    return oauthJson({ ...token, expires_at: token.created_at + token.expires_in });
  }

  /** Revoking ends the session's refresh at once; its access token settles later (recorded). */
  function revoke(ctx: Context): Response {
    const access = String(ctx.body["token"] ?? "");
    const session = state.sessions.get(access);
    if (session !== undefined) session.revokedAt = clock();
    for (const [refreshToken, owner] of state.refresh)
      if (owner === access) state.refresh.delete(refreshToken);
    return empty(200);
  }

  const historyWindow = (ctx: Context) => {
    const from = ctx.url.searchParams.get("start_at") ?? "";
    const to = ctx.url.searchParams.get("end_at") ?? "9999";
    const section =
      ctx.params["section"] === "episodes" || ctx.params["section"] === "movies"
        ? ctx.params["section"]
        : "all";
    return B.historyRows(ctx.view, section).filter(
      (row) => row.watched_at >= from && row.watched_at <= to,
    );
  };

  const withImages = (view: B.View): B.View =>
    view.extended.includes("images") ? view : { ...view, extended: `${view.extended},images` };

  const handlers = [
    route("post", "/oauth/device/code", false, () => {
      state.device = {
        code: `fake-device-code-${state.issued + 1}`,
        issuedAt: clock(),
        approved: false,
        denied: false,
        used: false,
        lastPollAt: null,
      };
      return oauthJson({
        device_code: state.device.code,
        user_code: "CUE-FAKE",
        verification_url: "https://auth.trakt.tv/activate",
        expires_in: DEVICE_CODE_LIFETIME_S,
        interval: DEVICE_INTERVAL_S,
      });
    }),
    route("post", "/oauth/device/token", false, deviceToken),
    route("post", "/oauth/token", false, refresh),
    route("post", "/oauth/revoke", false, revoke),

    route("get", "/users/settings", true, (ctx) => json(B.userSettingsBody(ctx.view))),
    route("get", "/users/me/history", true, (ctx) => page(historyWindow(ctx), ctx.url)),
    route("get", "/users/me/history/:section", true, (ctx) => page(historyWindow(ctx), ctx.url)),
    route("get", "/users/hidden/progress_watched", true, (ctx) =>
      page(B.hiddenBody(ctx.view), ctx.url),
    ),
    route("get", "/users/hidden/dropped", true, (ctx) => page(B.droppedBody(ctx.view), ctx.url)),
    route("post", "/users/hidden/progress_watched", true, write(applyHiddenWrite, false)),
    route("post", "/users/hidden/progress_watched/remove", true, write(applyHiddenWrite, true)),
    route("post", "/users/hidden/dropped", true, write(applyDroppedWrite, false)),
    route("post", "/users/hidden/dropped/remove", true, write(applyDroppedWrite, true)),

    route("get", "/sync/last_activities", true, () => json(B.lastActivitiesBody(state.account))),
    route("get", "/sync/watched/shows", true, (ctx) =>
      page(B.watchedShowsBody(ctx.view), ctx.url, 100),
    ),
    route("get", "/sync/watched/movies", true, (ctx) =>
      page(B.watchedMoviesBody(ctx.view), ctx.url),
    ),
    route("get", "/sync/watchlist/:type", true, (ctx) =>
      page(
        B.watchlistBody(ctx.view, ctx.params["type"] === "movies" ? "movies" : "shows"),
        ctx.url,
      ),
    ),
    route("get", "/sync/collection/shows", true, (ctx) =>
      page(B.collectionShowsBody(ctx.view), ctx.url),
    ),
    route("get", "/sync/collection/movies", true, (ctx) =>
      page(B.collectionMoviesBody(ctx.view), ctx.url),
    ),
    route("get", "/sync/history/:kind/:id", true, (ctx) => {
      const rows = B.itemPlaysBody(
        withImages(ctx.view),
        ctx.params["kind"] ?? "",
        ctx.params["id"] ?? "",
      );
      return rows === null ? notFound() : page(rows, ctx.url);
    }),
    route("post", "/sync/history", true, write(applyHistoryWrite, false)),
    route("post", "/sync/history/remove", true, write(applyHistoryWrite, true)),
    route("post", "/sync/watchlist", true, write(applyWatchlistWrite, false)),
    route("post", "/sync/watchlist/remove", true, write(applyWatchlistWrite, true)),

    route("get", "/calendars/my/shows/:start/:days", true, (ctx) =>
      json(
        B.calendarBody(
          ctx.view,
          Date.parse(`${ctx.params["start"]}T00:00:00.000Z`),
          Number(ctx.params["days"]),
        ),
      ),
    ),
    route("get", "/search/:types", false, (ctx) =>
      page(
        B.searchBody(
          ctx.view,
          ctx.url.searchParams.get("query") ?? "",
          catalogueOnly(state.account, state.account.now),
        ),
        ctx.url,
      ),
    ),
    route("get", "/genres/:type", false, (ctx) =>
      json(B.genresBody(ctx.params["type"] === "movies" ? "movies" : "shows")),
    ),
    route("get", "/shows/trending", false, (ctx) =>
      page(B.browseBody(ctx.view, "shows", true), ctx.url),
    ),
    route("get", "/shows/popular", false, (ctx) =>
      page(B.browseBody(ctx.view, "shows", false), ctx.url),
    ),
    route("get", "/movies/trending", false, (ctx) =>
      page(B.browseBody(ctx.view, "movies", true), ctx.url),
    ),
    route("get", "/movies/popular", false, (ctx) =>
      page(B.browseBody(ctx.view, "movies", false), ctx.url),
    ),
    route("get", "/shows/:id/related", false, (ctx) =>
      withShow(ctx, (show) => page(B.relatedShowsBody(ctx.view, show), ctx.url)),
    ),
    route("get", "/shows/:id/progress/watched", true, (ctx) =>
      withShow(ctx, (show) =>
        json(
          B.progressBody(
            ctx.view,
            show,
            ctx.url.searchParams.get("specials") === "true",
            ctx.url.searchParams.get("count_specials") === "true",
          ),
        ),
      ),
    ),
    route("get", "/shows/:id/seasons/:season/episodes/:episode", false, (ctx) =>
      withShow(ctx, (show) => {
        const ep = B.allEpisodes(show).find(
          (candidate) =>
            candidate.season === Number(ctx.params["season"]) &&
            candidate.number === Number(ctx.params["episode"]),
        );
        return ep === undefined ? notFound() : json(B.episodeRef(ctx.view, ep));
      }),
    ),
    route("get", "/shows/:id/seasons", false, (ctx) =>
      withShow(ctx, (show) => json(B.seasonsBody(ctx.view, show))),
    ),
    route("get", "/shows/:id", false, (ctx) =>
      withShow(ctx, (show) => json(B.showDetailBody(ctx.view, show))),
    ),
    route("get", "/movies/:id/related", false, (ctx) =>
      withMovie(ctx, (movie) => page(B.relatedMoviesBody(ctx.view, movie), ctx.url)),
    ),
    route("get", "/movies/:id", false, (ctx) =>
      withMovie(ctx, (movie) => json(B.movieRef(ctx.view, movie))),
    ),
  ];

  return {
    handlers,
    get account() {
      return state.account;
    },
    requests,
    noRoute,
    session: () => tokenOf(SESSION.access_token, SESSION.refresh_token),
    async fetch(input, init) {
      const response = await getResponse(handlers, new Request(input, init));
      if (response === undefined) {
        noRoute.push(`${init?.method ?? "GET"} ${String(input)}`);
        return notFound();
      }
      if (response.type === "error") throw new TypeError("fetch failed");
      return response;
    },
    reset() {
      for (const release of releases) release();
      releases = [];
      faults = [];
      requests.length = 0;
      noRoute.length = 0;
      state = fresh();
    },
    approve() {
      if (state.device !== null) state.device.approved = true;
    },
    deny() {
      if (state.device !== null) state.device.denied = true;
    },
    fail: (match, status, retryAfter) =>
      arm(match, { kind: "status", status, ...(retryAfter === undefined ? {} : { retryAfter }) }),
    hold(match) {
      let release = () => {};
      const until = new Promise<void>((resolve) => {
        release = resolve;
      });
      releases.push(release);
      arm(match, { kind: "hold", until });
      return release;
    },
    drop: (match, when = "before") =>
      arm(match, { kind: when === "before" ? "drop" : "drop-after" }),
  };
}
