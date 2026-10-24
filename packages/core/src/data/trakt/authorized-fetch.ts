import { shouldRefresh, TokenRefresher } from "../../domain/auth/token";
import type { Token } from "../../domain/model/token";
import { type OAuthConfig, refreshAccessToken, TokenRefreshError } from "../auth/oauth";
import type { FetchLike } from "./client";

const DEFAULT_REFRESH_THROTTLE_MS = 60_000;

export interface AuthorizedFetchDeps {
  readonly inner: FetchLike;
  readonly token: Token;
  readonly config: OAuthConfig;
  readonly persist: (token: Token) => void;
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
  let lastRefreshError: unknown = null;
  let ending: Promise<void> | null = null;

  const refresher = new TokenRefresher(async (refreshToken) => {
    const next = await refreshAccessToken(deps.config, refreshToken);
    current = next;
    deps.persist(next);
    return next;
  });

  async function refresh(): Promise<RefreshOutcome> {
    if (ending !== null) {
      await ending;
      return "cleared";
    }
    if (now() < nextRefreshAllowedAt) return lastRefreshError === null ? "throttled" : "failed";
    try {
      await refresher.refresh(current);
      nextRefreshAllowedAt = now() + throttleMs;
      lastRefreshError = null;
      return "refreshed";
    } catch (error) {
      return refreshFailed(error);
    }
  }

  async function refreshFailed(error: unknown): Promise<RefreshOutcome> {
    const backoff = error instanceof TokenRefreshError ? error.retryAfterMs : null;
    nextRefreshAllowedAt = now() + Math.max(throttleMs, backoff ?? 0);
    if (!isDeadRefreshToken(error)) {
      lastRefreshError = error;
      return "failed";
    }
    ending ??= deps.endSession();
    await ending;
    return "cleared";
  }

  function authorize(init: RequestInit | undefined): RequestInit {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${current.access_token}`);
    return { ...init, headers };
  }

  async function retryUnauthorizedRead(
    input: string,
    init: RequestInit | undefined,
    response: Response,
    sentToken: string,
  ): Promise<Response> {
    const outcome = await refresh();
    if (current.access_token !== sentToken) return deps.inner(input, authorize(init));
    return outcome === "failed" ? unrenewed(lastRefreshError, response) : response;
  }

  async function deferUnauthorizedWrite(response: Response, sentToken: string): Promise<Response> {
    const sessionEnded = (await refresh()) === "cleared";
    if (current.access_token === sentToken && sessionEnded) return response;
    throw new UnauthorizedWriteError();
  }

  const fetch: FetchLike = async (input, init) => {
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

// A refresh that failed in transit or on Trakt's side leaves the session intact, so the read
// fails the way the refresh did rather than as a 401 that asks the user to reconnect.
function unrenewed(error: unknown, response: Response): Response {
  if (!(error instanceof TokenRefreshError)) throw error;
  return error.status === 429 || error.status >= 500
    ? new Response(null, { status: error.status })
    : response;
}

export class UnauthorizedWriteError extends Error {
  constructor() {
    super("Unauthorized write deferred to the write-queue reconcile.");
    this.name = "UnauthorizedWriteError";
  }
}

function isDeadRefreshToken(error: unknown): boolean {
  return error instanceof TokenRefreshError && error.code === "invalid_grant";
}
