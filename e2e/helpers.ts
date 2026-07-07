import type { BrowserContext, Page } from "@playwright/test";

export type NetworkMode = "ok" | "abort" | "delay";

export interface HermeticControls {
  setMode: (mode: NetworkMode) => void;
  setCount: (count: number) => void;
}

const OTHER_ORIGINS = [
  "**/api.trakt.tv/**",
  "**/trakt.tv/**",
  "**/api.themoviedb.org/**",
  "**/image.tmdb.org/**",
];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const DAY = 86_400_000;

/**
 * An ISO timestamp `days` before now. The Watching/lapsed split compares
 * `last_watched_at` against a 21-day threshold using the real wall clock, so
 * freshness-sensitive fixtures must be relative to now rather than pinned dates.
 */
export function agoIso(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

/**
 * Intercept every Trakt/TMDB origin at the browser-context level so no request
 * escapes to the real network (hermetic e2e). The frame's `/networks`
 * boot probe is controllable so persistence tests can delay or fail it on demand.
 */
export async function installHermeticRoutes(context: BrowserContext): Promise<HermeticControls> {
  let mode: NetworkMode = "ok";
  let count = 12;

  // Catch-alls first; the specific /networks route is registered last so it wins.
  for (const pattern of OTHER_ORIGINS) {
    await context.route(pattern, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
  }

  // Profile reads `/users/me/stats`; the array catch-all above would fail the
  // object schema, so answer it with a valid non-zero stats fixture.
  await context.route("**/api.trakt.tv/users/me/stats*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        movies: { plays: 200, watched: 114, minutes: 15_650 },
        shows: { watched: 40 },
        episodes: { plays: 552, watched: 534, minutes: 17_330 },
      }),
    }),
  );

  // The freshness gate polls `/sync/last_activities`; the array catch-all would
  // fail the object schema, so answer with a valid empty stamp table — a boot with
  // no baseline commits it and invalidates nothing (a clean no-op poll).
  // installLibraryRoutes overrides this with a mutable, bump-able table.
  await context.route("**/api.trakt.tv/sync/last_activities*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );

  await context.route("**/api.trakt.tv/networks*", async (route) => {
    if (mode === "abort") {
      await route.abort();
      return;
    }
    if (mode === "delay") await sleep(2000);
    const body = Array.from({ length: count }, (_, index) => ({ name: `Net ${index}` }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  return {
    setMode: (next) => {
      mode = next;
    },
    setCount: (next) => {
      count = next;
    },
  };
}

/**
 * A stored session token, minted live (`created_at = now`) so it is genuinely
 * unexpired against the real wall clock — the transport's proactive expiry check
 * must NOT fire for a freshly-seeded session. Refresh paths are exercised by
 * `gateReadsUntilRefreshed`, which forces a 401 regardless of local expiry.
 */
function seedTokenJson(): string {
  return JSON.stringify({
    access_token: "seed-access",
    refresh_token: "seed-refresh",
    created_at: Math.floor(Date.now() / 1000),
    expires_in: 7_776_000,
  });
}

/** The rotated token every `/oauth/token` exchange returns, minted live so the
 * connected session is not itself immediately due for a proactive refresh. */
function oauthTokenJson(): string {
  return JSON.stringify({
    access_token: "connected-access",
    refresh_token: "connected-refresh",
    created_at: Math.floor(Date.now() / 1000),
    expires_in: 7_776_000,
  });
}

/**
 * Seed a stored Trakt token into idb-keyval before the app boots, so a suite
 * starts past the onboarding gate (tests start authenticated except
 * the auth-flow tests). The client id is a build-time constant, so the token is
 * the whole session. The write transaction is created at document start, ahead of
 * the app's read, so the boot reads it deterministically.
 */
export async function seedAuth(context: BrowserContext): Promise<void> {
  await context.addInitScript(
    ({ token }) => {
      const open = indexedDB.open("keyval-store");
      open.onupgradeneeded = () => open.result.createObjectStore("keyval");
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put(token, "cue.trakt.token");
        tx.oncomplete = () => db.close();
      };
    },
    { token: seedTokenJson() },
  );
}

/**
 * Force the given read routes to 401 while the request still carries the stale
 * bearer, then fall through to the already-registered fixture once the transport
 * has refreshed to a new token. Register AFTER the fixture/catch-all routes so
 * this gate wins first and `route.fallback()` defers to them — this drives the refresh-on-401 + retry path end-to-end (a live 401 → one refresh → retry).
 */
export async function gateReadsUntilRefreshed(
  context: BrowserContext,
  patterns: readonly string[],
  staleBearer = "Bearer seed-access",
): Promise<void> {
  for (const pattern of patterns) {
    await context.route(pattern, (route) => {
      if (route.request().headers()["authorization"] === staleBearer) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "expired_token" }),
        });
      }
      return route.fallback();
    });
  }
}

export interface OAuthControls {
  setStateEcho: (mode: "match" | "mismatch") => void;
  setTokenStatus: (status: number) => void;
  /** How the device-token poll resolves once past the initial pending replies. */
  setDeviceOutcome: (outcome: "success" | "denied" | "expired") => void;
  /** The `state` the authorize redirect saw, letting a test assert a non-empty nonce was sent. */
  getAuthorizeState: () => string | null;
  /** The `client_id` the authorize redirect carried (the build-time embedded, public id). */
  getAuthorizeClientId: () => string | null;
  /** The PKCE `code_challenge` + method the authorize redirect saw (S256, no secret). */
  getAuthorizeChallenge: () => { challenge: string | null; method: string | null };
  /** The PKCE `code_challenge` + method the device-code request carried (binds the poll verifier). */
  getDeviceChallenge: () => { challenge: string | null; method: string | null };
  /** Every JSON body posted to `/oauth/device/token` (device-flow polls). */
  getDeviceTokenRequests: () => ReadonlyArray<Record<string, unknown>>;
  /** Every JSON body posted to `/oauth/token` (auth-code + refresh exchanges). */
  getTokenRequests: () => ReadonlyArray<Record<string, unknown>>;
  /** Every JSON body posted to `/oauth/revoke`. */
  getRevokeRequests: () => ReadonlyArray<Record<string, unknown>>;
}

/**
 * Mock every OAuth endpoint across both Trakt origins (hermetic e2e):
 * the `trakt.tv` authorize redirect echoes the caller's `state` (or tampers it),
 * and the `api.trakt.tv` token/device/revoke endpoints are fulfilled with pinned
 * fixtures. Register after `installHermeticRoutes` so these specific routes win
 * over the catch-alls.
 */
