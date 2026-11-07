// @vitest-environment jsdom
/**
 * Sessions from sign-in to sign-out, through the app's own boot hook and auth
 * store against the Trakt fake: what a session leaves behind when it ends, and
 * what an ended session can still do to the one after it.
 */

import { createHash } from "node:crypto";
import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRuntimeBoot } from "@/core/app/boot";
import { createAuthStore } from "@/core/auth/create-auth-store";
import type { Token } from "@/core/domain/model/token";
import { buildHideShowOp } from "@/core/domain/write-queue/ops";
import { INCIDENTS_KEY, OP_LOG_KEY, PLAY_POLICY_KEY } from "@/core/ports/storage-keys";
import { createTokenStore } from "@/core/ports/token-store";
import type { CueRuntime } from "@/core/runtime/runtime";
import { memoryKeyValueStore } from "../support/stores";
import { startTraktFake } from "../trakt-fake/in-process.ts";

const fake = startTraktFake();

afterEach(() => {
  vi.useRealTimers();
});

const DAY_S = 86_400;
const ACTIVITIES_KEY = "cue.last-activities";
const HIDDEN = /^\/users\/hidden\//;
const PENDING = Symbol("pending");

function live(overrides: Partial<Token> = {}): Token {
  const { access_token, refresh_token, created_at, expires_in } = fake.session();
  return { access_token, refresh_token, created_at, expires_in, ...overrides };
}
/** Past its 7 days, so the next request refreshes it first. */
const expired = (): Token => live({ created_at: live().created_at - 8 * DAY_S });
/** An access token Trakt still takes, with a refresh token it never issued. */
const doomed = (): Token => live({ refresh_token: "never-issued" });
/** Neither token is one Trakt knows. */
const dead = (): Token => live({ access_token: "stale-access", refresh_token: "never-issued" });

function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof PENDING> {
  return Promise.race([
    promise,
    new Promise<typeof PENDING>((resolve) => setTimeout(() => resolve(PENDING), ms)),
  ]);
}

const hideShow = (trakt: number) =>
  buildHideShowOp({
    opId: `hide-${trakt}`,
    ids: { trakt },
    inversePatch: { kind: "hidden", showId: trakt },
  });

/** A device: its Keychain, its bulk store and the auth store over them. */
async function install(token: Token, bulkSeed: Record<string, string> = {}) {
  const secure = memoryKeyValueStore();
  const bulk = memoryKeyValueStore(bulkSeed);
  const tokens = createTokenStore(secure);
  await tokens.write(token);
  const auth = createAuthStore({
    crypto: {
      newId: () => "auth-state",
      randomBytes: (length) => new Uint8Array(length),
      digest: async (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest()),
    },
    tokenStore: tokens,
    clientId: "test-client",
    redirectUri: "cue://auth/callback",
    traktBaseUrl: undefined,
  });
  await vi.waitFor(() => expect(auth.getState().phase).toBe("connected"));
  return { secure, bulk, tokens, auth };
}

type Device = Awaited<ReturnType<typeof install>>;

/** What a device-code approval does: a new token, and the app connected on it. */
async function connect(device: Device, token: Token): Promise<void> {
  await device.tokens.write(token);
  device.auth.setState({ phase: "connected" });
}

/** The app booting its runtime on the stored token, as RuntimeBoot does. */
function launch(device: Device) {
  const clearPersistedCaches = vi.fn(() => Promise.resolve());
  const clearLocalPreferences = vi.fn();
  const deps = {
    newId: () => "op",
    tokenStore: device.tokens,
    kv: device.bulk,
    redirectUri: "cue://auth/callback",
    clientId: "test-client",
    apiBaseUrl: undefined,
    endSession: device.auth.getState().endSession,
    clearPersistedCaches,
    clearLocalPreferences,
  };
  const hook = renderHook(() => useRuntimeBoot(deps));
  const runtime = (): Promise<CueRuntime> =>
    vi.waitFor(() => {
      const built = hook.result.current.runtime;
      if (built === null) throw new Error("still booting");
      return built;
    });
  return { hook, runtime, clearPersistedCaches, clearLocalPreferences };
}

