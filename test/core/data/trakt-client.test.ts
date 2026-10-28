import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraktClient, unwrapRead } from "@/core/data/trakt/client";
import { DEFAULT_TRAKT_POLICY } from "@/core/data/trakt/policy";
import type { TraktFailure } from "@/core/domain/read-failure";
import { createTraktFake } from "../trakt-fake/fake.ts";

const fake = createTraktFake();

beforeEach(() => fake.reset());

function client(token: string | null = fake.session().access_token): TraktClient {
  return new TraktClient({ clientId: "cid-123", getToken: () => token, fetch: fake.fetch });
}

const sent = () => {
  const [first] = fake.requests;
  if (first === undefined) throw new Error("nothing reached the fake");
  return first;
};

describe("TraktClient headers + extended", () => {
  it("sets the required Trakt headers and omits Authorization when no token", async () => {
    await client(null).get("/sync/watched/shows");
    const { headers } = sent();
    expect(headers["trakt-api-key"]).toBe("cid-123");
    expect(headers["trakt-api-version"]).toBe("2");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["authorization"]).toBeUndefined();
  });

  it("adds a bearer Authorization header when a token is present", async () => {
    await client("tok-abc").get("/users/settings");
    expect(sent().headers["authorization"]).toBe("Bearer tok-abc");
  });

  it("sends an injected User-Agent", async () => {
    const trakt = new TraktClient({
      clientId: "cid-123",
      userAgent: "Cue/1.0.0",
      fetch: fake.fetch,
    });
    await trakt.get("/shows/8801");
    expect(sent().headers["user-agent"]).toBe("Cue/1.0.0");
  });

  it("builds the comma-combined extended query param", async () => {
    await client().get("/shows/8801/seasons", { extended: ["full", "images"] });
    expect(new URLSearchParams(sent().search).get("extended")).toBe("full,images");
  });
});

describe("TraktClient base URL", () => {
  it("sends requests to an injected baseUrl, trailing slash trimmed", async () => {
    const local = createTraktFake({ baseUrl: "http://127.0.0.1:8787" });
    const mocked = new TraktClient({
      clientId: "cid-123",
      getToken: () => local.session().access_token,
      baseUrl: "http://127.0.0.1:8787/",
      fetch: local.fetch,
    });
    expect((await mocked.get("/sync/watched/shows")).ok).toBe(true);
    expect(local.noRoute).toEqual([]);
    expect(local.requests.map(({ path }) => path)).toEqual(["/sync/watched/shows"]);
  });
});