export async function installOAuthRoutes(context: BrowserContext): Promise<OAuthControls> {
  let stateEcho: "match" | "mismatch" = "match";
  let tokenStatus = 200;
  let deviceOutcome: "success" | "denied" | "expired" = "success";
  let devicePolls = 0;
  let authorizeState: string | null = null;
  let authorizeClientId: string | null = null;
  let authorizeChallenge: string | null = null;
  let authorizeChallengeMethod: string | null = null;
  let deviceChallenge: string | null = null;
  let deviceChallengeMethod: string | null = null;
  const deviceTokenRequests: Array<Record<string, unknown>> = [];
  const tokenRequests: Array<Record<string, unknown>> = [];
  const revokeRequests: Array<Record<string, unknown>> = [];

  await context.route("**/trakt.tv/oauth/authorize*", async (route) => {
    const url = new URL(route.request().url());
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    authorizeState = state;
    authorizeClientId = url.searchParams.get("client_id");
    authorizeChallenge = url.searchParams.get("code_challenge");
    authorizeChallengeMethod = url.searchParams.get("code_challenge_method");
    const echoed = stateEcho === "match" ? state : "tampered-state";
    await route.fulfill({
      status: 302,
      headers: { location: `${redirectUri}?code=good-code&state=${echoed}` },
    });
  });

  await context.route("**/api.trakt.tv/oauth/token", (route) => {
    tokenRequests.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    return route.fulfill({
      status: tokenStatus,
      contentType: "application/json",
      body: tokenStatus === 200 ? oauthTokenJson() : JSON.stringify({ error: "invalid_grant" }),
    });
  });

  await context.route("**/api.trakt.tv/oauth/device/code", (route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, string>;
    deviceChallenge = body["code_challenge"] ?? null;
    deviceChallengeMethod = body["code_challenge_method"] ?? null;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        device_code: "dev-code-1",
        user_code: "CUE-1234",
        verification_url: "https://trakt.tv/activate",
        expires_in: 600,
        interval: 1,
      }),
    });
  });

  await context.route("**/api.trakt.tv/oauth/device/token", (route) => {
    deviceTokenRequests.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    devicePolls += 1;
    if (devicePolls < 2) {
      return route.fulfill({ status: 400, contentType: "application/json", body: "{}" });
    }
    if (deviceOutcome === "denied") {
      return route.fulfill({ status: 418, contentType: "application/json", body: "{}" });
    }
    if (deviceOutcome === "expired") {
      return route.fulfill({ status: 410, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: oauthTokenJson(),
    });
  });

  await context.route("**/api.trakt.tv/oauth/revoke", (route) => {
    revokeRequests.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  return {
    setStateEcho: (mode) => {
      stateEcho = mode;
    },
    setTokenStatus: (status) => {
      tokenStatus = status;
    },
    setDeviceOutcome: (outcome) => {
      deviceOutcome = outcome;
    },
    getAuthorizeState: () => authorizeState,
    getAuthorizeClientId: () => authorizeClientId,
    getAuthorizeChallenge: () => ({
      challenge: authorizeChallenge,
      method: authorizeChallengeMethod,
    }),
    getDeviceChallenge: () => ({
      challenge: deviceChallenge,
      method: deviceChallengeMethod,
    }),
    getDeviceTokenRequests: () => deviceTokenRequests,
    getTokenRequests: () => tokenRequests,
    getRevokeRequests: () => revokeRequests,
  };
}

export interface EpisodeFixture {
  readonly season: number;
  readonly number: number;
  readonly title: string | null;
  readonly firstAired: string;
  readonly traktId: number;
  readonly overview?: string;
  readonly stills?: readonly string[];
}

export interface ShowFixture {
  readonly trakt: number;
  readonly tmdb?: number;
  readonly title: string;
  readonly status: string;
  readonly posters?: readonly string[];
  readonly backdrops?: readonly string[];
  readonly overview?: string;
  readonly network?: string;
  readonly lastWatchedAt: string | null;
  readonly aired: number;
  /** Mutated in place by intercepted history writes so reads stay self-consistent. */
  completed: number;
  readonly episodes: readonly EpisodeFixture[];
  /** Mutated in place by intercepted hidden writes so Up Next / bucket reads stay consistent. */
  hidden?: boolean;
  /** Mutated in place by intercepted watchlist writes so the To-watch bucket stays consistent. */
  inWatchlist?: boolean;
}

/** `ok` applies+200; `abort` fails as a pure network reject (never reached Trakt); `network-drop`
 * applies then aborts (reached Trakt, response lost — the reconcile case); `rate-limit-once` 429s
 * the first attempt then applies; `delay` applies after a long wait. */
export type WriteMode = "ok" | "abort" | "network-drop" | "rate-limit-once" | "delay";

export interface CapturedSeason {
  readonly number: number;
  readonly episodes?: { readonly number: number }[];
}

export interface CapturedShow {
  readonly ids?: { readonly trakt?: number };
  readonly seasons?: readonly CapturedSeason[];
}

export interface CapturedWrite {
  readonly path: string;
  readonly episodeIds: readonly number[];
  readonly watchedAt: string | null;
  /** The `shows[]` subtree of a bulk history or hidden write (season tokens / enumerated eps). */
  readonly shows?: readonly CapturedShow[];
  readonly showIds?: readonly number[];
  /** The rating value on a `/sync/ratings` write (null on a remove). */
  readonly rating?: number | null;
  /** The keys present on the first captured `episodes[]` item (proves all-plays remove = ids only). */
  readonly episodeItemKeys?: readonly string[];
}

export interface LibraryControls {
  setWriteMode: (mode: WriteMode) => void;
  setReadMode: (mode: "ok" | "abort") => void;
  setReadDelayMs: (ms: number) => void;
  /** Abort only these shows' progress reads (partial-outage case); [] restores all. */
  failProgressFor: (traktIds: readonly number[]) => void;
  /** 429 the next `n` progress reads (with Retry-After) then serve them — the read
   * rate-limit-then-recover path. */
  rateLimitProgressReads: (n: number) => void;
  /** Advance one `/sync/last_activities` stamp so the next poll diffs a real change. */
  bumpActivity: (section: string, field: string) => void;
  clearWrites: () => void;
  writes: () => readonly CapturedWrite[];
  historyPosts: () => readonly CapturedWrite[];
  removePosts: () => readonly CapturedWrite[];
  hiddenPosts: () => readonly CapturedWrite[];
  ratingPosts: () => readonly CapturedWrite[];
  ratingRemovePosts: () => readonly CapturedWrite[];
  watchlistPosts: () => readonly CapturedWrite[];
  watchlistRemovePosts: () => readonly CapturedWrite[];
  progressReads: () => number;
}

interface HistoryBody {
  episodes?: { ids?: { trakt?: number }; watched_at?: string }[];
  shows?: { ids?: { trakt?: number }; watched_at?: string; seasons?: CapturedSeason[] }[];
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

/** Trakt's `/sync/watched/shows` only lists shows with at least one play; a
 * never-watched show (no plays, no last-watched date) is absent here and reaches
 * the library only via the watchlist. */
function isWatched(s: ShowFixture): boolean {
  return s.completed > 0 || s.lastWatchedAt !== null;
}

function watchedShowsBody(shows: readonly ShowFixture[]): string {
  return JSON.stringify(
    shows.filter(isWatched).map((s) => ({
      last_watched_at: s.lastWatchedAt,
      show: {
        title: s.title,
        status: s.status,
        ids: { trakt: s.trakt, ...(s.tmdb === undefined ? {} : { tmdb: s.tmdb }) },
        ...(s.posters === undefined ? {} : { images: { poster: s.posters } }),
      },
    })),
  );
}

/** Derive the per-season watched tree from the linear `completed` counter (watch-order episodes). */
function progressSeasons(show: ShowFixture): unknown[] {
  const watchedAt = show.lastWatchedAt ?? "2026-06-01T00:00:00.000Z";
  const bySeason = new Map<
    number,
    { number: number; completed: boolean; last_watched_at?: string }[]
  >();
  show.episodes.forEach((ep, index) => {
    const completed = index < show.completed;
    const list = bySeason.get(ep.season) ?? [];
    list.push({
      number: ep.number,
      completed,
      ...(completed ? { last_watched_at: watchedAt } : {}),
    });
    bySeason.set(ep.season, list);
  });
  return [...bySeason.entries()].map(([number, episodes]) => ({
    number,
    aired: episodes.length,
    completed: episodes.filter((e) => e.completed).length,
    episodes,
  }));
}

function episodeBody(ep: EpisodeFixture): string {
  return JSON.stringify({
    season: ep.season,
    number: ep.number,
    title: ep.title,
    overview: ep.overview ?? null,
    runtime: 42,
    first_aired: ep.firstAired,
    ids: { trakt: ep.traktId },
    images: ep.stills === undefined ? {} : { screenshot: ep.stills },
  });
}

function progressBody(show: ShowFixture): string {
  const next = show.episodes[show.completed];
  return JSON.stringify({
    aired: show.aired,
    completed: show.completed,
    next_episode:
      next === undefined
        ? null
        : {
            season: next.season,
            number: next.number,
            title: next.title,
            first_aired: next.firstAired,
            ids: { trakt: next.traktId },
          },
    seasons: progressSeasons(show),
  });
}

function showDetailBody(show: ShowFixture): string {
  return JSON.stringify({
    title: show.title,
    status: show.status,
    overview: show.overview ?? null,
    network: show.network ?? null,
    first_aired: show.episodes[0]?.firstAired ?? null,
    ids: { trakt: show.trakt, ...(show.tmdb === undefined ? {} : { tmdb: show.tmdb }) },
    images: {
      ...(show.posters === undefined ? {} : { poster: show.posters }),
      ...(show.backdrops === undefined ? {} : { fanart: show.backdrops }),
    },
  });
}

function seasonsBody(show: ShowFixture): string {
  const bySeason = new Map<number, EpisodeFixture[]>();
  for (const ep of show.episodes) {
    const list = bySeason.get(ep.season) ?? [];
    list.push(ep);
    bySeason.set(ep.season, list);
  }
  return JSON.stringify(
    [...bySeason.entries()].map(([number, episodes]) => ({
      number,
      title: number === 0 ? "Specials" : `Season ${number}`,
      episodes: episodes.map((ep) => ({
        season: ep.season,
        number: ep.number,
        title: ep.title,
        first_aired: ep.firstAired,
        ids: { trakt: ep.traktId },
      })),
    })),
  );
}

function applyWrite(
  shows: readonly ShowFixture[],
  episodeIds: readonly number[],
  remove: boolean,
): void {
  for (const show of shows) {
    const index = show.episodes.findIndex((ep) => episodeIds.includes(ep.traktId));
    if (index === -1) continue;
    show.completed = remove ? Math.min(show.completed, index) : Math.max(show.completed, index + 1);
  }
}

/** Move a fixture's linear `completed` counter to cover a bulk `shows[].seasons` subtree. */
function applyBulkWrite(
  shows: readonly ShowFixture[],
  showBodies: readonly CapturedShow[],
  remove: boolean,
): void {
  for (const body of showBodies) {
    const show = shows.find((s) => s.trakt === body.ids?.trakt);
    if (show === undefined) continue;
    const indices: number[] = [];
    for (const season of body.seasons ?? []) {
      show.episodes.forEach((ep, index) => {
        if (ep.season !== season.number) return;
        if (season.episodes !== undefined && !season.episodes.some((e) => e.number === ep.number)) {
          return;
        }
        indices.push(index);
      });
    }
    if (indices.length === 0) continue;
    show.completed = remove
      ? Math.min(show.completed, Math.min(...indices))
      : Math.max(show.completed, Math.max(...indices) + 1);
  }
}

/**
 * Intercept the whole Up Next read+write surface with a stateful fixture: reads
 * derive `next_episode` from a live `completed` count, and history writes mutate
 * it, so an optimistic mark, its background refetch, a reconcile progress re-read,
 * and an Undo all stay consistent. Register AFTER `installHermeticRoutes` so
 * these specific routes win over the catch-alls (last route registered wins).
 */
export async function installLibraryRoutes(
  context: BrowserContext,
  shows: readonly ShowFixture[],
): Promise<LibraryControls> {
  let writeMode: WriteMode = "ok";
  let readMode: "ok" | "abort" = "ok";
  let readDelayMs = 0;
  let rateLimitConsumed = false;
  let failedProgressIds = new Set<number>();
  const writes: CapturedWrite[] = [];
  let progressReads = 0;
  let progressRateLimitBudget = 0;

  // A mutable `/sync/last_activities` stamp table. Seeded newer than any baseline
  // snapshot a test seeds, so a boot with an OLDER stored snapshot diffs a change;
  // `bumpActivity` advances a single field to drive exactly one diff-invalidation.
  const ACTIVITY_BASE = Date.parse("2026-07-04T00:00:00.000Z");
  let activityTick = 0;
  const activities: Record<string, Record<string, string>> = {
    episodes: { watched_at: "2026-07-04T00:00:00.000Z" },
    shows: { rated_at: "2026-07-04T00:00:00.000Z", watchlisted_at: "2026-07-04T00:00:00.000Z" },
    movies: { watched_at: "2026-07-04T00:00:00.000Z" },
    watchlist: { updated_at: "2026-07-04T00:00:00.000Z" },
  };

  const readWait = (): Promise<void> => (readDelayMs > 0 ? sleep(readDelayMs) : Promise.resolve());

  // Serve a real 1×1 PNG for Trakt inline posters so a resolved poster loads
  // deterministically instead of erroring into the text-only fallback.
  const pngPixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  await context.route("**/media.trakt.tv/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: pngPixel }),
  );

  await context.route("**/api.trakt.tv/sync/watched/shows*", async (route) => {
    if (readMode === "abort") return route.abort();
    await readWait();
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: watchedShowsBody(shows) });
  });

  // The freshness gate's poll. Cheap (no readWait) but honors `abort` so an offline
  // boot's poll fails silently. Serves the live, bump-able stamp table.
  await context.route("**/api.trakt.tv/sync/last_activities*", (route) => {
    if (readMode === "abort") return route.abort();
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ all: "2026-07-04T00:00:00.000Z", ...activities }),
    });
  });

  // Show detail (`/shows/:id`) is registered before the progress + seasons routes
  // so those more-specific paths, registered later, win over this catch (last
  // route registered wins).
  await context.route("**/api.trakt.tv/shows/*", async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split("/")[2]);
    if (readMode === "abort") return route.abort();
    await readWait();
    const show = shows.find((s) => s.trakt === id);
    if (show === undefined)
      return route.fulfill({ status: 404, headers: JSON_HEADERS, body: "{}" });
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: showDetailBody(show) });
  });

  await context.route("**/api.trakt.tv/shows/*/progress/watched*", async (route) => {
    progressReads += 1;
    const id = Number(new URL(route.request().url()).pathname.split("/")[2]);
    if (readMode === "abort" || failedProgressIds.has(id)) return route.abort();
    if (progressRateLimitBudget > 0) {
      progressRateLimitBudget -= 1;
      return route.fulfill({
        status: 429,
        headers: { ...JSON_HEADERS, "retry-after": "1" },
        body: "{}",
      });
    }
    const show = shows.find((s) => s.trakt === id);
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body:
        show === undefined
          ? JSON.stringify({ aired: 0, completed: 0, next_episode: null })
          : progressBody(show),
    });
  });

  await context.route("**/api.trakt.tv/shows/*/seasons*", async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split("/")[2]);
    if (readMode === "abort") return route.abort();
    await readWait();
    const show = shows.find((s) => s.trakt === id);
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: show === undefined ? "[]" : seasonsBody(show),
    });
  });

  // Single-episode read (registered after the seasons catch so this deeper path wins).
  await context.route("**/api.trakt.tv/shows/*/seasons/*/episodes/*", async (route) => {
    if (readMode === "abort") return route.abort();
    await readWait();
    const parts = new URL(route.request().url()).pathname.split("/");
    const id = Number(parts[2]);
    const season = Number(parts[4]);
    const number = Number(parts[6]);
    const show = shows.find((s) => s.trakt === id);
    const ep = show?.episodes.find((e) => e.season === season && e.number === number);
    if (ep === undefined) return route.fulfill({ status: 404, headers: JSON_HEADERS, body: "{}" });
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: episodeBody(ep) });
  });

  const handleHidden = (hidden: boolean) => (route: import("@playwright/test").Route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      shows?: { ids?: { trakt?: number } }[];
    };
    const showIds = (body.shows ?? []).map((s) => s.ids?.trakt ?? -1);
    for (const show of shows) if (showIds.includes(show.trakt)) show.hidden = hidden;
    writes.push({
      path: hidden ? "/users/hidden/progress_watched" : "/users/hidden/progress_watched/remove",
      episodeIds: [],
      watchedAt: null,
      showIds,
    });
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ [hidden ? "added" : "deleted"]: { shows: showIds.length } }),
    });
  };

  // `/remove` is registered after the base hidden route so it wins for that path.
  await context.route("**/api.trakt.tv/users/hidden/progress_watched*", (route) => {
    if (route.request().method() === "POST") return handleHidden(true)(route);
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        shows
          .filter((s) => s.hidden)
          .map((s) => ({ type: "show", show: { title: s.title, ids: { trakt: s.trakt } } })),
      ),
    });
  });
  await context.route("**/api.trakt.tv/users/hidden/progress_watched/remove*", handleHidden(false));

  await context.route("**/api.trakt.tv/sync/watchlist/shows*", (route) =>
    route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        shows
          .filter((s) => s.inWatchlist)
          .map((s) => ({ type: "show", show: { title: s.title, ids: { trakt: s.trakt } } })),
      ),
    }),
  );

  const handleHistory = (remove: boolean) => async (route: import("@playwright/test").Route) => {
    const body = (route.request().postDataJSON() ?? {}) as HistoryBody;
    const episodeIds = (body.episodes ?? []).map((e) => e.ids?.trakt ?? -1);
    const showBodies = (body.shows ?? []) as CapturedShow[];
    const watchedAt = body.episodes?.[0]?.watched_at ?? body.shows?.[0]?.watched_at ?? null;
    const firstEpisode = body.episodes?.[0];
    const episodeItemKeys = firstEpisode === undefined ? undefined : Object.keys(firstEpisode);
    const path = remove ? "/sync/history/remove" : "/sync/history";
    writes.push({ path, episodeIds, watchedAt, shows: showBodies, episodeItemKeys });

    const apply = (): void => {
      applyWrite(shows, episodeIds, remove);
      applyBulkWrite(shows, showBodies, remove);
    };

    if (!remove && writeMode === "abort") return route.abort();
    if (!remove && writeMode === "network-drop") {
      apply();
      return route.abort();
    }
    if (!remove && writeMode === "rate-limit-once" && !rateLimitConsumed) {
      rateLimitConsumed = true;
      return route.fulfill({
        status: 429,
        headers: { ...JSON_HEADERS, "retry-after": "1" },
        body: "{}",
      });
    }
    if (!remove && writeMode === "delay") await sleep(5000);

    apply();
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        added: { episodes: episodeIds.length },
        deleted: { episodes: remove ? episodeIds.length : 0 },
      }),
    });
  };

  await context.route("**/api.trakt.tv/sync/history", handleHistory(false));
  await context.route("**/api.trakt.tv/sync/history/remove", handleHistory(true));

  // ---- Ratings (stateful: GET reflects captured POSTs) ----
  const showRatings = new Map<number, number>();
  const episodeRatings = new Map<number, number>();

  const findEpisode = (trakt: number): EpisodeFixture | undefined => {
    for (const show of shows) {
      const ep = show.episodes.find((e) => e.traktId === trakt);
      if (ep !== undefined) return ep;
    }
    return undefined;
  };

  const handleRatings = (remove: boolean) => (route: import("@playwright/test").Route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      shows?: { ids?: { trakt?: number }; rating?: number }[];
      episodes?: { ids?: { trakt?: number }; rating?: number }[];
    };
    const showIds = (body.shows ?? []).map((s) => s.ids?.trakt ?? -1);
    const episodeIds = (body.episodes ?? []).map((e) => e.ids?.trakt ?? -1);
    const rating = body.shows?.[0]?.rating ?? body.episodes?.[0]?.rating ?? null;
    for (const id of showIds) {
      if (remove) showRatings.delete(id);
      else if (rating !== null) showRatings.set(id, rating);
    }
    for (const id of episodeIds) {
      if (remove) episodeRatings.delete(id);
      else if (rating !== null) episodeRatings.set(id, rating);
    }
    writes.push({
      path: remove ? "/sync/ratings/remove" : "/sync/ratings",
      episodeIds,
      showIds,
      rating,
      watchedAt: null,
    });
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ [remove ? "deleted" : "added"]: {} }),
    });
  };

  await context.route("**/api.trakt.tv/sync/ratings/shows*", (route) => {
    if (route.request().method() === "POST") return handleRatings(false)(route);
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        [...showRatings.entries()].map(([trakt, rating]) => ({
          type: "show",
          rating,
          show: { title: shows.find((s) => s.trakt === trakt)?.title ?? "", ids: { trakt } },
        })),
      ),
    });
  });
  await context.route("**/api.trakt.tv/sync/ratings/episodes*", (route) => {
    if (route.request().method() === "POST") return handleRatings(false)(route);
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        [...episodeRatings.entries()].map(([trakt, rating]) => {
          const ep = findEpisode(trakt);
          return {
            type: "episode",
            rating,
            episode: { season: ep?.season ?? 0, number: ep?.number ?? 0, ids: { trakt } },
          };
        }),
      ),
    });
  });
  await context.route("**/api.trakt.tv/sync/ratings", handleRatings(false));
  await context.route("**/api.trakt.tv/sync/ratings/remove", handleRatings(true));

  // ---- Watchlist writes (mutate `inWatchlist` so the GET + To-watch bucket reflect it) ----
  const handleWatchlist = (remove: boolean) => (route: import("@playwright/test").Route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      shows?: { ids?: { trakt?: number } }[];
    };
    const showIds = (body.shows ?? []).map((s) => s.ids?.trakt ?? -1);
    for (const show of shows) if (showIds.includes(show.trakt)) show.inWatchlist = !remove;
    writes.push({
      path: remove ? "/sync/watchlist/remove" : "/sync/watchlist",
      episodeIds: [],
      showIds,
      watchedAt: null,
    });
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ [remove ? "deleted" : "added"]: { shows: showIds.length } }),
    });
  };
  await context.route("**/api.trakt.tv/sync/watchlist/remove", handleWatchlist(true));
  // The base `/sync/watchlist` POST is registered after `/sync/watchlist/shows` (a GET) so
  // the read route still serves membership; POST and GET are disjoint by method + path.
  await context.route("**/api.trakt.tv/sync/watchlist", handleWatchlist(false));

  return {
    setWriteMode: (mode) => {
      writeMode = mode;
    },
    setReadMode: (mode) => {
      readMode = mode;
    },
    setReadDelayMs: (ms) => {
      readDelayMs = ms;
    },
    failProgressFor: (traktIds) => {
      failedProgressIds = new Set(traktIds);
    },
    rateLimitProgressReads: (n) => {
      progressRateLimitBudget = n;
    },
    bumpActivity: (section, field) => {
      activityTick += 1;
      const iso = new Date(ACTIVITY_BASE + activityTick * 60_000).toISOString();
      activities[section] = { ...(activities[section] ?? {}), [field]: iso };
    },
    clearWrites: () => {
      writes.length = 0;
    },
    writes: () => writes,
    historyPosts: () => writes.filter((w) => w.path === "/sync/history"),
    removePosts: () => writes.filter((w) => w.path === "/sync/history/remove"),
    hiddenPosts: () => writes.filter((w) => w.path === "/users/hidden/progress_watched"),
    ratingPosts: () => writes.filter((w) => w.path === "/sync/ratings"),
    ratingRemovePosts: () => writes.filter((w) => w.path === "/sync/ratings/remove"),
    watchlistPosts: () => writes.filter((w) => w.path === "/sync/watchlist"),
    watchlistRemovePosts: () => writes.filter((w) => w.path === "/sync/watchlist/remove"),
    progressReads: () => progressReads,
  };
}

