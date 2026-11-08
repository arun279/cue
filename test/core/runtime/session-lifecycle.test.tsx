// @vitest-environment jsdom
/**
 * Sessions from sign-in to sign-out, through the app's own boot hook and auth
 * store against the Trakt fake: what a session leaves behind when it ends, and
 * what an ended session can still do to the one after it.
 */

import { createHash } from "node:crypto";
import type { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRuntimeBoot } from "@/core/app/boot";
import { createAuthStore } from "@/core/auth/create-auth-store";
import { queryKeys } from "@/core/data/query-keys";
import type { Token } from "@/core/domain/model/token";
import type { SeasonView } from "@/core/domain/show-detail";
import { buildMarkEpisodeOp, buildStopShowOp } from "@/core/domain/write-queue/ops";
import { useHideShow } from "@/core/hooks/useHideShow";
import { useMarkSeason } from "@/core/hooks/useMarkSeason";
import { useMoveToWatchlist } from "@/core/hooks/useMoveToWatchlist";
import type { KeyValueStore } from "@/core/ports/kv";
import { INCIDENTS_KEY, OP_LOG_KEY, PLAY_POLICY_KEY } from "@/core/ports/storage-keys";
import { createTokenStore } from "@/core/ports/token-store";
import { createPrefsStore } from "@/core/prefs/prefs-store";
import { clearAccount } from "@/core/runtime/create-runtime";
import { createQueryClient } from "@/core/runtime/query-cache";
import { type CueRuntime, forScreens } from "@/core/runtime/runtime";
import { usePlayPolicy } from "@/core/stores/play-policy-store";
import { useReadIncidents } from "@/core/stores/read-incidents-store";
import { showSnack, useSnackbar } from "@/core/stores/snackbar-store";
import { withRuntime } from "../support/runtime";
import {
  type MemoryKeyValueStore,
  memoryKeyValueStore,
  memoryPreferenceStorage,
} from "../support/stores";
import { startTraktFake } from "../trakt-fake/in-process.ts";

const fake = startTraktFake();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  buildStopShowOp("hidden", { opId: `hide-${trakt}`, ids: { trakt } });

/** What stays on a device between launches, and what the app clears along with an account. */
interface Storage {
  readonly secure: MemoryKeyValueStore;
  readonly bulk: KeyValueStore & Pick<MemoryKeyValueStore, "values">;
  readonly clearPersistedCaches: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly clearLocalPreferences: ReturnType<typeof vi.fn<() => void>>;
  readonly reminders: { readonly cancelAll: ReturnType<typeof vi.fn<() => Promise<void>>> };
}

/** The app starting on a device: a token store and the auth store over its storage. */
async function start(storage: Storage) {
  const tokens = createTokenStore(storage.secure);
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
    clearAccount: () => clearAccount({ ...storage, kv: storage.bulk }),
  });
  await vi.waitFor(() => expect(auth.getState().phase).not.toBe("loading"));
  return { ...storage, tokens, auth };
}

type Device = Awaited<ReturnType<typeof start>>;

/** A device signed in on `token`, whose bulk store may fail the first removal of one key. */
async function install(
  token: Token,
  {
    seed = {},
    failRemoval,
    clearLocalPreferences = () => undefined,
  }: {
    seed?: Record<string, string>;
    failRemoval?: string;
    clearLocalPreferences?: () => void;
  } = {},
): Promise<Device> {
  const secure = memoryKeyValueStore();
  const store = memoryKeyValueStore(seed);
  let failures = failRemoval === undefined ? 0 : 1;
  const bulk = {
    ...store,
    remove: (key: string) =>
      key === failRemoval && failures-- > 0
        ? Promise.reject(new Error("storage busy"))
        : store.remove(key),
  };
  await createTokenStore(secure).write(token);
  return start({
    secure,
    bulk,
    clearPersistedCaches: vi.fn(() => Promise.resolve()),
    clearLocalPreferences: vi.fn(clearLocalPreferences),
    reminders: { cancelAll: vi.fn(() => Promise.resolve()) },
  });
}

/** The person approves a device code on trakt.tv, as the onboarding screen asks. */
async function signIn(device: Device): Promise<void> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const connecting = device.auth.getState().connectWithDeviceCode();
  await vi.waitFor(() => expect(device.auth.getState().deviceCode).not.toBeNull());
  fake.approve();
  await vi.advanceTimersByTimeAsync(6_000);
  await connecting;
  vi.useRealTimers();
  expect(device.auth.getState().phase).toBe("connected");
}