/** The Sign out button. */
async function signOut(device: Device, runtime: CueRuntime): Promise<void> {
  await runtime.endLocalSession();
  await device.auth.getState().disconnect();
}

const sent = (method: string, path: RegExp) =>
  fake.requests.filter((request) => request.method === method && path.test(request.path));

it("ends a session whose refresh token is dead while a write is in flight, rather than hanging", async () => {
  const device = await install(dead());
  const app = launch(device);
  const runtime = await app.runtime();

  expect(await within(runtime.submit(hideShow(1)), 1500)).not.toBe(PENDING);

  await vi.waitFor(() => expect(device.auth.getState().phase).toBe("onboarding"));
  expect(await device.tokens.read()).toBeNull();
  expect(device.bulk.values.has(OP_LOG_KEY)).toBe(false);
  expect(app.clearPersistedCaches).toHaveBeenCalled();
  expect(
    await within(
      runtime.loadUserProfile().catch(() => "failed"),
      1500,
    ),
  ).not.toBe(PENDING);
});

it("clears the account when its session dies during sign-out, and never sends its writes for the next one", async () => {
  fake.drop({ method: "POST", path: HIDDEN, times: 2 });
  fake.fail({ method: "GET", path: HIDDEN }, 503);
  fake.fail({ method: "GET", path: HIDDEN }, 401);
  const device = await install(doomed());
  const first = launch(device);
  const runtime = await first.runtime();
  expect(await runtime.submit(hideShow(1))).toBe("deferred");

  await expect(signOut(device, runtime)).resolves.toBeUndefined();

  expect(device.auth.getState().phase).toBe("onboarding");
  expect(await device.tokens.read()).toBeNull();
  expect(device.bulk.values.has(OP_LOG_KEY)).toBe(false);
  expect(first.clearPersistedCaches).toHaveBeenCalled();
  expect(first.clearLocalPreferences).toHaveBeenCalled();

  first.hook.unmount();
  await connect(device, live());
  const posted = sent("POST", HIDDEN).length;
  const next = launch(device);
  await (await next.runtime()).flushWrites();
  expect(sent("POST", HIDDEN)).toHaveLength(posted);
});

it("gives the next session every read slot, whatever the last one left hanging", async () => {
  fake.hold({ method: "GET", path: /^\/shows\/\d+$/, times: 6 });
  const device = await install(live());
  const first = launch(device);
  const runtime = await first.runtime();
  const hanging = [1, 2, 3, 4, 5, 6].map((id) => runtime.loadShowInfo(id).catch(() => null));
  await vi.waitFor(() => expect(sent("GET", /^\/shows\/\d+$/)).toHaveLength(6));

  await signOut(device, runtime);
  first.hook.unmount();
  await connect(device, live());
  const next = await launch(device).runtime();

  expect(await within(next.loadUserProfile(), 1500)).not.toBe(PENDING);
  void hanging;
});

it("starts the next session with no rate-limit pause from the last one", async () => {
  fake.fail({ method: "GET", path: /^\/users\/settings$/ }, 429, 300);
  const device = await install(live());
  const first = launch(device);
  const runtime = await first.runtime();
  const limited = runtime.loadUserProfile().catch(() => null);
  await vi.waitFor(() => expect(runtime.readsPausedUntil()).toBeGreaterThan(Date.now()));

  await signOut(device, runtime);
  first.hook.unmount();
  await connect(device, live());
  const next = await launch(device).runtime();

  expect(next.readsPausedUntil()).toBeLessThanOrEqual(Date.now());
  expect(await within(next.loadUserProfile(), 1500)).not.toBe(PENDING);
  void limited;
});