/**
 * Seed a durable write-queue op-log into idb-keyval before the app boots, so a
 * boot exercises the startup-reconcile replay path (a mark left pending by a
 * prior session). Mirrors `seedAuth`'s at-document-start write so the op-log is
 * present ahead of the runtime's restore read.
 */
export async function seedOpLog(context: BrowserContext, ops: readonly unknown[]): Promise<void> {
  await context.addInitScript(
    ({ log }) => {
      const open = indexedDB.open("keyval-store");
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("keyval")) {
          open.result.createObjectStore("keyval");
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put(log, "cue.write-queue");
        tx.oncomplete = () => db.close();
      };
    },
    { log: JSON.stringify(ops) },
  );
}

/** A minimal persisted mark-episode op (as `buildMarkEpisodeOp` serializes) for op-log seeding. */
export function seededMarkOp(opts: {
  readonly episodeId: number;
  readonly showId: number;
  readonly preCompleted: number;
  readonly watchedAt: string;
}): unknown {
  return {
    id: `seeded-${opts.episodeId}`,
    itemKey: `episode:${opts.episodeId}`,
    request: {
      method: "POST",
      path: "/sync/history",
      body: { episodes: [{ ids: { trakt: opts.episodeId }, watched_at: opts.watchedAt }] },
    },
    inverse: {
      method: "POST",
      path: "/sync/history/remove",
      body: { episodes: [{ ids: { trakt: opts.episodeId } }] },
    },
    inversePatch: { showId: opts.showId, preCompleted: opts.preCompleted },
    watchedAt: opts.watchedAt,
    fromState: "absent",
    toState: "present",
    reconcileKeys: ["progress/watched", "watched/shows"],
  };
}

