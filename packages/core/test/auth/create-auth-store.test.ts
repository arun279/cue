import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AuthDeps, createAuthStore } from "../../src/auth/create-auth-store";
import { pollDeviceToken, requestDeviceCode } from "../../src/data/auth/oauth";
import { createPkcePair } from "../../src/data/auth/pkce";
import { createTokenStore, type TokenStore } from "../../src/ports/token-store";
import { memoryKeyValueStore } from "../support/stores";

vi.mock("../../src/data/auth/oauth", () => ({
  buildAuthorizeUrl: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  pollDeviceToken: vi.fn(),
  requestDeviceCode: vi.fn(),
  revokeToken: vi.fn(),
}));
vi.mock("../../src/data/auth/pkce", () => ({ createPkcePair: vi.fn() }));

function authDeps(tokenStore: TokenStore): AuthDeps {
  return {
    crypto: {
      newId: () => "auth-state",
      randomBytes: (length) => new Uint8Array(length),
      digest: async (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest()),
    },
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

describe("device authorization polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(createPkcePair).mockResolvedValue({ verifier: "verifier", challenge: "challenge" });
    vi.mocked(requestDeviceCode).mockResolvedValue({
      deviceCode: "device-code",
      userCode: "ABCD",
      verificationUrl: "https://trakt.test/activate",
      intervalMs: 1_000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("waits through pending and slow-down responses before persisting a successful token", async () => {
    const token = {
      access_token: "access",
      refresh_token: "refresh",
      created_at: 1_700_000_000,
      expires_in: 604_800,
    };
    const tokenStore = {
      read: vi.fn(() => Promise.resolve(null)),
      write: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve()),
    };
    vi.mocked(pollDeviceToken)
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "slow-down" })
      .mockResolvedValueOnce({ status: "success", token });
    const store = createAuthStore(authDeps(tokenStore));

    const connecting = store.getState().connectWithDeviceCode();
    await vi.advanceTimersByTimeAsync(4_000);
    await connecting;

    expect(pollDeviceToken).toHaveBeenCalledTimes(3);
    expect(tokenStore.write).toHaveBeenCalledWith(token);
    expect(store.getState()).toMatchObject({
      phase: "connected",
      connectStatus: "success",
      errorMessage: null,
      deviceCode: null,
    });
  });

  const terminalCases = [
    ["denied", "You declined the request in Trakt. Try again when you're ready."],
    ["expired", "That code expired before it was approved. Start again to get a new one."],
    ["error", "Trakt could not authorize this device. Try again."],
  ] satisfies readonly (readonly ["denied" | "expired" | "error", string])[];

  it.each(terminalCases)("surfaces the %s terminal response", async (status, errorMessage) => {
    vi.mocked(pollDeviceToken).mockResolvedValue(
      status === "error" ? { status, code: 500 } : { status },
    );
    const store = createAuthStore(authDeps(createTokenStore(memoryKeyValueStore())));

    const connecting = store.getState().connectWithDeviceCode();
    await vi.advanceTimersByTimeAsync(1_000);
    await connecting;

    expect(store.getState()).toMatchObject({ connectStatus: "error", errorMessage });
  });
});