it("clears the last account when the session dies while the app is still starting", async () => {
  const device = await install(dead(), {
    [OP_LOG_KEY]: JSON.stringify([hideShow(1)]),
    [ACTIVITIES_KEY]: "{}",
    [INCIDENTS_KEY]: "[]",
    [PLAY_POLICY_KEY]: JSON.stringify("multiple"),
  });
  const app = launch(device);

  await vi.waitFor(() => expect(device.auth.getState().phase).toBe("onboarding"));
  await vi.waitFor(() => expect(app.clearPersistedCaches).toHaveBeenCalled());
  expect(app.clearLocalPreferences).toHaveBeenCalled();
  expect(await device.tokens.read()).toBeNull();
  for (const key of [OP_LOG_KEY, ACTIVITIES_KEY, INCIDENTS_KEY, PLAY_POLICY_KEY]) {
    expect(device.bulk.values.has(key)).toBe(false);
  }
});

it("keeps a token refreshed after sign-out out of the Keychain", async () => {
  const release = fake.hold({ method: "POST", path: /^\/oauth\/token$/ });
  fake.drop({ method: "POST", path: /^\/oauth\/revoke$/ });
  const device = await install(expired());
  const runtime = await launch(device).runtime();
  const reading = runtime.loadUserProfile().catch(() => null);
  await vi.waitFor(() => expect(sent("POST", /^\/oauth\/token$/)).toHaveLength(1));

  await signOut(device, runtime);
  release();
  await reading;

  expect(await device.tokens.read()).toBeNull();
  expect(await createTokenStore(device.secure).read()).toBeNull();
});

it("leaves the next session alone when the last one's refresh comes back refused", async () => {
  const release = fake.hold({ method: "POST", path: /^\/oauth\/token$/ });
  const device = await install(expired());
  const first = launch(device);
  const runtime = await first.runtime();
  const reading = runtime.loadUserProfile().catch(() => null);
  await vi.waitFor(() => expect(sent("POST", /^\/oauth\/token$/)).toHaveLength(1));
  await signOut(device, runtime);
  first.hook.unmount();
  const token = live();
  await connect(device, token);
  const next = launch(device);
  await next.runtime();

  release();
  await reading;

  expect(device.auth.getState().phase).toBe("connected");
  expect(await device.tokens.read()).toEqual(token);
  expect(next.clearPersistedCaches).not.toHaveBeenCalled();
});

it("gives up on a token refresh Trakt never answers", async () => {
  fake.hold({ method: "POST", path: /^\/oauth\/token$/ });
  const device = await install(expired());
  const runtime = await launch(device).runtime();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const settled = vi.fn();
  runtime.loadUserProfile().then(settled, settled);

  await vi.advanceTimersByTimeAsync(16_000);

  expect(settled).toHaveBeenCalled();
});

it("finishes signing out when Trakt never answers the revoke, and reads nothing more", async () => {
  fake.hold({ method: "POST", path: /^\/oauth\/revoke$/ });
  const device = await install(live());
  const runtime = await launch(device).runtime();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const signingOut = signOut(device, runtime);
  await vi.advanceTimersByTimeAsync(0);
  const before = fake.requests.length;
  const read = runtime.loadUserProfile().catch(() => "failed");

  await vi.advanceTimersByTimeAsync(16_000);

  await signingOut;
  expect(device.auth.getState().phase).toBe("onboarding");
  expect(await device.tokens.read()).toBeNull();
  expect(await read).toBe("failed");
  expect(fake.requests.slice(before).filter((r) => !r.path.startsWith("/oauth/"))).toEqual([]);
});

it("writes nothing back once its session has ended", async () => {
  fake.drop({ method: "POST", path: HIDDEN, times: 3 });
  fake.fail({ method: "GET", path: HIDDEN, times: 3 }, 503);
  fake.fail({ method: "GET", path: /^\/users\/settings$/ }, 401);
  const device = await install(doomed());
  const runtime = await launch(device).runtime();
  expect(await runtime.submit(hideShow(1))).toBe("deferred");

  await runtime.loadUserProfile().catch(() => null);
  await vi.waitFor(() => expect(device.auth.getState().phase).toBe("onboarding"));
  const ended = fake.requests.length;
  await runtime.flushWrites();

  expect(device.bulk.values.has(OP_LOG_KEY)).toBe(false);
  expect(fake.requests.slice(ended).filter((r) => r.method === "POST")).toEqual([]);
});