/** A persisted bulk season-mark op (as `buildBulkMarkOps` serializes) carrying its reconcile anchor. */
export function seededBulkOp(opts: {
  readonly showId: number;
  readonly season: number;
  readonly preCompleted: number;
  readonly watchedAt: string;
}): unknown {
  const seasons = [{ number: opts.season }];
  return {
    id: `seeded-bulk-${opts.showId}-${opts.season}`,
    itemKey: `show:${opts.showId}:bulk:seeded`,
    request: {
      method: "POST",
      path: "/sync/history",
      body: { shows: [{ ids: { trakt: opts.showId }, watched_at: opts.watchedAt, seasons }] },
    },
    inverse: {
      method: "POST",
      path: "/sync/history/remove",
      body: { shows: [{ ids: { trakt: opts.showId }, seasons }] },
    },
    inversePatch: { showId: opts.showId, preCompleted: opts.preCompleted },
    watchedAt: opts.watchedAt,
    fromState: "absent",
    toState: "present",
    reconcileKeys: ["progress/watched", "watched/shows"],
  };
}

/** A persisted hide op (as `buildHideShowOp` serializes) carrying its hidden-set reconcile anchor. */
export function seededHideOp(showId: number): unknown {
  const body = { shows: [{ ids: { trakt: showId } }] };
  return {
    id: `seeded-hide-${showId}`,
    itemKey: `show:${showId}:hidden`,
    request: { method: "POST", path: "/users/hidden/progress_watched", body },
    inverse: { method: "POST", path: "/users/hidden/progress_watched/remove", body },
    inversePatch: { kind: "hidden", showId },
    watchedAt: null,
    fromState: "absent",
    toState: "present",
    reconcileKeys: ["hidden/progress_watched"],
  };
}

