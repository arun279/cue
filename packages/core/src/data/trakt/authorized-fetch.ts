import { shouldRefresh, TokenRefresher } from "../../domain/auth/token";
import type { Token } from "../../domain/model/token";
import { type OAuthConfig, refreshAccessToken, TokenRefreshError } from "../auth/oauth";
import type { FetchLike } from "./client";

/**
 * A Trakt access token lives about seven days, so a legitimate refresh happens
 * at most weekly. This throttle exists only to collapse a stale-session burst,
 * one screen's read fan-out all 401ing at once, into a single `/oauth/token`
 * call; a `Retry-After` on that endpoint overrides it upward.
 */
const DEFAULT_REFRESH_THROTTLE_MS = 60_000;

export interface AuthorizedFetchDeps {
  readonly inner: FetchLike;
  readonly token: Token;
  readonly config: OAuthConfig;
  readonly persist: (token: Token) => Promise<void>;
  readonly endSession: () => Promise<void>;
  readonly now?: () => number;
  readonly throttleMs?: number;
}

export interface AuthorizedFetch {
  readonly fetch: FetchLike;
  accessToken(): string;
}

type RefreshOutcome = "refreshed" | "throttled" | "cleared" | "failed";

export function createAuthorizedFetch(deps: AuthorizedFetchDeps): AuthorizedFetch {
  const now = deps.now ?? Date.now;
  const throttleMs = deps.throttleMs ?? DEFAULT_REFRESH_THROTTLE_MS;
  let current = deps.token;
  let nextRefreshAllowedAt = 0;

  // Persist before publishing to `current`: a persist failure must not leave the
  // runtime on a token a reload cannot recover, so the failure rejects the
  // refresh instead.
  //
  // TODO(multi-tab): the single-flight lock is per-instance, so two tabs can
  // still race one `/oauth/token` exchange and the loser gets `invalid_grant`.
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

  /**
   * Idempotent, so retry once, keyed on whether the token actually rotated
   * rather than on this caller's own refresh outcome: a 401 that arrives just
   * after a sibling refreshed still retries instead of being wrongly throttled.
   */
  async function retryUnauthorizedRead(
    input: string,
    init: RequestInit | undefined,
    response: Response,
    sentToken: string,
  ): Promise<Response> {
    await refresh();
    return current.access_token === sentToken ? response : deps.inner(input, authorize(init));
  }

  /**
   * Never a blind re-POST. Only a dead session returns the 401, which the queue
   * classifies as a definite failure and rolls the optimistic write back;
   * anything else throws so the write stays queued and is re-dispatched once
   * refresh recovers, because a transient hiccup must not lose the user's write.
   */
  async function deferUnauthorizedWrite(response: Response, sentToken: string): Promise<Response> {
    const sessionEnded = (await refresh()) === "cleared";
    if (current.access_token === sentToken && sessionEnded) return response;
    throw new UnauthorizedWriteError();
  }

  const fetch: FetchLike = async (input, init) => {
    // A proactive refresh that found the token dead has torn the session down:
    // don't send a doomed request with the stale bearer.
    if (shouldRefresh(current, now(), "expiry-check") && (await refresh()) === "cleared") {
      return unauthorized();
    }

    const sentToken = current.access_token;
    const response = await deps.inner(input, authorize(init));
    if (response.status !== 401) return response;
    return isMutating(init?.method)
      ? deferUnauthorizedWrite(response, sentToken)
      : retryUnauthorizedRead(input, init, response, sentToken);
  };

  return { fetch, accessToken: () => current.access_token };
}

function isMutating(method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  return m !== "GET" && m !== "HEAD";
}

function unauthorized(): Response {
  return new Response(null, { status: 401 });
}

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
