import { type OAuthConfig, TRAKT_API_BASE } from "@data/auth/oauth";
import {
  type AuthorizedFetchDeps,
  createAuthorizedFetch,
  UnauthorizedWriteError,
} from "@data/trakt/authorized-fetch";
import type { FetchLike } from "@data/trakt/client";
import type { Token } from "@domain/model/token";
import { delay, HttpResponse, http } from "msw";
import { describe, expect, it, type Mock, vi } from "vitest";
import { mswServer } from "./_msw";

const server = mswServer();

const config: OAuthConfig = { clientId: "cid", redirectUri: "https://app.example/auth/callback" };

// The wrapper's `now` is injected as a fixed fake clock (ms); tokens are minted
// in the same fake domain so `shouldRefresh` (which compares `now` to
// `(created_at + expires_in) * 1000`) is deterministic. NOW_MS = 1e6 → a token
// with `expires_in` of days is live; one expiring in ~100s is already past.
const NOW_MS = 1_000_000;
const DAY_S = 86_400;

/** A live (far-from-expiry) session token unless overridden. */
function token(overrides: Partial<Token> = {}): Token {
  return {
    access_token: "at-old",
    refresh_token: "rt-old",
    created_at: 0,
    expires_in: 90 * DAY_S,
    ...overrides,
  };
}

const expiredToken = (): Token => token({ expires_in: 100 });

const ROTATED: Token = {
  access_token: "at-new",
  refresh_token: "rt-new",
  created_at: 0,
  expires_in: 90 * DAY_S,
};

/** Register a counted `/oauth/token` handler; returns the live call count. */
function stubRefresh(reply: () => Response | Promise<Response>): { calls: () => number } {
  let calls = 0;
  server.use(
    http.post(`${TRAKT_API_BASE}/oauth/token`, () => {
      calls += 1;
      return reply();
    }),
  );
  return { calls: () => calls };
}

const okRefresh = (): Response => HttpResponse.json(ROTATED);

const ok200 = (): Response => new Response(null, { status: 200 });
const res401 = (): Response => new Response(null, { status: 401 });

function build(overrides: Partial<AuthorizedFetchDeps> = {}) {
  const persist = vi.fn((_t: Token) => Promise.resolve());
  const endSession = vi.fn(() => Promise.resolve());
  const inner = vi.fn<FetchLike>(() => Promise.resolve(ok200()));
  const authorized = createAuthorizedFetch({
    inner,
    token: token(),
    config,
    persist,
    endSession,
    now: () => NOW_MS,
    throttleMs: 60_000,
    ...overrides,
  });
  return { authorized, persist, endSession, inner };
}

function bearerAt(inner: Mock<FetchLike>, index: number): string | null {
  const call = inner.mock.calls[index];
  if (call === undefined) throw new Error(`no inner call at index ${index}`);
  return new Headers(call[1]?.headers).get("Authorization");
}

/** Drive one request whose transport always 401s; the caller sets the refresh reply first. */
async function on401(method: "GET" | "POST") {
  const inner = vi.fn<FetchLike>(() => Promise.resolve(res401()));
  const ctx = build({ inner });
  const res = await ctx.authorized.fetch("https://api.trakt.tv/sync/x", { method });
  return { ...ctx, inner, res };
}

describe("createAuthorizedFetch — proactive refresh", () => {
  it("refreshes a past-expiry token before the call and sends the rotated bearer", async () => {
    const refresh = stubRefresh(okRefresh);
    const { authorized, persist, inner } = build({ token: expiredToken() });

    const res = await authorized.fetch("https://api.trakt.tv/sync/x");

    expect(refresh.calls()).toBe(1);
    expect(persist).toHaveBeenCalledWith(ROTATED);
    expect(bearerAt(inner, 0)).toBe("Bearer at-new");
    expect(authorized.accessToken()).toBe("at-new");
    expect(res.status).toBe(200);
  });

  it("does not refresh a live token", async () => {
    const refresh = stubRefresh(okRefresh);
    const { authorized, persist, inner } = build();

    await authorized.fetch("https://api.trakt.tv/sync/x");

    expect(refresh.calls()).toBe(0);
    expect(persist).not.toHaveBeenCalled();
    expect(bearerAt(inner, 0)).toBe("Bearer at-old");
  });
});

