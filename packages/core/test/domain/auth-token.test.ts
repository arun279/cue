import { isTokenExpired, shouldRefresh, TokenRefresher } from "@cue/core/domain/auth/token";
import type { Token } from "@cue/core/domain/model/token";
import { describe, expect, it, vi } from "vitest";

const CREATED_AT = 1_700_000_000; // unix seconds
const EXPIRES_IN = 7776000; // ~90 days
const EXPIRY_MS = (CREATED_AT + EXPIRES_IN) * 1000;

function token(overrides: Partial<Token> = {}): Token {
  return {
    access_token: "at",
    refresh_token: "rt",
    created_at: CREATED_AT,
    expires_in: EXPIRES_IN,
    ...overrides,
  };
}

describe("isTokenExpired", () => {
  it("is false before expiry and true at/after it", () => {
    expect(isTokenExpired(token(), EXPIRY_MS - 1)).toBe(false);
    expect(isTokenExpired(token(), EXPIRY_MS)).toBe(true);
    expect(isTokenExpired(token(), EXPIRY_MS + 1)).toBe(true);
  });
});

describe("shouldRefresh (lazy)", () => {
  it("refreshes on a 401 even when unexpired", () => {
    expect(shouldRefresh(token(), EXPIRY_MS - 1000, "unauthorized")).toBe(true);
  });
  it("does not refresh an unexpired token on a routine expiry check", () => {
    expect(shouldRefresh(token(), EXPIRY_MS - 1000, "expiry-check")).toBe(false);
  });
  it("refreshes an expired token on an expiry check", () => {
    expect(shouldRefresh(token(), EXPIRY_MS, "expiry-check")).toBe(true);
  });
  it("never refreshes without a refresh token", () => {
    expect(shouldRefresh(token({ refresh_token: "" }), EXPIRY_MS, "unauthorized")).toBe(false);
  });
});

describe("TokenRefresher (single-flight)", () => {
  it("dedupes concurrent refreshes into one exchange and rotates the token", async () => {
    let resolve: ((t: Token) => void) | undefined;
    const rotated = token({ access_token: "at2", refresh_token: "rt2" });
    const perform = vi.fn(
      (_refreshToken: string) =>
        new Promise<Token>((res) => {
          resolve = res;
        }),
    );
    const refresher = new TokenRefresher(perform);

    const a = refresher.refresh(token());
    const b = refresher.refresh(token());
    expect(perform).toHaveBeenCalledTimes(1);
    expect(perform).toHaveBeenCalledWith("rt");

    resolve?.(rotated);
    await expect(a).resolves.toBe(rotated);
    await expect(b).resolves.toBe(rotated);
  });

  it("performs again after the previous refresh settles", async () => {
    const perform = vi.fn((_refreshToken: string) => Promise.resolve(token()));
    const refresher = new TokenRefresher(perform);
    await refresher.refresh(token());
    await refresher.refresh(token());
    expect(perform).toHaveBeenCalledTimes(2);
  });
});
