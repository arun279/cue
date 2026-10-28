import type { Token } from "../model/token";

export function isTokenExpired(token: Token, now: number): boolean {
  return now >= (token.created_at + token.expires_in) * 1000;
}

export type RefreshTrigger = "expiry-check" | "unauthorized";

export function shouldRefresh(token: Token, now: number, trigger: RefreshTrigger): boolean {
  if (token.refresh_token.length === 0) return false;
  return trigger === "unauthorized" || isTokenExpired(token, now);
}

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