/** Read a raw stored string straight from idb-keyval's object store (post-write assertions). */
export async function readStored(page: Page, key: string): Promise<string | null> {
  return page.evaluate(
    (k) =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("keyval", "readonly");
          const request = tx.objectStore("keyval").get(k);
          request.onsuccess = () => {
            db.close();
            resolve((request.result as string | undefined) ?? null);
          };
          request.onerror = () => reject(request.error);
        };
        open.onerror = () => reject(open.error);
      }),
    key,
  );
}

function persistedEntry(index: number): unknown {
  const airedIso = new Date(Date.now() - (index + 1) * 86_400_000).toISOString();
  return {
    showId: 5000 + index,
    title: `Cached Show ${index + 1}`,
    status: "returning series",
    hidden: false,
    inWatchlist: false,
    lastWatchedAt: airedIso,
    aired: 10,
    completed: 3,
    nextEpisode: {
      season: 1,
      number: 4,
      title: "Cached Next",
      firstAired: airedIso,
      ids: { trakt: 40000 + index },
    },
    posters: [],
    backdrops: [],
    network: null,
    genres: [],
    runtime: null,
    tmdbId: null,
    pendingAdvance: false,
  };
}

/**
 * A dehydrated Query cache holding the assembled `library` query with `count`
 * up-next entries. `buster` defaults to the app's current `PERSIST_BUSTER`; pass
 * an older value to simulate a pre-migration cache the persister must drop.
 */
