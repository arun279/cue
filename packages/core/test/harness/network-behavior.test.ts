import { createCueRuntime } from "@cue/core/app/create-runtime";
import { queryKeys } from "@cue/core/data/query-keys";
import { createAuthorizedFetch } from "@cue/core/data/trakt/authorized-fetch";
import { TRAKT_API_BASE, TraktClient } from "@cue/core/data/trakt/client";
import { getShowProgress, getUserSettings } from "@cue/core/data/trakt/endpoints";
import {
  readsPausedUntil,
  resetReadPause,
  withReadRateRetry,
} from "@cue/core/data/trakt/read-budget";
import type { Token } from "@cue/core/domain/model/token";
import { buildMarkEpisodeOp } from "@cue/core/domain/write-queue/ops";
import { refreshShowProgress } from "@cue/core/hooks/library-cache";
import type { KeyValueStore } from "@cue/core/ports/kv";
import type { TokenStore } from "@cue/core/ports/token-store";
import { createQueryClient } from "@cue/core/runtime/query-cache";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readJournal } from "../../../../scripts/mock-trakt/journal.mjs";
import { createHarnessServer } from "./mock-server";

interface JournalEntry {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: Record<string, unknown>;
}

const mock = createHarnessServer("cue-network-harness-");
const { journalFile } = mock;
let baseUrl = "";

beforeAll(async () => {
  baseUrl = await mock.listen();
});

afterAll(async () => {
  await mock.close();
});

afterEach(async () => {
  vi.useRealTimers();
  resetReadPause();
  await fetch(`${baseUrl}/__reset`, { method: "POST" });
});

const entries = (): JournalEntry[] => readJournal(journalFile) as JournalEntry[];
const since = (start: number): JournalEntry[] => entries().slice(start);

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("network harness condition did not settle");
}

