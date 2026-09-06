import { describe, expect, it, vi } from "vitest";
import { type AuthDeps, createAuthStore } from "../../src/auth/create-auth-store";
import { createTokenStore, type TokenStore } from "../../src/ports/token-store";
import { memoryKeyValueStore } from "../support/stores";

function authDeps(tokenStore: TokenStore): AuthDeps {
  return {
    tokenStore,
    clientId: "a-public-client-id",
    redirectUri: "cue://auth/callback",
    redirect: () => {},
    redirectHandoff: { read: () => null, write: () => {}, clear: () => {} },
    native: true,
    traktBaseUrl: undefined,
  };
}

/**
 * The boot read, and the three answers a token store can give.
 *
 * "There is no token" and "I cannot tell you" are different answers, and the
 * second is the one with no phase of its own: unhandled it holds `loading` for
 * the rest of the launch, which every client draws as a wait with nothing on it
 * and no way off it. Reachable rather than theoretical: iOS refuses every
 * Keychain read from a build with no entitlement and every `WhenUnlocked` read
 * before a device is first unlocked, and a browser refuses `localStorage` to a
 * page whose site data is blocked.
 */
describe("the auth store's boot read", () => {
  it("connects when a token is stored", async () => {
    const store = createAuthStore(
      authDeps(
        createTokenStore(
          memoryKeyValueStore({
            "cue.trakt.token": JSON.stringify({
              access_token: "access",
              refresh_token: "refresh",
              created_at: 1_700_000_000,
              expires_in: 604_800,
            }),
          }),
        ),
      ),
    );

    await vi.waitFor(() => expect(store.getState().phase).toBe("connected"));
    expect(store.getState().errorMessage).toBeNull();
  });

  it("onboards without a message when the store answers that there is no token", async () => {
    const store = createAuthStore(authDeps(createTokenStore(memoryKeyValueStore())));

    await vi.waitFor(() => expect(store.getState().phase).toBe("onboarding"));
    expect(store.getState().errorMessage).toBeNull();
  });

  it("onboards with a message when the store will not answer at all", async () => {
    const store = createAuthStore(
      authDeps({
        read: () => Promise.reject(new Error("keychain unavailable")),
        write: () => Promise.resolve(),
        clear: () => Promise.resolve(),
      }),
    );

    await vi.waitFor(() => expect(store.getState().phase).toBe("onboarding"));
    expect(store.getState().errorMessage).toEqual(expect.any(String));
  });
});
