import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AuthDeps, createAuthStore } from "@/core/auth/create-auth-store";
import type { AuthStore } from "@/core/auth/store";
import { pollDeviceToken, requestDeviceCode, revokeToken } from "@/core/data/auth/oauth";
import { createPkcePair } from "@/core/data/auth/pkce";
import { createTokenStore, type TokenStore } from "@/core/ports/token-store";
import { memoryKeyValueStore } from "../support/stores";

vi.mock("@/core/data/auth/oauth", () => ({
  pollDeviceToken: vi.fn(),
  requestDeviceCode: vi.fn(),
  revokeToken: vi.fn(),
}));
vi.mock("@/core/data/auth/pkce", () => ({ createPkcePair: vi.fn() }));

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
    traktBaseUrl: undefined,
    clearAccount: () => Promise.resolve(),
  };
}

async function connectedSession() {
  const token = {
    access_token: "access",
    refresh_token: "refresh",
    created_at: 1_700_000_000,
    expires_in: 604_800,
  };
  const tokens = createTokenStore(memoryKeyValueStore());
  await tokens.write(token);
  const store = createAuthStore(authDeps(tokens));
  await vi.waitFor(() => expect(store.getState().phase).toBe("connected"));
  return { token, tokens, store };
}

const NEXT = {
  access_token: "next-access",
  refresh_token: "next-refresh",
  created_at: 1_700_100_000,
  expires_in: 604_800,
};

/** Another account approves a device code, with no poll interval to wait out. */
async function connectNext(store: AuthStore): Promise<void> {
  vi.mocked(createPkcePair).mockResolvedValue({ verifier: "verifier", challenge: "challenge" });
  vi.mocked(requestDeviceCode).mockResolvedValue({
    deviceCode: "next-device",
    userCode: "NEXT",
    verificationUrl: "https://trakt.test/activate",
    intervalMs: 0,
    expiresInMs: 60_000,
  });
  vi.mocked(pollDeviceToken).mockResolvedValue({ status: "success", token: NEXT });
  await store.getState().connectWithDeviceCode();
}

/** Revokes that wait until the test answers them; each entry answers one. */
function heldRevokes(): (() => void)[] {
  const revokes: (() => void)[] = [];
  vi.mocked(revokeToken).mockImplementation(
    () => new Promise<void>((resolve) => revokes.push(resolve)),
  );
  return revokes;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("leaving a session", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("revokes and forgets the token on sign-out, even when the revoke fails", async () => {
    const { token, tokens, store } = await connectedSession();
    vi.mocked(revokeToken).mockRejectedValue(new Error("offline"));
    await store.getState().disconnect();
    expect(revokeToken).toHaveBeenCalledWith(expect.anything(), token.access_token);
    expect(await tokens.read()).toBeNull();
    expect(store.getState().phase).toBe("onboarding");
  });

  it("forgets a dead session's token without revoking it", async () => {
    const { tokens, store } = await connectedSession();
    store.getState().endSession();
    expect(revokeToken).not.toHaveBeenCalled();
    expect(await tokens.read()).toBeNull();
    expect(store.getState().phase).toBe("onboarding");
  });

  it.each([
    "first",
    "second",
  ] as const)("signs out once, and leaves the next session alone, when the %s sign-out's revoke finishes first", async (which) => {
    const { tokens, store } = await connectedSession();
    const revokes = heldRevokes();
    const signOuts = [store.getState().disconnect(), store.getState().disconnect()];
    await settle();
    const [finishing, ...late] = which === "first" ? revokes : [...revokes].reverse();
    finishing?.();
    await vi.waitFor(() => expect(store.getState().phase).toBe("onboarding"));
    await connectNext(store);
    for (const revoke of late) revoke();
    await Promise.all(signOuts);

    expect(store.getState().phase).toBe("connected");
    expect(await tokens.read()).toEqual(NEXT);
    expect(revokeToken).toHaveBeenCalledTimes(1);
  });

  it("leaves the next session alone when a sign-out finishes after its session already ended", async () => {
    const { tokens, store } = await connectedSession();
    const revokes = heldRevokes();
    const signingOut = store.getState().disconnect();
    await settle();
    store.getState().endSession();
    await connectNext(store);
    for (const revoke of revokes) revoke();
    await signingOut;

    expect(store.getState().phase).toBe("connected");
    expect(await tokens.read()).toEqual(NEXT);
  });
});