const arm = async (rule: Record<string, unknown>): Promise<void> => {
  const response = await fetch(`${baseUrl}/__fault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rule),
  });
  expect(response.ok).toBe(true);
};

const token = (): Token => ({
  access_token: "stale-access",
  refresh_token: "mock-refresh-token",
  token_type: "bearer",
  scope: "public",
  created_at: Math.floor(Date.now() / 1000),
  expires_in: 604_800,
});

function memoryKv(seed: Record<string, string> = {}): KeyValueStore {
  const values = new Map(Object.entries(seed));
  return {
    read: async (key) => values.get(key) ?? null,
    write: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key),
  };
}

const inertTokenStore: TokenStore = {
  read: async () => null,
  write: async () => undefined,
  clear: async () => undefined,
};

const runtime = (
  overrides: { kv?: KeyValueStore; tokenStore?: TokenStore; endSession?: () => Promise<void> } = {},
) =>
  createCueRuntime({
    token: token(),
    newId: () => "harness-op",
    kv: overrides.kv ?? memoryKv(),
    tokenStore: overrides.tokenStore ?? inertTokenStore,
    redirectUri: "cue://oauth",
    clientId: "mock-client",
    apiBaseUrl: baseUrl,
    browser: false,
    endSession: overrides.endSession ?? (async () => undefined),
    clearPersistedCaches: async () => undefined,
    clearLocalPreferences: () => undefined,
  });

function authorizedClient(
  options: { persist?: (next: Token) => Promise<void>; endSession?: () => Promise<void> } = {},
): TraktClient {
  const authorized = createAuthorizedFetch({
    inner: (input, init) => fetch(input, init),
    token: token(),
    config: { clientId: "mock-client", redirectUri: "cue://oauth", apiBaseUrl: baseUrl },
    persist: options.persist ?? (async () => undefined),
    endSession: options.endSession ?? (async () => undefined),
  });
  return new TraktClient({
    clientId: "mock-client",
    getToken: authorized.accessToken,
    fetch: authorized.fetch,
    baseUrl,
  });
}

describe("request budgets", () => {
  it("keeps cold start, mark, manual, foreground, and idle flows bounded", async () => {
    const cue = await runtime();
    let start = entries().length;
    const library = await cue.loadUpNext();
    const coldStart = since(start);
    expect(coldStart).toHaveLength(8);
    expect(coldStart.filter((entry) => entry.path === "/sync/watched/shows")).toHaveLength(1);
    expect(
      coldStart.filter((entry) => /\/shows\/\d+\/progress\/watched/.test(entry.path)),
    ).toHaveLength(5);
    expect(
      coldStart.filter((entry) => entry.path === "/users/hidden/progress_watched"),
    ).toHaveLength(1);
    expect(coldStart.filter((entry) => entry.path === "/sync/watchlist/shows")).toHaveLength(1);

    const first = library.entries.find((entry) => entry.nextEpisode !== null);
    if (first?.nextEpisode === null || first === undefined)
      throw new Error("seed has no next episode");
    const queryClient = createQueryClient();
    queryClient.setQueryData(queryKeys.library(), library);
    start = entries().length;
    expect(
      await cue.submit(
        buildMarkEpisodeOp({
          opId: "budget-mark",
          ids: first.nextEpisode.ids,
          watchedAt: "2026-09-10T12:00:00.000Z",
          inversePatch: { showId: first.showId, preCompleted: first.completed },
        }),
      ),
    ).toBe("done");
    refreshShowProgress(queryClient, first.showId, () => cue.loadShowProgress(first.showId));
    await queryClient.fetchQuery({
      queryKey: queryKeys.showProgress(first.showId),
      queryFn: () => cue.loadShowProgress(first.showId),
    });
    await cue.loadHistory("all", 1);
    const mark = since(start);
    expect(mark).toHaveLength(3);
    expect(mark.filter((entry) => entry.method === "POST")).toHaveLength(1);
    expect(
      mark.filter((entry) => entry.path === `/shows/${first.showId}/progress/watched`),
    ).toHaveLength(1);
    expect(mark.some((entry) => entry.path === "/sync/watched/shows")).toBe(false);

    for (const flow of ["manual", "foreground", "idle"]) {
      start = entries().length;
      const reconcile = await cue.pollActivities();
      await reconcile?.commit();
      expect(since(start), flow).toEqual([
        expect.objectContaining({ method: "GET", path: "/sync/last_activities" }),
      ]);
    }
  });
});

describe("read failures", () => {
  it("honors a capped Retry-After and holds other reads behind the pause", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    await arm({
      match: "reads",
      path: "^/shows/8801/progress/watched$",
      status: 429,
      retryAfter: 301,
      count: 1,
    });
    const start = entries().length;
    const read = withReadRateRetry(() => getShowProgress(authorizedClient(), 8801));
    await waitFor(() => readsPausedUntil() > Date.now());
    expect(readsPausedUntil() - Date.now()).toBe(300_500);

    const sibling = withReadRateRetry(() => getUserSettings(authorizedClient()));
    await vi.advanceTimersByTimeAsync(300_499);
    expect(since(start)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await waitFor(() => since(start).length === 3);
    expect((await read).ok).toBe(true);
    expect((await sibling).ok).toBe(true);
  });

  it("retries two server failures on the query ladder", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    await arm({
      match: "reads",
      path: "^/calendars/my/shows/",
      status: 503,
      count: 2,
    });
    const cue = await runtime();
    const queryClient = createQueryClient();
    const start = entries().length;
    const read = queryClient.fetchQuery({
      queryKey: queryKeys.calendar("2026-09-10", 28),
      queryFn: () => cue.loadCalendar("2026-09-10", 28),
    });
    await waitFor(() => since(start).some((entry) => entry.path.startsWith("/calendars/")));
    await vi.advanceTimersByTimeAsync(2200);
    await waitFor(
      () => since(start).filter((entry) => entry.path.startsWith("/calendars/")).length === 2,
    );
    await vi.advanceTimersByTimeAsync(4400);
    await expect(read).resolves.toMatchObject({ entries: expect.any(Array) });
    expect(since(start).filter((entry) => entry.path.startsWith("/calendars/"))).toHaveLength(3);
  });

  it("ends a manual refresh with the shared rate-limit pause still published", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    await arm({
      match: "reads",
      path: "^/sync/last_activities$",
      status: 429,
      retryAfter: 0,
      count: 4,
    });
    const cue = await runtime();
    const start = entries().length;
    const poll = cue.pollActivities();
    for (let attempt = 1; attempt < 4; attempt += 1) {
      await waitFor(() => since(start).length === attempt);
      await vi.advanceTimersByTimeAsync(500);
    }
    await waitFor(() => since(start).length === 4);
    await expect(poll).resolves.toBeNull();
    expect(readsPausedUntil()).toBeGreaterThan(Date.now());
  });

  it("classifies a rejected Trakt response as unreadable in a browser client", async () => {
    const start = entries().length;
    const client = new TraktClient({
      clientId: "mock-client",
      browser: true,
      fetch: async (input, init) => {
        const url = new URL(input);
        await fetch(`${baseUrl}${url.pathname}${url.search}`, init);
        throw new TypeError("response blocked");
      },
      baseUrl: TRAKT_API_BASE,
    });
    const result = await getUserSettings(client);
    expect(result).toEqual({ ok: false, error: { kind: "unreadable-response" } });
    expect(since(start)).toEqual([
      expect.objectContaining({ method: "GET", path: "/users/settings" }),
    ]);
  });
});

describe("token refresh", () => {
  it("refreshes one failed read once, persists the token, and retries", async () => {
    await arm({ match: "reads", status: 401, count: 1 });
    const persisted: Token[] = [];
    const start = entries().length;
    const result = await getUserSettings(
      authorizedClient({ persist: async (next) => void persisted.push(next) }),
    );
    const requests = since(start);
    expect(result.ok).toBe(true);
    expect(requests.filter((entry) => entry.path === "/oauth/token")).toHaveLength(1);
    expect(requests.filter((entry) => entry.path === "/users/settings")).toHaveLength(2);
    expect(requests.find((entry) => entry.path === "/oauth/token")?.body).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "mock-refresh-token",
      client_id: "mock-client",
    });
    expect(requests.find((entry) => entry.path === "/oauth/token")?.body).not.toHaveProperty(
      "client_secret",
    );
    expect(persisted).toHaveLength(1);
  });

  it("single-flights concurrent unauthorized reads", async () => {
    await arm({ match: "reads", status: 401, count: 2 });
    const client = authorizedClient();
    const start = entries().length;
    const [settings, stats] = await Promise.all([
      client.get("/users/settings"),
      client.get("/users/me/stats"),
    ]);
    expect(settings.ok).toBe(true);
    expect(stats.ok).toBe(true);
    expect(since(start).filter((entry) => entry.path === "/oauth/token")).toHaveLength(1);
  });

  it("ends the session when the refresh token is rejected", async () => {
    await arm({
      rules: [
        { match: "reads", status: 401, count: 1 },
        {
          path: "^/oauth/token$",
          status: 401,
          body: { error: "invalid_grant" },
          count: 1,
        },
      ],
    });
    const endSession = vi.fn(async () => undefined);
    const start = entries().length;
    const result = await getUserSettings(authorizedClient({ endSession }));
    expect(result).toEqual({ ok: false, error: { kind: "unauthorized" } });
    expect(endSession).toHaveBeenCalledOnce();
    expect(since(start).filter((entry) => entry.path === "/oauth/token")).toHaveLength(1);
  });
});

describe("write faults", () => {
  const mark = () =>
    buildMarkEpisodeOp({
      opId: "fault-mark",
      ids: { trakt: 880120 },
      watchedAt: "2026-09-10T12:00:00.000Z",
      inversePatch: { showId: 8801, preCompleted: 20 },
    });

  it("retries a rate-limited write after Retry-After", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    await arm({ match: "writes", path: "^/sync/history$", status: 429, retryAfter: 3, count: 1 });
    const cue = await runtime();
    const start = entries().length;
    const submitted = cue.submit(mark());
    await waitFor(() => since(start).length === 1);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(submitted).resolves.toBe("done");
    expect(since(start).filter((entry) => entry.path === "/sync/history")).toHaveLength(2);
  });

  it("retries server failures on the bounded write ladder", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    await arm({ match: "writes", path: "^/sync/history$", status: 503, count: 2 });
    const cue = await runtime();
    const start = entries().length;
    const submitted = cue.submit(mark());
    await waitFor(() => since(start).length === 1);
    await vi.advanceTimersByTimeAsync(1100);
    await waitFor(() => since(start).length === 2);
    await vi.advanceTimersByTimeAsync(2200);
    await expect(submitted).resolves.toBe("done");
    expect(since(start).filter((entry) => entry.path === "/sync/history")).toHaveLength(3);
  });

  it("keeps a held write pending until the fault is released", async () => {
    await arm({ match: "writes", path: "^/sync/history$", hold: true, count: 1 });
    const cue = await runtime();
    const start = entries().length;
    const submitted = cue.submit(mark());
    await waitFor(() => since(start).length === 1);
    expect(cue.inFlightOpId()).toBe("fault-mark");
    expect(cue.pendingWrites()).toBe(1);
    await fetch(`${baseUrl}/__fault`, { method: "DELETE" });
    await expect(submitted).resolves.toBe("done");
    expect(cue.pendingWrites()).toBe(0);
  });

  it("reconciles an applied write whose response was lost without posting twice", async () => {
    await fetch(`${baseUrl}/__fault?apply-drop-write`, { method: "POST" });
    const cue = await runtime();
    const start = entries().length;
    await expect(cue.submit(mark())).resolves.toBe("done");
    const requests = since(start);
    expect(requests.filter((entry) => entry.path === "/sync/history")).toHaveLength(1);
    expect(requests.filter((entry) => entry.path === "/shows/8801/progress/watched")).toHaveLength(
      1,
    );
  });
});