export function buildPersistedLibrary(count: number, ageMs: number, buster = "cue-m5"): string {
  const updatedAt = Date.now() - ageMs;
  const entries = Array.from({ length: count }, (_, index) => persistedEntry(index));
  return JSON.stringify({
    buster,
    timestamp: updatedAt,
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ["library"],
          queryHash: '["library"]',
          state: {
            data: { entries, tmdbConfig: null },
            dataUpdateCount: 1,
            dataUpdatedAt: updatedAt,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: "success",
            fetchStatus: "idle",
          },
        },
      ],
    },
  });
}

/**
 * Seed a `/sync/last_activities` baseline snapshot into idb-keyval before the app
 * boots (at document start, like `seedAuth`), so the boot poll has a prior stamp
 * table to diff against. A baseline MATCHING the harness fixture makes the first
 * poll a clean no-op; a baseline OLDER than it drives the poll to detect a change
 * and revalidate — the poll-driven successor to refetch-on-mount.
 */
export async function seedActivities(context: BrowserContext, snapshot: unknown): Promise<void> {
  await context.addInitScript(
    ({ value }) => {
      const open = indexedDB.open("keyval-store");
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("keyval")) {
          open.result.createObjectStore("keyval");
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put(value, "cue.last-activities");
        tx.oncomplete = () => db.close();
      };
    },
    { value: JSON.stringify(snapshot) },
  );
}

/**
 * Seed the persisted Query cache into idb-keyval BEFORE the app boots (at document
 * start, like `seedAuth`), so the restore path reads it on mount. Used to simulate
 * a pre-migration (older-`buster`) cache the persister must drop.
 */
export async function seedQueryCacheAtStart(
  context: BrowserContext,
  serialized: string,
): Promise<void> {
  await context.addInitScript(
    ({ value }) => {
      const open = indexedDB.open("keyval-store");
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("keyval")) {
          open.result.createObjectStore("keyval");
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put(value, "cue.query-cache");
        tx.oncomplete = () => db.close();
      };
    },
    { value: serialized },
  );
}

/** Write the persisted cache into idb-keyval's store, matching the app's persister key. */
export async function seedQueryCache(page: Page, serialized: string): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put(value, "cue.query-cache");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    serialized,
  );
}

const DAY_MS = 86_400_000;