describe("starting a session", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("clears what the last account left on the device before saving the new token", async () => {
    const tokens = createTokenStore(memoryKeyValueStore());
    let tokenWhileClearing: unknown = "never cleared";
    const store = createAuthStore({
      ...authDeps(tokens),
      clearAccount: async () => {
        tokenWhileClearing = await tokens.read();
      },
    });
    await vi.waitFor(() => expect(store.getState().phase).toBe("onboarding"));

    await connectNext(store);

    expect(tokenWhileClearing).toBeNull();
    expect(store.getState().phase).toBe("connected");
    expect(await tokens.read()).toEqual(NEXT);
  });

  it("stays signed out, and says why, when the last account's data cannot be cleared", async () => {
    const tokens = createTokenStore(memoryKeyValueStore());
    const store = createAuthStore({
      ...authDeps(tokens),
      clearAccount: () => Promise.reject(new Error("storage busy")),
    });
    await vi.waitFor(() => expect(store.getState().phase).toBe("onboarding"));

    await connectNext(store);

    expect(store.getState()).toMatchObject({ phase: "onboarding", connectStatus: "error" });
    expect(store.getState().errorMessage).toEqual(expect.any(String));
    expect(await tokens.read()).toBeNull();
  });
});

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
      expiresInMs: 3_000,
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

  it("connects as soon as Trakt approves, while the Keychain is still saving the token", async () => {
    const token = {
      access_token: "access",
      refresh_token: "refresh",
      created_at: 1_700_000_000,
      expires_in: 604_800,
    };
    const tokens = createTokenStore({
      ...memoryKeyValueStore(),
      write: () => new Promise(() => {}),
    });
    vi.mocked(pollDeviceToken).mockResolvedValue({ status: "success", token });
    const store = createAuthStore(authDeps(tokens));

    const connecting = store.getState().connectWithDeviceCode();
    await vi.advanceTimersByTimeAsync(1_000);
    await connecting;

    expect(store.getState().phase).toBe("connected");
    expect(await tokens.read()).toEqual(token);
  });

  it("keeps the code and keeps polling when a poll throws", async () => {
    vi.mocked(pollDeviceToken)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValue({ status: "pending" });
    const store = createAuthStore(authDeps(createTokenStore(memoryKeyValueStore())));

    const connecting = store.getState().connectWithDeviceCode();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.getState()).toMatchObject({
      connectStatus: "connecting",
      deviceCode: { userCode: "ABCD" },
      errorMessage: null,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pollDeviceToken).toHaveBeenCalledTimes(2);
    store.getState().cancelConnect();
    await vi.advanceTimersByTimeAsync(1_000);
    await connecting;
  });

  it("says Trakt is unreachable when no device code can be requested", async () => {
    vi.mocked(requestDeviceCode).mockRejectedValue(new Error("network unavailable"));
    const store = createAuthStore(authDeps(createTokenStore(memoryKeyValueStore())));

    await store.getState().connectWithDeviceCode();

    expect(store.getState()).toMatchObject({
      connectStatus: "error",
      deviceCode: null,
      errorMessage: "Couldn't reach Trakt. Check your connection and try again.",
    });
  });

  it("stays on the connect screen when a cancelled attempt's request settles", async () => {
    let settle: (outcome: "code" | "failure") => void = () => {};
    vi.mocked(requestDeviceCode).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          settle = (outcome) =>
            outcome === "failure"
              ? reject(new Error("network unavailable"))
              : resolve({
                  deviceCode: "device-code",
                  userCode: "ABCD",
                  verificationUrl: "https://trakt.test/activate",
                  intervalMs: 1_000,
                  expiresInMs: 3_000,
                });
        }),
    );
    const store = createAuthStore(authDeps(createTokenStore(memoryKeyValueStore())));

    for (const outcome of ["code", "failure"] as const) {
      const connecting = store.getState().connectWithDeviceCode();
      await vi.advanceTimersByTimeAsync(0);
      store.getState().cancelConnect();
      settle(outcome);
      await connecting;
      expect(store.getState()).toMatchObject({
        connectStatus: "idle",
        deviceCode: null,
        errorMessage: null,
      });
    }
    expect(pollDeviceToken).not.toHaveBeenCalled();
  });

  it("clears the displayed code once polls fail until it expires so connection can be retried", async () => {
    vi.mocked(pollDeviceToken).mockRejectedValue(new Error("network unavailable"));
    const store = createAuthStore(authDeps(createTokenStore(memoryKeyValueStore())));

    const connecting = store.getState().connectWithDeviceCode();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().deviceCode?.userCode).toBe("ABCD");
    await vi.advanceTimersByTimeAsync(3_000);
    await connecting;

    expect(store.getState()).toMatchObject({
      phase: "onboarding",
      connectStatus: "error",
      deviceCode: null,
      errorMessage: "That code expired before it was approved. Start again to get a new one.",
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
