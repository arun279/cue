import type { OAuthConfig } from "@cue/core/data/auth/oauth";
import {
  type AuthorizedFetchDeps,
  createAuthorizedFetch,
  UnauthorizedWriteError,
} from "@cue/core/data/trakt/authorized-fetch";
import type { Token } from "@cue/core/domain/model/token";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTraktFake } from "../trakt-fake/fake.ts";

const NOW_MS = Date.parse("2026-10-15T00:00:00.000Z");
const DAY_S = 86_400;
const fake = createTraktFake({ clock: () => NOW_MS });
const config: OAuthConfig = {
  clientId: "cid",
  redirectUri: "https://app.example/auth/callback",
  fetch: fake.fetch,
};

const READ = "https://api.trakt.tv/users/settings";
const WRITE = "https://api.trakt.tv/sync/history";
const REFRESH = { path: /^\/oauth\/token$/ };

beforeEach(() => fake.reset());

/** The fake's signed-in session, unless overridden. */
function session(overrides: Partial<Token> = {}): Token {
  const { access_token, refresh_token, created_at, expires_in } = fake.session();
  return { access_token, refresh_token, created_at, expires_in, ...overrides };
}

/** A token the app's clock reads as past its 7 days. */
const expired = (overrides: Partial<Token> = {}): Token =>
  session({ created_at: session().created_at - 8 * DAY_S, ...overrides });
/** An access token Trakt does not know, as after a revoke has settled, with a live refresh token. */
const stale = (): Token => session({ access_token: "stale-access" });
/** A session whose refresh token Trakt does not know either. */
const dead = (): Token => session({ access_token: "stale-access", refresh_token: "never-issued" });

function build(overrides: Partial<AuthorizedFetchDeps> = {}) {
  const persist = vi.fn((_t: Token) => Promise.resolve());
  const endSession = vi.fn(() => Promise.resolve());
  const authorized = createAuthorizedFetch({
    inner: fake.fetch,
    token: session(),
    config,
    persist,
    endSession,
    now: () => NOW_MS,
    throttleMs: 60_000,
    ...overrides,
  });
  return { authorized, persist, endSession };
}

const sentTo = (path: string) => fake.requests.filter((request) => request.path === path);
const refreshes = (): number => sentTo("/oauth/token").length;
const bearers = (path: string) => sentTo(path).map((request) => request.headers["authorization"]);

describe("createAuthorizedFetch: proactive refresh", () => {
  it("refreshes a past-expiry token before the call and sends the rotated bearer", async () => {
    const { authorized, persist } = build({ token: expired() });

    const res = await authorized.fetch(READ);

    expect(refreshes()).toBe(1);
    const rotated = authorized.accessToken();
    expect(rotated).not.toBe(session().access_token);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ access_token: rotated }));
    expect(bearers("/users/settings")).toEqual([`Bearer ${rotated}`]);
    expect(res.status).toBe(200);
  });

  it("sends the rotated bearer while the rotated token is still being saved", async () => {
    const { authorized } = build({ token: expired(), persist: () => new Promise(() => {}) });

    const res = await authorized.fetch(READ);

    expect(bearers("/users/settings")).toEqual([`Bearer ${authorized.accessToken()}`]);
    expect(res.status).toBe(200);
  });

  it("does not refresh a live token", async () => {
    const { authorized, persist } = build();

    await authorized.fetch(READ);

    expect(refreshes()).toBe(0);
    expect(persist).not.toHaveBeenCalled();
    expect(bearers("/users/settings")).toEqual([`Bearer ${session().access_token}`]);
  });
});