describe("createAuthorizedFetch — reactive 401 refresh + retry", () => {
  it("refreshes once and retries an idempotent read with the rotated bearer", async () => {
    const refresh = stubRefresh(okRefresh);
    const inner = vi.fn<FetchLike>();
    inner
      .mockResolvedValueOnce(res401())
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const { authorized } = build({ inner });

    const res = await authorized.fetch("https://api.trakt.tv/sync/x", { method: "GET" });

    expect(refresh.calls()).toBe(1);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(bearerAt(inner, 1)).toBe("Bearer at-new");
    expect(res.status).toBe(200);
  });

  it("two concurrent 401s share ONE refresh (single-flight)", async () => {
    const refresh = stubRefresh(async () => {
      await delay(15);
      return okRefresh();
    });
    const inner = vi.fn<FetchLike>((_i, init) => {
      const bearer = new Headers(init?.headers).get("Authorization");
      return Promise.resolve(
        new Response("[]", { status: bearer === "Bearer at-new" ? 200 : 401 }),
      );
    });
    const { authorized } = build({ inner });

    const [a, b] = await Promise.all([
      authorized.fetch("https://api.trakt.tv/a", { method: "GET" }),
      authorized.fetch("https://api.trakt.tv/b", { method: "GET" }),
    ]);

    expect(refresh.calls()).toBe(1);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});

describe("createAuthorizedFetch — dead refresh token", () => {
  it("ends the session on a 401 invalid_grant and does not retry", async () => {
    stubRefresh(() => HttpResponse.json({ error: "invalid_grant" }, { status: 401 }));
    const { res, endSession, inner } = await on401("GET");

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

  it("keeps the session on a transient 500 refresh failure", async () => {
    stubRefresh(() => HttpResponse.json({}, { status: 500 }));
    const { res, endSession } = await on401("GET");

    expect(endSession).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it("keeps the session on a 400 that is not invalid_grant (a config/request bug)", async () => {
    stubRefresh(() => HttpResponse.json({ error: "invalid_request" }, { status: 400 }));
    const { res, endSession } = await on401("GET");

    expect(endSession).not.toHaveBeenCalled(); // a code bug must not sign a valid user out
    expect(res.status).toBe(401);
  });

  it("does not send a doomed request when a proactive refresh finds the session dead", async () => {
    stubRefresh(() => HttpResponse.json({ error: "invalid_grant" }, { status: 401 }));
    const inner = vi.fn<FetchLike>(() => Promise.resolve(ok200()));
    const { authorized, endSession } = build({ token: expiredToken(), inner });

    const res = await authorized.fetch("https://api.trakt.tv/sync/x", { method: "GET" });

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(inner).not.toHaveBeenCalled(); // short-circuited before touching the transport
    expect(res.status).toBe(401);
  });

  it("keeps the session when the refresh network call itself rejects (offline)", async () => {
    server.use(http.post(`${TRAKT_API_BASE}/oauth/token`, () => HttpResponse.error()));
    const { res, endSession } = await on401("GET");

    expect(endSession).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });
});

describe("createAuthorizedFetch — mutating writes are never blind re-POSTed", () => {
  it("throws after refreshing so the write-queue reconciles, never re-sending the body", async () => {
    const refresh = stubRefresh(okRefresh);
    const inner = vi.fn<FetchLike>(() => Promise.resolve(res401()));
    const { authorized } = build({ inner });

    await expect(
      authorized.fetch("https://api.trakt.tv/sync/history", { method: "POST", body: "{}" }),
    ).rejects.toBeInstanceOf(UnauthorizedWriteError);

    expect(refresh.calls()).toBe(1);
    expect(inner).toHaveBeenCalledTimes(1); // the POST was sent once, never re-sent
  });

  it("rolls a write back (returns 401) only when the session is genuinely dead", async () => {
    stubRefresh(() => HttpResponse.json({ error: "invalid_grant" }, { status: 401 }));
    const { res, endSession, inner } = await on401("POST");

    expect(res.status).toBe(401); // classified as failed by the queue → roll back
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("defers a write to the queue (throws) when refresh fails transiently, keeping the session", async () => {
    stubRefresh(() => HttpResponse.json({}, { status: 500 }));
    const inner = vi.fn<FetchLike>(() => Promise.resolve(res401()));
    const { authorized, endSession } = build({ inner });

    // A transient refresh failure must NOT roll the user's write back: throw so
    // the durable write-queue keeps it queued until refresh recovers.
    await expect(
      authorized.fetch("https://api.trakt.tv/sync/history", { method: "POST", body: "{}" }),
    ).rejects.toBeInstanceOf(UnauthorizedWriteError);
    expect(endSession).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalledTimes(1); // the POST was sent once, never re-sent
  });
});

describe("createAuthorizedFetch — refresh throttle", () => {
  it("collapses a stale-session burst of sequential 401s into one refresh", async () => {
    const refresh = stubRefresh(() => HttpResponse.json({ ...ROTATED, expires_in: 100 }));
    const inner = vi.fn<FetchLike>(() => Promise.resolve(new Response("[]", { status: 200 })));
    // The rotated token is itself stale, so a naive impl would refresh on every
    // call; the throttle must hold the second proactive check to one exchange.
    const { authorized } = build({ token: expiredToken(), inner });

    await authorized.fetch("https://api.trakt.tv/a", { method: "GET" });
    await authorized.fetch("https://api.trakt.tv/b", { method: "GET" });

    expect(refresh.calls()).toBe(1);
  });

  it("keeps the 60s throttle floor even when Retry-After is shorter", async () => {
    let clock = 0;
    const refresh = stubRefresh(() =>
      HttpResponse.json({ error: "slow_down" }, { status: 429, headers: { "Retry-After": "5" } }),
    );
    const inner = vi.fn<FetchLike>(() => Promise.resolve(res401()));
    const { authorized } = build({ inner, now: () => clock });

    await authorized.fetch("https://api.trakt.tv/a", { method: "GET" });
    clock = 10_000; // past the 5s Retry-After but still inside the 60s floor
    await authorized.fetch("https://api.trakt.tv/b", { method: "GET" });

    // A short Retry-After must not shorten the floor and let a second exchange fire.
    expect(refresh.calls()).toBe(1);
  });

  it("respects Retry-After on the refresh endpoint before allowing another attempt", async () => {
    let clock = 0;
    const refresh = stubRefresh(() =>
      HttpResponse.json({ error: "slow_down" }, { status: 429, headers: { "Retry-After": "30" } }),
    );
    const inner = vi.fn<FetchLike>(() => Promise.resolve(res401()));
    const { authorized, endSession } = build({ inner, now: () => clock });

    await authorized.fetch("https://api.trakt.tv/a", { method: "GET" });
    clock = 20_000; // still inside the 30s Retry-After window
    await authorized.fetch("https://api.trakt.tv/b", { method: "GET" });

    expect(refresh.calls()).toBe(1);
    expect(endSession).not.toHaveBeenCalled();
  });
});
