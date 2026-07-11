import type { Token } from "../model/token";

/** Past `created_at + expires_in` (both unix seconds; `now` is epoch ms). */
export function isTokenExpired(token: Token, now: number): boolean {
  return now >= (token.created_at + token.expires_in) * 1000;
}

export type RefreshTrigger = "expiry-check" | "unauthorized";

/**
 * Lazy-refresh decision: refresh only when a call 401s or the stored token
 * is already past expiry: never on a timer, and never without a refresh token.
 */
export function shouldRefresh(token: Token, now: number, trigger: RefreshTrigger): boolean {
  if (token.refresh_token.length === 0) return false;
  return trigger === "unauthorized" || isTokenExpired(token, now);
}

/**
 * Single-flight refresh: concurrent callers share one in-flight refresh so a
 * burst of 401s triggers exactly one `/oauth/token` call. The injected
 * `perform` does the actual network exchange and returns the rotated
 * token; this state machine is pure.
 */
export class TokenRefresher {
  private inFlight: Promise<Token> | null = null;
  private readonly perform: (refreshToken: string) => Promise<Token>;

  constructor(perform: (refreshToken: string) => Promise<Token>) {
    this.perform = perform;
  }

  refresh(current: Token): Promise<Token> {
    if (this.inFlight !== null) return this.inFlight;
    const run = async (): Promise<Token> => {
      try {
        return await this.perform(current.refresh_token);
      } finally {
        this.inFlight = null;
      }
    };
    this.inFlight = run();
    return this.inFlight;
  }
}