/** The app booting its runtime on the stored token, as RuntimeBoot does. */
function launch(device: Device) {
  const deps = {
    newId: () => "op",
    tokenStore: device.tokens,
    kv: device.bulk,
    redirectUri: "cue://auth/callback",
    clientId: "test-client",
    apiBaseUrl: undefined,
    endSession: device.auth.getState().endSession,
    clearPersistedCaches: device.clearPersistedCaches,
    clearLocalPreferences: device.clearLocalPreferences,
    reminders: device.reminders,
  };
  const hook = renderHook(() => useRuntimeBoot(deps));
  const runtime = (): Promise<CueRuntime> =>
    vi.waitFor(() => {
      const built = hook.result.current.runtime;
      if (built === null) throw new Error("still booting");
      return built;
    });
  return { hook, runtime };
}

/**
 * React Native's fetch can resolve a response that completed just before its signal aborted.
 * The fake's own fetch never watches the signal, so it stands in for that.
 */
function answerAfterAbort(): void {
  vi.stubGlobal("fetch", fake.fetch);
}

/** Account A on a session Trakt is about to end, with its requests matching `held` held back. */
async function doomedSessionHolding(held: {
  readonly method: "GET" | "POST";
  readonly path: RegExp;
}) {
  answerAfterAbort();
  const release = fake.hold(held);
  fake.fail({ method: "GET", path: /^\/users\/settings$/ }, 401);
  const device = await install(doomed());
  const launched = launch(device);
  const runtime = await launched.runtime();
  return {
    runtime,
    /** Ends the session, signs the next account in and readies it, then lets Trakt answer. */
    async answerAfterNextSignIn(ready: (next: CueRuntime) => Promise<void> | void): Promise<void> {
      void runtime.loadUserProfile().catch(() => null);
      await vi.waitFor(() => expect(device.auth.getState().phase).toBe("onboarding"));
      launched.hook.unmount();
      await signIn(device);
      await ready(await launch(device).runtime());
      release();
      await vi.waitFor(() =>
        expect(sent(held.method, held.path).every((request) => request.bytes > 0)).toBe(true),
      );
      // Long enough for an answer that reached the runtime to reach the screens too.
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}

/**
 * The next account has its library on screen when Trakt answers the last session's write:
 * nothing from that session may offer an Undo or change the library.
 */
async function expectNextLibraryUntouched(
  session: Awaited<ReturnType<typeof doomedSessionHolding>>,
  queryClient: QueryClient,
): Promise<void> {
  let library: unknown;
  await session.answerAfterNextSignIn(async (next) => {
    await queryClient.fetchQuery({
      queryKey: queryKeys.library(),
      queryFn: () => next.loadUpNext(),
      staleTime: 0,
    });
    library = queryClient.getQueryData(queryKeys.library());
  });
  const actions = useSnackbar.getState().snack?.actions ?? [];
  expect(actions.map((action) => action.label)).not.toContain("Undo");
  expect(queryClient.getQueryData(queryKeys.library())).toBe(library);
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
  expect(device.clearPersistedCaches).toHaveBeenCalled();
  expect(
    await within(
      runtime.loadUserProfile().catch(() => "failed"),
      1500,
    ),
  ).not.toBe(PENDING);
});

it("clears the account when its session dies during sign-out, and never sends its writes for the next one", async () => {
  fake.drop({ method: "POST", path: HIDDEN });
  fake.fail({ method: "POST", path: HIDDEN }, 401);
  const device = await install(doomed());
  const first = launch(device);
  const runtime = await first.runtime();
  expect(await runtime.submit(hideShow(1))).toBe("deferred");

  await expect(signOut(device, runtime)).resolves.toBeUndefined();

  expect(device.auth.getState().phase).toBe("onboarding");
  expect(await device.tokens.read()).toBeNull();
  expect(device.bulk.values.has(OP_LOG_KEY)).toBe(false);
  expect(device.clearPersistedCaches).toHaveBeenCalled();
  expect(device.clearLocalPreferences).toHaveBeenCalled();

  first.hook.unmount();
  await signIn(device);
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
  await signIn(device);
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
  await signIn(device);
  const next = await launch(device).runtime();

  expect(next.readsPausedUntil()).toBeLessThanOrEqual(Date.now());
  expect(await within(next.loadUserProfile(), 1500)).not.toBe(PENDING);
  void limited;
});

it("clears the last account, and cancels its reminders, when the session dies while the app is still starting", async () => {
  const device = await install(dead(), {
    seed: {
      [OP_LOG_KEY]: JSON.stringify([hideShow(1)]),
      [ACTIVITIES_KEY]: "{}",
      [INCIDENTS_KEY]: "[]",
      [PLAY_POLICY_KEY]: JSON.stringify("multiple"),
    },
  });
  launch(device);

  await vi.waitFor(() => expect(device.auth.getState().phase).toBe("onboarding"));
  await vi.waitFor(() => expect(device.clearPersistedCaches).toHaveBeenCalled());
  expect(device.clearLocalPreferences).toHaveBeenCalled();
  expect(device.reminders.cancelAll).toHaveBeenCalled();
  expect(await device.tokens.read()).toBeNull();
  for (const key of [OP_LOG_KEY, ACTIVITIES_KEY, INCIDENTS_KEY, PLAY_POLICY_KEY]) {
    expect(device.bulk.values.has(key)).toBe(false);
  }
});

it("keeps a token refreshed after sign-out out of the Keychain", async () => {
  answerAfterAbort();
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
  answerAfterAbort();
  const release = fake.hold({ method: "POST", path: /^\/oauth\/token$/ });
  const device = await install(expired());
  const first = launch(device);
  const runtime = await first.runtime();
  const reading = runtime.loadUserProfile().catch(() => null);
  await vi.waitFor(() => expect(sent("POST", /^\/oauth\/token$/)).toHaveLength(1));
  await signOut(device, runtime);
  first.hook.unmount();
  await signIn(device);
  const token = await device.tokens.read();
  await launch(device).runtime();
  const clears = device.clearPersistedCaches.mock.calls.length;

  release();
  await reading;

  expect(device.auth.getState().phase).toBe("connected");
  expect(await device.tokens.read()).toEqual(token);
  expect(device.clearPersistedCaches).toHaveBeenCalledTimes(clears);
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

it.each([
  ["in the same launch", false],
  ["after a relaunch", true],
])("keeps an account whose data failed to clear away from the next account %s", async (_, relaunching) => {
  const installed = await install(dead(), {
    seed: { [OP_LOG_KEY]: JSON.stringify([hideShow(1)]) },
    failRemoval: OP_LOG_KEY,
  });
  const first = launch(installed);
  await vi.waitFor(() => expect(installed.auth.getState().phase).toBe("onboarding"));
  expect(installed.bulk.values.has(OP_LOG_KEY)).toBe(true);
  first.hook.unmount();
  const device = relaunching ? await start(installed) : installed;

  await signIn(device);
  const posted = sent("POST", HIDDEN).length;
  await (await launch(device).runtime()).flushWrites();

  expect(sent("POST", HIDDEN)).toHaveLength(posted);
  expect(device.bulk.values.get(OP_LOG_KEY)).toBe("[]");
});

it("keeps a write Trakt answers after its session ended from teaching the next session", async () => {
  answerAfterAbort();
  fake.reset({ multiplePlays: false });
  const release = fake.hold({ method: "POST", path: /^\/sync\/history$/ });
  fake.fail({ method: "GET", path: /^\/users\/settings$/ }, 401);
  const device = await install(doomed());
  const first = launch(device);
  const runtime = await first.runtime();
  const marking = runtime.submit(
    buildMarkEpisodeOp({ opId: "mark", ids: { trakt: 880100 }, watchedAt: "2026-10-14T12:34:00Z" }),
  );
  await vi.waitFor(() => expect(sent("POST", /^\/sync\/history$/)).toHaveLength(1));
  await runtime.loadUserProfile().catch(() => null);
  await vi.waitFor(() => expect(device.auth.getState().phase).toBe("onboarding"));
  first.hook.unmount();
  await signIn(device);
  await launch(device).runtime();

  release();
  await marking;

  expect(usePlayPolicy.getState().policy).toBe("unknown");
});

it("keeps a read Trakt answers after its session ended out of the next session's incidents", async () => {
  answerAfterAbort();
  const release = fake.hold({ method: "GET", path: /^\/shows\/999999$/ });
  const device = await install(live());
  const first = launch(device);
  const runtime = await first.runtime();
  const reading = runtime.loadShowInfo(999999).catch(() => null);
  await vi.waitFor(() => expect(sent("GET", /^\/shows\/999999$/)).toHaveLength(1));
  await signOut(device, runtime);
  first.hook.unmount();
  await signIn(device);
  await launch(device).runtime();

  release();
  await reading;

  expect(useReadIncidents.getState().incidents).toEqual([]);
});

it("keeps a read an ended session starts out of the next session's incidents", async () => {
  const device = await install(expired());
  const first = launch(device);
  const runtime = await first.runtime();
  await signOut(device, runtime);
  first.hook.unmount();
  await signIn(device);
  await launch(device).runtime();
  const before = fake.requests.length;

  await runtime.loadUserProfile().catch(() => null);

  expect(useReadIncidents.getState().incidents).toEqual([]);
  expect(fake.requests.slice(before)).toEqual([]);
});

it("keeps every preference changeable after a sign-in clears the last account's", async () => {
  const preferences = memoryPreferenceStorage();
  const prefs = createPrefsStore(preferences);
  const device = await install(live(), {
    clearLocalPreferences: () => prefs.getState().clearPreferences(),
  });
  const first = launch(device);
  await signOut(device, await first.runtime());
  first.hook.unmount();
  await signIn(device);

  prefs.getState().setRemindersEnabled(true);
  prefs.getState().setTheme("dark");

  expect(prefs.getState()).toMatchObject({ remindersEnabled: true, theme: "dark" });
});

it("offers the next session no Undo for a hide Trakt answers after its session ended", async () => {
  const hide = /^\/users\/hidden\/progress_watched$/;
  const session = await doomedSessionHolding({ method: "POST", path: hide });
  const queryClient = createQueryClient();
  const shows = renderHook(() => useHideShow(), {
    wrapper: withRuntime(forScreens(session.runtime), queryClient),
  });
  void shows.result.current.hide(8801, { trakt: 8801 }, "A show");
  await vi.waitFor(() => expect(sent("POST", hide)).toHaveLength(1));

  await expectNextLibraryUntouched(session, queryClient);
});

it("offers the next session no Undo when a move to Watchlist ends with its session while resuming the show", async () => {
  const resume = /^\/users\/hidden\/progress_watched\/remove$/;
  const session = await doomedSessionHolding({ method: "POST", path: resume });
  const queryClient = createQueryClient();
  const [listed] = (await session.runtime.loadUpNext()).entries;
  if (listed === undefined) throw new Error("the fake account has no shows");
  const stopped = { ...listed, completed: 0, inWatchlist: false, hidden: true };
  queryClient.setQueryData(queryKeys.library(), { entries: [stopped] });
  const move = renderHook(() => useMoveToWatchlist(), {
    wrapper: withRuntime(forScreens(session.runtime), queryClient),
  });
  void move.result.current(stopped);
  await vi.waitFor(() => expect(sent("POST", resume)).toHaveLength(1), { timeout: 3000 });

  await expectNextLibraryUntouched(session, queryClient);
});

it("leaves the next session's episode alone when the last one's unmark read answers after it ended", async () => {
  const plays = /^\/sync\/history\/episodes\/880100$/;
  const session = await doomedSessionHolding({ method: "GET", path: plays });
  const queryClient = createQueryClient();
  const seasons = await session.runtime.loadShowSeasons(8801);
  const episode = seasons.flatMap((season) => season.episodes).find((e) => e.ids.trakt === 880100);
  if (episode === undefined || !episode.watched) throw new Error("the fake episode is not watched");
  queryClient.setQueryData(queryKeys.showSeasons(8801), seasons);
  const marks = renderHook(() => useMarkSeason(), {
    wrapper: withRuntime(forScreens(session.runtime), queryClient),
  });
  void marks.result.current.toggleEpisode(
    { showId: 8801, ids: { trakt: 8801 }, includeSpecials: false },
    episode,
  );
  await vi.waitFor(() => expect(sent("GET", plays)).toHaveLength(1));
  const unwatched = seasons.map((season) => ({
    ...season,
    episodes: season.episodes.map((e) =>
      e.ids.trakt === 880100 ? { ...e, watched: false, watchedAt: null } : e,
    ),
  }));

  await session.answerAfterNextSignIn(() => {
    queryClient.setQueryData(queryKeys.showSeasons(8801), unwatched);
    showSnack({ message: "The next account's own snack" });
  });

  const cached = queryClient.getQueryData<readonly SeasonView[]>(queryKeys.showSeasons(8801));
  const shown = cached?.flatMap((season) => season.episodes).find((e) => e.ids.trakt === 880100);
  expect(shown).toMatchObject({ watched: false, watchedAt: null });
  expect(useSnackbar.getState().snack?.message).toBe("The next account's own snack");
});