describe("TraktClient pagination", () => {
  it("reads the X-Pagination-* headers into the result", async () => {
    const result = await client().get("/users/me/history", { page: 2, limit: 10 });
    const all = await client().getAllPages("/users/me/history", { limit: 100 });
    expect(result.ok && result.pagination).toEqual({
      page: 2,
      pageCount: Math.ceil((all.ok ? all.data.length : 0) / 10),
    });
  });

  it("walks every page via getAllPages and flattens the arrays", async () => {
    const result = await client().getAllPages("/users/me/history", { limit: 100 });
    const pages = fake.requests.map(({ search }) => new URLSearchParams(search).get("page"));
    const ids = result.ok ? result.data.map((row) => Object(row).id) : [];
    const pageCount = result.ok ? (result.pagination?.pageCount ?? 0) : 0;
    expect(pageCount).toBeGreaterThan(1);
    expect(pages).toEqual(Array.from({ length: pageCount }, (_, index) => String(index + 1)));
    expect(ids.length).toBeGreaterThan((pageCount - 1) * 100);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("fails the whole walk when a later page fails", async () => {
    fake.fail({ path: /^\/users\/me\/history$/, query: /(^|&)page=2(&|$)/ }, 503);
    expect(await client().getAllPages("/users/me/history", { limit: 100 })).toEqual({
      ok: false,
      error: { kind: "server", status: 503 },
    });
  });
});

const timeoutMs = { read: 40, list: 90, write: 60 };

function heldOnPolicy(): TraktClient {
  return new TraktClient({
    clientId: "cid-123",
    policy: { ...DEFAULT_TRAKT_POLICY, timeoutMs },
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  });
}

describe("TraktClient error mapping", () => {
  const path = "/sync/watched/shows";
  const respond = (status: number, retryAfter?: number): void =>
    fake.fail({ path: /^\/sync\/watched\/shows$/ }, status, retryAfter);

  it("maps Trakt's 401 for a read without a valid session to unauthorized", async () => {
    expect(await client("never-issued").get(path)).toEqual({
      ok: false,
      error: { kind: "unauthorized" },
    });
  });

  it("maps Trakt's empty 404 to not-found", async () => {
    expect(await client().get("/shows/999999999")).toEqual({
      ok: false,
      error: { kind: "not-found" },
    });
  });

  it.each<{ status: number; kind: TraktFailure["kind"] }>([
    { status: 420, kind: "account-limit" },
    { status: 423, kind: "account-locked" },
    { status: 426, kind: "vip-required" },
  ])("maps permanent status $status to $kind", async ({ status, kind }) => {
    respond(status);
    expect(await client().get(path)).toEqual({ ok: false, error: { kind } });
  });

  it("maps 429 and reads Retry-After seconds", async () => {
    respond(429, 3);
    const result = await client().get(path);
    expect(result).toEqual({ ok: false, error: { kind: "rate-limited", retryAfterMs: 3500 } });
  });

  it("honors a long read Retry-After with a positive margin", async () => {
    respond(429, 120);
    const result = await client().get(path);
    expect(result).toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAfterMs: 120_500 },
    });
  });

  it("maps 500 to server with the status", async () => {
    respond(503);
    expect(await client().get(path)).toEqual({ ok: false, error: { kind: "server", status: 503 } });
  });

  it("maps an unexpected 4xx to server carrying its status", async () => {
    respond(418);
    expect(await client().get(path)).toEqual({ ok: false, error: { kind: "server", status: 418 } });
  });

  it("maps a fetch reject (no response) to network", async () => {
    fake.drop({ path: /^\/sync\/watched\/shows$/ });
    expect(await client().get(path)).toEqual({ ok: false, error: { kind: "network" } });
  });

  it("rejects a held read as a typed timeout after the request timeout", async () => {
    vi.useFakeTimers();
    const held = new TraktClient({
      clientId: "cid-123",
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
    const read = held.get(path).then((result) => unwrapRead(result, "held read"));
    const rejection = expect(read).rejects.toMatchObject({ failure: { kind: "timeout" } });

    await vi.advanceTimersByTimeAsync(DEFAULT_TRAKT_POLICY.timeoutMs.read);
    await rejection;
    vi.useRealTimers();
  }, 1000);

  it("times out each request class on the injected policy", async () => {
    vi.useFakeTimers();
    const held = heldOnPolicy();
    const settled = new Set<string>();
    const read = held.get(path).then((result) => settled.add("read") && result);
    const list = held.getAllPages(path).then((result) => settled.add("list") && result);

    await vi.advanceTimersByTimeAsync(timeoutMs.read - 1);
    expect(settled.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await read).toEqual({ ok: false, error: { kind: "timeout" } });
    expect(settled.has("list")).toBe(false);
    await vi.advanceTimersByTimeAsync(timeoutMs.list - timeoutMs.read);
    expect(await list).toEqual({ ok: false, error: { kind: "timeout" } });
    vi.useRealTimers();
  }, 1000);

  it("times out a write on the injected policy's write class", async () => {
    vi.useFakeTimers();
    const held = heldOnPolicy();
    let settled = false;
    const write = held.send("POST", "/sync/history", { body: {} }).catch((error: unknown) => {
      settled = true;
      return error;
    });

    await vi.advanceTimersByTimeAsync(timeoutMs.write - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await write).toMatchObject({ name: "AbortError" });
    vi.useRealTimers();
  }, 1000);
});