describe("createAuthorizedFetch: reactive 401 refresh + retry", () => {
  it("refreshes once and retries an idempotent read with the rotated bearer", async () => {
    const { authorized } = build({ token: stale() });

    const res = await authorized.fetch(READ);

    expect(refreshes()).toBe(1);
    expect(bearers("/users/settings")).toEqual([
      "Bearer stale-access",
      `Bearer ${authorized.accessToken()}`,
    ]);
    expect(res.status).toBe(200);
  });

  it("two concurrent 401s share ONE refresh (single-flight)", async () => {
    const { authorized } = build({ token: stale() });

    const [a, b] = await Promise.all([
      authorized.fetch(READ, { method: "GET" }),
      authorized.fetch("https://api.trakt.tv/sync/last_activities", { method: "GET" }),
    ]);

    expect(refreshes()).toBe(1);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});

describe("createAuthorizedFetch: dead refresh token", () => {
  it("ends the session on Trakt's 400 invalid_grant and does not retry", async () => {
    const { authorized, endSession } = build({ token: dead() });

    const res = await authorized.fetch(READ, { method: "GET" });

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(sentTo("/users/settings")).toHaveLength(1);
    expect(res.status).toBe(401);
  });

  it("keeps the session on a transient 500 refresh failure and reads it as Trakt trouble", async () => {
    fake.fail(REFRESH, 500);
    const { authorized, endSession } = build({ token: stale() });

    const res = await authorized.fetch(READ, { method: "GET" });

    expect(endSession).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it("keeps reading a 401 inside the refresh throttle as Trakt trouble while the last refresh failed", async () => {
    fake.fail(REFRESH, 503);
    const { authorized } = build({ token: stale() });

    await authorized.fetch(READ, { method: "GET" });
    const second = await authorized.fetch("https://api.trakt.tv/sync/last_activities");

    expect(refreshes()).toBe(1);
    expect(second.status).toBe(503);
  });

  it("ends the session once however many reads were waiting on the refresh", async () => {
    const { authorized, endSession } = build({ token: dead() });
    const paths = [
      "users/settings",
      "sync/last_activities",
      "sync/watched/movies",
      "sync/watched/shows",
      "users/hidden/dropped",
    ];

    const responses = await Promise.all(
      paths.map((path) => authorized.fetch(`https://api.trakt.tv/${path}`, { method: "GET" })),
    );
    await authorized.fetch(READ, { method: "GET" });

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
  });

  it("keeps the session on a 400 that is not invalid_grant (a config/request bug)", async () => {
    fake.fail(REFRESH, 400);
    const { authorized, endSession } = build({ token: stale() });

    const res = await authorized.fetch(READ, { method: "GET" });

    expect(endSession).not.toHaveBeenCalled(); // a code bug must not sign a valid user out
    expect(res.status).toBe(401);
  });

  it("does not send a doomed request when a proactive refresh finds the session dead", async () => {
    const { authorized, endSession } = build({ token: expired({ refresh_token: "never-issued" }) });

    const res = await authorized.fetch(READ, { method: "GET" });

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(sentTo("/users/settings")).toEqual([]); // short-circuited before touching the transport
    expect(res.status).toBe(401);
  });

  it("keeps the session when the refresh network call itself rejects (offline), failing the read as offline", async () => {
    fake.drop(REFRESH);
    const { authorized, endSession } = build({ token: stale() });

    await expect(authorized.fetch(READ, { method: "GET" })).rejects.toThrow();
    expect(endSession).not.toHaveBeenCalled();
  });
});

describe("createAuthorizedFetch: mutating writes are never blind re-POSTed", () => {
  const post = { method: "POST", body: JSON.stringify({ episodes: [{ ids: { trakt: 880120 } }] }) };

  it("throws after refreshing so the write-queue reconciles, never re-sending the body", async () => {
    const { authorized } = build({ token: stale() });

    await expect(authorized.fetch(WRITE, post)).rejects.toBeInstanceOf(UnauthorizedWriteError);

    expect(refreshes()).toBe(1);
    expect(sentTo("/sync/history")).toHaveLength(1); // the POST was sent once, never re-sent
  });

  it("rolls a write back (returns 401) only when the session is genuinely dead", async () => {
    const { authorized, endSession } = build({ token: dead() });

    const res = await authorized.fetch(WRITE, post);

    expect(res.status).toBe(401); // classified as failed by the queue → roll back
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(sentTo("/sync/history")).toHaveLength(1);
  });

  it("defers a write to the queue (throws) when refresh fails transiently, keeping the session", async () => {
    fake.fail(REFRESH, 500);
    const { authorized, endSession } = build({ token: stale() });

    // A transient refresh failure must NOT roll the user's write back: throw so
    // the durable write-queue keeps it queued until refresh recovers.
    await expect(authorized.fetch(WRITE, post)).rejects.toBeInstanceOf(UnauthorizedWriteError);
    expect(endSession).not.toHaveBeenCalled();
    expect(sentTo("/sync/history")).toHaveLength(1); // the POST was sent once, never re-sent
  });
});

describe("createAuthorizedFetch: refresh throttle", () => {
  it("collapses a stale-session burst of sequential reads into one refresh", async () => {
    // The app's clock runs eight days ahead of Trakt's, so the rotated token reads as
    // stale too: a naive impl would refresh on every call; the throttle holds it to one.
    const { authorized } = build({ token: expired(), now: () => NOW_MS + 8 * DAY_S * 1000 });

    await authorized.fetch(READ, { method: "GET" });
    await authorized.fetch("https://api.trakt.tv/sync/last_activities", { method: "GET" });

    expect(refreshes()).toBe(1);
  });

  it("keeps the 60s throttle floor even when Retry-After is shorter", async () => {
    let clock = NOW_MS;
    fake.fail({ ...REFRESH, times: 2 }, 429, 5);
    const { authorized } = build({ token: stale(), now: () => clock });

    await authorized.fetch(READ, { method: "GET" });
    clock += 10_000; // past the 5s Retry-After but still inside the 60s floor
    await authorized.fetch(READ, { method: "GET" });

    // A short Retry-After must not shorten the floor and let a second exchange fire.
    expect(refreshes()).toBe(1);
  });

  it("respects Retry-After on the refresh endpoint before allowing another attempt", async () => {
    let clock = NOW_MS;
    fake.fail({ ...REFRESH, times: 2 }, 429, 90);
    const { authorized, endSession } = build({ token: stale(), now: () => clock });

    await authorized.fetch(READ, { method: "GET" });
    clock += 70_000; // past the 60s floor but still inside the 90s Retry-After window
    await authorized.fetch(READ, { method: "GET" });

    expect(refreshes()).toBe(1);
    expect(endSession).not.toHaveBeenCalled();
  });
});