/** A calendar (`/calendars/my/shows`) episode row for the Upcoming fixture. */
export interface CalendarEpisodeFixture {
  readonly showId: number;
  readonly showTitle: string;
  readonly season: number;
  readonly number: number;
  readonly title: string | null;
  readonly firstAired: string;
  readonly traktId: number;
  readonly tmdb?: number;
}

export interface CalendarRequest {
  readonly start: string;
  readonly days: number;
}

/** `ok` applies+200; `delay` holds the POST open so the op stays durable; `rate-limit-once`
 * 429s the first attempt (Retry-After) then applies; `reject` hard-fails (403) so the durable
 * queue rolls the optimistic mark back. */
export type CalendarWriteMode = "ok" | "delay" | "rate-limit-once" | "reject";

export interface CalendarControls {
  /** Every `/calendars/my/shows/{start}/{days}` request, in order (proves widen refetches). */
  calendarRequests: () => readonly CalendarRequest[];
  /** Captured `POST /sync/history` attempts (proves the quick mark-watched fired + retried). */
  historyPosts: () => readonly CapturedWrite[];
  /** Captured `POST /sync/history/remove` attempts (proves the point-of-action Undo fired). */
  removePosts: () => readonly CapturedWrite[];
  setWriteMode: (mode: CalendarWriteMode) => void;
}

function calendarItemBody(items: readonly CalendarEpisodeFixture[]): string {
  return JSON.stringify(
    items.map((item) => ({
      first_aired: item.firstAired,
      episode: {
        season: item.season,
        number: item.number,
        title: item.title,
        ids: { trakt: item.traktId, ...(item.tmdb === undefined ? {} : { tmdb: item.tmdb }) },
      },
      show: { title: item.showTitle, ids: { trakt: item.showId } },
    })),
  );
}

/**
 * Intercept the Upcoming read+write surface: the personalized calendar window
 * (filtered by the requested `days` so widening genuinely adds rows), the hidden
 * set (excluded client-side), and history writes from the quick mark-watched.
 * Register AFTER `installHermeticRoutes` so these specific routes win.
 */
export async function installCalendarRoutes(
  context: BrowserContext,
  items: readonly CalendarEpisodeFixture[],
  hiddenShowIds: readonly number[] = [],
): Promise<CalendarControls> {
  const requests: CalendarRequest[] = [];
  const writes: CapturedWrite[] = [];
  let writeMode: CalendarWriteMode = "ok";
  let rateLimitConsumed = false;

  await context.route("**/api.trakt.tv/calendars/my/shows/*/*", (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    const start = parts[4] ?? "";
    const days = Number(parts[5] ?? "0");
    requests.push({ start, days });
    const startMs = Date.parse(`${start}T00:00:00.000Z`);
    const upper = startMs + days * DAY_MS;
    const inWindow = items.filter((item) => Date.parse(item.firstAired) < upper);
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: calendarItemBody(inWindow),
    });
  });

  await context.route("**/api.trakt.tv/users/hidden/progress_watched*", (route) =>
    route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        hiddenShowIds.map((trakt) => ({
          type: "show",
          show: { title: `Hidden ${trakt}`, ids: { trakt } },
        })),
      ),
    }),
  );

  await context.route("**/api.trakt.tv/sync/history", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      episodes?: { ids?: { trakt?: number }; watched_at?: string }[];
    };
    const episodeIds = (body.episodes ?? []).map((e) => e.ids?.trakt ?? -1);
    writes.push({
      path: "/sync/history",
      episodeIds,
      watchedAt: body.episodes?.[0]?.watched_at ?? null,
    });
    if (writeMode === "reject") {
      return route.fulfill({ status: 403, headers: JSON_HEADERS, body: "{}" });
    }
    if (writeMode === "rate-limit-once" && !rateLimitConsumed) {
      rateLimitConsumed = true;
      return route.fulfill({
        status: 429,
        headers: { ...JSON_HEADERS, "retry-after": "1" },
        body: "{}",
      });
    }
    if (writeMode === "delay") await sleep(5000);
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ added: { episodes: episodeIds.length } }),
    });
  });

  // The Undo's compensating remove.
  await context.route("**/api.trakt.tv/sync/history/remove", (route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      episodes?: { ids?: { trakt?: number } }[];
    };
    const episodeIds = (body.episodes ?? []).map((e) => e.ids?.trakt ?? -1);
    writes.push({ path: "/sync/history/remove", episodeIds, watchedAt: null });
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ deleted: { episodes: episodeIds.length } }),
    });
  });

  return {
    calendarRequests: () => requests,
    historyPosts: () => writes.filter((w) => w.path === "/sync/history"),
    removePosts: () => writes.filter((w) => w.path === "/sync/history/remove"),
    setWriteMode: (mode) => {
      writeMode = mode;
    },
  };
}

/** A movie fixture for the movie-library + detail + mark-watched surface. */
export interface MovieFixture {
  readonly trakt: number;
  readonly tmdb?: number;
  readonly title: string;
  readonly year?: number;
  readonly overview?: string;
  readonly runtime?: number;
  readonly released?: string;
  readonly posters?: readonly string[];
  readonly backdrops?: readonly string[];
  /** Mutated in place by intercepted history writes so watched reads stay consistent. */
  watched: boolean;
  /** Mutated in place by intercepted watchlist writes so the Watchlist shelf stays consistent. */
  inWatchlist?: boolean;
}

export interface CapturedMovieWrite {
  readonly path: string;
  readonly movieIds: readonly number[];
  readonly watchedAt: string | null;
  /** The keys on the first `movies[]` item (proves an all-plays remove is ids only). */
  readonly movieItemKeys?: readonly string[];
}

export interface MovieControls {
  historyPosts: () => readonly CapturedMovieWrite[];
  historyRemovePosts: () => readonly CapturedMovieWrite[];
  watchlistPosts: () => readonly CapturedMovieWrite[];
  watchlistRemovePosts: () => readonly CapturedMovieWrite[];
}

function movieObject(movie: MovieFixture): Record<string, unknown> {
  return {
    title: movie.title,
    ...(movie.year === undefined ? {} : { year: movie.year }),
    ids: { trakt: movie.trakt, ...(movie.tmdb === undefined ? {} : { tmdb: movie.tmdb }) },
    ...(movie.posters === undefined ? {} : { images: { poster: movie.posters } }),
  };
}

