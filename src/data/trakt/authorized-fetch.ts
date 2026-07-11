import { shouldRefresh, TokenRefresher } from "@domain/auth/token";
import type { Token } from "@domain/model/token";
import { type OAuthConfig, refreshAccessToken, TokenRefreshError } from "../auth/oauth";
import type { FetchLike } from "./client";

/**
 * A Trakt access token is valid for ~7 days, so a *legitimate* refresh happens at
 * most about weekly (lazily, on the first call past expiry: never on a timer).
 * The throttle exists only to collapse a stale-session burst: one screen's read
 * fan-out all 401ing at once: into a single `/oauth/token` call rather than one
 * per request. 60s comfortably covers a navigation's async fan-out plus
 * interactive tapping while sitting ~4 orders of magnitude below the token
 * lifetime, so it can never block a refresh the app actually needs. A
 * `Retry-After` on the endpoint overrides it upward.
 */
const DEFAULT_REFRESH_THROTTLE_MS = 60_000;

export interface AuthorizedFetchDeps {
  /** The underlying transport (real `fetch`) every request is proxied through. */
  readonly inner: FetchLike;
  /** The session token at boot; the wrapper owns it from here and rotates it in place. */
  readonly token: Token;
  /** `clientId` + `redirectUri` for the PKCE refresh grant (no client secret). */
  readonly config: OAuthConfig;
  /** Persist a rotated token so it survives reload (the token store). */
  readonly persist: (token: Token) => Promise<void>;
  /** Tear down the session when the refresh token is dead → app routes to onboarding. */
  readonly endSession: () => Promise<void>;
  readonly now?: () => number;
  readonly throttleMs?: number;
}

export interface AuthorizedFetch {
  /** The authenticated transport to hand the Trakt client as its `fetch`. */
  readonly fetch: FetchLike;
  /** The live access token, so the client's `getToken` follows a rotation. */
  accessToken(): string;
}

type RefreshOutcome = "refreshed" | "throttled" | "cleared" | "failed";

/**
 * The one authenticated-request wrapper the runtime Trakt transport runs on.
 * It (a) refreshes proactively before a call when the token
 * is past expiry, (b) refreshes-then-retries a read that still 401s, (c)
 * persists a rotated token before publishing it, (d) ends the session only on a
 * dead refresh token (`invalid_grant`), and (e) honors a refresh throttle +
 * `Retry-After` (upward only) and never blind re-POSTs a mutating write: a
 * write that 401s is surfaced as a throw so the durable write-queue reconciles
 * it (rolled back only when the session is truly dead; a transient refresh
 * failure keeps it queued). Concurrent 401s share ONE refresh via the
 * single-flight `TokenRefresher`.
 */
export function createAuthorizedFetch(deps: AuthorizedFetchDeps): AuthorizedFetch {
  const now = deps.now ?? Date.now;
  const throttleMs = deps.throttleMs ?? DEFAULT_REFRESH_THROTTLE_MS;
  let current = deps.token;
  let nextRefreshAllowedAt = 0;

  // Single-flight: a burst of concurrent 401s collapses to one `/oauth/token`
  // exchange. The perform rotates + persists the token exactly once per refresh.
  // Persist BEFORE publishing to `current`: a persist failure must not leave the
  // runtime running on a token that a reload can't recover (it would fall back to
  // the stale stored token). A failed persist rejects the refresh → back off.
  // TODO(multi-tab): the single-flight lock is per-instance; two tabs can still
  // race one `/oauth/token` exchange (Trakt rotates the refresh token, so the
  // loser gets `invalid_grant`). A cross-tab lock + token-store re-read would
  // close it; out of scope for the single-instance stampede this wrapper guards.
  const refresher = new TokenRefresher(async (refreshToken) => {
    const next = await refreshAccessToken(deps.config, refreshToken);
    await deps.persist(next);
    current = next;
    return next;
  });

  async function refresh(): Promise<RefreshOutcome> {
    if (now() < nextRefreshAllowedAt) return "throttled";
    try {
      await refresher.refresh(current);
      nextRefreshAllowedAt = now() + throttleMs;
      return "refreshed";
    } catch (error) {
      // `Retry-After` only ever extends the throttle floor upward: a short
      // Retry-After must never shorten the 60s single-flight floor.
      const backoff = error instanceof TokenRefreshError ? error.retryAfterMs : null;
      nextRefreshAllowedAt = now() + Math.max(throttleMs, backoff ?? 0);
      if (isDeadRefreshToken(error)) {
        await deps.endSession();
        return "cleared";
      }
      return "failed";
    }
  }

  function authorize(init: RequestInit | undefined): RequestInit {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${current.access_token}`);
    return { ...init, headers };
  }

  const fetch: FetchLike = async (input, init) => {
    const isWrite = isMutating(init?.method);
    let sessionEnded = false;

    if (shouldRefresh(current, now(), "expiry-check")) {
      if ((await refresh()) === "cleared") sessionEnded = true;
    }
    // The proactive refresh found the refresh token dead and tore the session
    // down. Don't send a doomed request with the stale bearer: a 401 is the
    // honest result for a read and the roll-back trigger for a write.
    if (sessionEnded) return unauthorized();

    const sentToken = current.access_token;
    const response = await deps.inner(input, authorize(init));
    if (response.status !== 401) return response;

    // The bearer we sent was rejected. Refresh (single-flight: shared with any
    // concurrent 401) then check whether the token actually rotated: our own
    // refresh, OR one a sibling request already landed while ours was in flight.
    // Keying the retry on rotation (not this caller's outcome) means a 401 that
    // arrives just after a sibling refreshed still retries instead of being
    // wrongly throttled.
    if ((await refresh()) === "cleared") sessionEnded = true;
    const rotated = current.access_token !== sentToken;

    if (isWrite) {
      // Never a blind re-POST. A dead session rolls the optimistic write back
      // (the queue classifies the returned 401 as a definite failure). Otherwise
      // throw so the durable write-queue reconciles then re-dispatches: with the
      // rotated token when we have one, or, after a transient refresh failure
      // (429/5xx/offline), once refresh recovers on a later flush. A transient
      // hiccup must keep the user's write queued, never roll it back.
      if (!rotated && sessionEnded) return response;
      throw new UnauthorizedWriteError();
    }
    // Idempotent read: retry once with the rotated token; with no rotation the
    // original 401 (session possibly ended) is the honest result.
    return rotated ? deps.inner(input, authorize(init)) : response;
  };

  return { fetch, accessToken: () => current.access_token };
}

/** Non-idempotent methods must never be blind-retried; only GET/HEAD may. */
function isMutating(method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  return m !== "GET" && m !== "HEAD";
}

/** A synthetic 401 for a request short-circuited after the session was torn down. */
function unauthorized(): Response {
  return new Response(null, { status: 401 });
}

/** Thrown to route a 401'd write back through the write-queue's reconcile path. */
export class UnauthorizedWriteError extends Error {
  constructor() {
    super("Unauthorized write deferred to the write-queue reconcile.");
    this.name = "UnauthorizedWriteError";
  }
}

/**
 * The refresh token is dead only when Trakt says so explicitly: an `invalid_grant`
 * on `/oauth/token`. Any other 400/401 (`invalid_request`/`invalid_client`, a
 * redirect-URI/config bug, a malformed body) is our fault, not a dead token:
 * keep the session so a code bug never signs a valid user out.
 */
function isDeadRefreshToken(error: unknown): boolean {
  return error instanceof TokenRefreshError && error.code === "invalid_grant";
}