function movieDetailBody(movie: MovieFixture): string {
  return JSON.stringify({
    title: movie.title,
    ...(movie.year === undefined ? {} : { year: movie.year }),
    overview: movie.overview ?? null,
    runtime: movie.runtime ?? null,
    released: movie.released ?? null,
    genres: ["science fiction", "drama"],
    ids: { trakt: movie.trakt, ...(movie.tmdb === undefined ? {} : { tmdb: movie.tmdb }) },
    images: {
      ...(movie.posters === undefined ? {} : { poster: movie.posters }),
      ...(movie.backdrops === undefined ? {} : { fanart: movie.backdrops }),
    },
  });
}

/**
 * Intercept the whole movie read+write surface with a stateful fixture: watched +
 * watchlist reads reflect live `watched`/`inWatchlist` flags, movie detail resolves
 * from `/movies/:id`, and history/watchlist writes mutate the flags so an
 * optimistic mark and its background refetch stay consistent. Register AFTER
 * `installHermeticRoutes` so these specific routes win over the catch-alls.
 */
export async function installMovieRoutes(
  context: BrowserContext,
  movies: readonly MovieFixture[],
): Promise<MovieControls> {
  const writes: CapturedMovieWrite[] = [];

  const pngPixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  await context.route("**/media.trakt.tv/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: pngPixel }),
  );

  await context.route("**/api.trakt.tv/sync/watched/movies*", (route) =>
    route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        movies
          .filter((m) => m.watched)
          .map((m) => ({ last_watched_at: "2026-06-01T00:00:00.000Z", movie: movieObject(m) })),
      ),
    }),
  );

  await context.route("**/api.trakt.tv/sync/watchlist/movies*", (route) =>
    route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        movies.filter((m) => m.inWatchlist).map((m) => ({ type: "movie", movie: movieObject(m) })),
      ),
    }),
  );

  await context.route("**/api.trakt.tv/movies/*", (route) => {
    const id = Number(new URL(route.request().url()).pathname.split("/")[2]);
    const movie = movies.find((m) => m.trakt === id);
    if (movie === undefined)
      return route.fulfill({ status: 404, headers: JSON_HEADERS, body: "{}" });
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: movieDetailBody(movie) });
  });

  const handleHistory = (remove: boolean) => (route: import("@playwright/test").Route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      movies?: { ids?: { trakt?: number }; watched_at?: string }[];
    };
    const items = body.movies ?? [];
    const movieIds = items.map((m) => m.ids?.trakt ?? -1);
    for (const movie of movies) if (movieIds.includes(movie.trakt)) movie.watched = !remove;
    writes.push({
      path: remove ? "/sync/history/remove" : "/sync/history",
      movieIds,
      watchedAt: items[0]?.watched_at ?? null,
      movieItemKeys: items[0] === undefined ? undefined : Object.keys(items[0]),
    });
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ [remove ? "deleted" : "added"]: { movies: movieIds.length } }),
    });
  };
  await context.route("**/api.trakt.tv/sync/history", handleHistory(false));
  await context.route("**/api.trakt.tv/sync/history/remove", handleHistory(true));

  const handleWatchlist = (remove: boolean) => (route: import("@playwright/test").Route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      movies?: { ids?: { trakt?: number } }[];
    };
    const movieIds = (body.movies ?? []).map((m) => m.ids?.trakt ?? -1);
    for (const movie of movies) if (movieIds.includes(movie.trakt)) movie.inWatchlist = !remove;
    writes.push({
      path: remove ? "/sync/watchlist/remove" : "/sync/watchlist",
      movieIds,
      watchedAt: null,
    });
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ [remove ? "deleted" : "added"]: { movies: movieIds.length } }),
    });
  };
  await context.route("**/api.trakt.tv/sync/watchlist/remove", handleWatchlist(true));
  await context.route("**/api.trakt.tv/sync/watchlist", handleWatchlist(false));

  return {
    historyPosts: () => writes.filter((w) => w.path === "/sync/history"),
    historyRemovePosts: () => writes.filter((w) => w.path === "/sync/history/remove"),
    watchlistPosts: () => writes.filter((w) => w.path === "/sync/watchlist"),
    watchlistRemovePosts: () => writes.filter((w) => w.path === "/sync/watchlist/remove"),
  };
}

/** A search (`/search/show,movie`) result row for the Discover fixture. */
export interface SearchHitFixture {
  readonly type: "show" | "movie";
  readonly traktId: number;
  readonly title: string;
  readonly year?: number;
  readonly tmdb?: number;
}

export interface SearchControls {
  /** Every `/search/show,movie?query=` term received, in order (proves debounce = one request). */
  searchQueries: () => readonly string[];
  /** Captured `POST /sync/watchlist` writes (proves the inline Add fired). */
  watchlistPosts: () => readonly CapturedWrite[];
}

function searchResultBody(hits: readonly SearchHitFixture[]): string {
  return JSON.stringify(
    hits.map((hit) => {
      const media = {
        title: hit.title,
        ...(hit.year === undefined ? {} : { year: hit.year }),
        ids: { trakt: hit.traktId, ...(hit.tmdb === undefined ? {} : { tmdb: hit.tmdb }) },
      };
      return { type: hit.type, score: 100, [hit.type]: media };
    }),
  );
}

/**
 * Intercept Discover search: `/search/show,movie` resolves the query through the
 * caller's `resolve` (so a term can map to results or nothing) and records every
 * term, and `POST /sync/watchlist` is captured for the inline-add assertion.
 * Register AFTER `installHermeticRoutes` so these specific routes win.
 */
export async function installSearchRoutes(
  context: BrowserContext,
  resolve: (query: string) => readonly SearchHitFixture[],
): Promise<SearchControls> {
  const queries: string[] = [];
  const writes: CapturedWrite[] = [];

  await context.route("**/api.trakt.tv/search/**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("query") ?? "";
    queries.push(query);
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: searchResultBody(resolve(query)),
    });
  });

  await context.route("**/api.trakt.tv/sync/watchlist", (route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      shows?: { ids?: { trakt?: number } }[];
      movies?: { ids?: { trakt?: number } }[];
    };
    const showIds = [...(body.shows ?? []), ...(body.movies ?? [])].map((s) => s.ids?.trakt ?? -1);
    writes.push({ path: "/sync/watchlist", episodeIds: [], showIds, watchedAt: null });
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        added: { shows: body.shows?.length ?? 0, movies: body.movies?.length ?? 0 },
      }),
    });
  });

  return {
    searchQueries: () => queries,
    watchlistPosts: () => writes.filter((w) => w.path === "/sync/watchlist"),
  };
}
