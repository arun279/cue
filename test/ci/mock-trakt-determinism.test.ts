import { EventEmitter, once } from "node:events";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { createFaults } from "../../scripts/mock-trakt/faults.mjs";
import { createSeedLibrary, FIXTURE_NOW } from "../../scripts/mock-trakt/seed.mjs";
import { createMockTrakt } from "../../scripts/mock-trakt/server.mjs";
import { repositoryPath } from "../support/repository-path";

afterEach(() => vi.restoreAllMocks());

it("seeds the same absolute dates regardless of the host clock", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01"));
  const first = createSeedLibrary();
  vi.mocked(Date.now).mockReturnValue(Date.parse("2040-01-01"));
  const second = createSeedLibrary();
  expect(first.now).toBe(Date.parse("2026-10-15T00:00:00.000Z"));
  expect(second.shows).toEqual(first.shows);
});

it("starts every harness app's clock at the instant the mock serves", () => {
  const harnessEnvs = [
    ...readFileSync(repositoryPath(".github/workflows/ci.yml"), "utf8").matchAll(
      /^( +)env:\n((?:\1 {2}.*\n)+)/gm,
    ),
  ]
    .map(([, , block = ""]) => block)
    .filter((block) => block.includes('EXPO_PUBLIC_UI_HARNESS: "1"'));
  expect(harnessEnvs.length).toBeGreaterThan(0);
  expect(
    harnessEnvs.map((block) =>
      Date.parse(block.match(/EXPO_PUBLIC_CLOCK_START: "([^"]*)"/)?.[1] ?? ""),
    ),
  ).toEqual(harnessEnvs.map(() => FIXTURE_NOW));
});

it("expires faults by matching request count or explicit release", () => {
  const faults = createFaults({ match: "reads", status: 503, count: 2, after: 1 });
  const url = new URL("http://mock/users/settings");
  expect(faults.next("POST", url)).toBeNull();
  expect(faults.next("GET", url)).toBeNull();
  expect(faults.next("GET", url)?.status).toBe(503);
  expect(faults.next("GET", url)?.status).toBe(503);
  expect(faults.next("GET", url)).toBeNull();
  expect(faults.describe()[0]?.expired).toBe(true);
  faults.arm({ status: 429 });
  vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
  expect(faults.next("GET", url)?.status).toBe(429);
  faults.clear();
  expect(faults.next("GET", url)).toBeNull();
});

it.each([{ forMs: 1 }, { delayMs: 1 }])("rejects timed fault configuration: %j", (rule) => {
  expect(() => createFaults(rule)).toThrow("Use count or hold with explicit release");
});

it("uses the injected clock for tokens and resets, with monotonic activity on writes", async () => {
  let now = Date.parse("2025-06-01T00:00:00.000Z");
  const server = createMockTrakt({ port: 0, log: false, clock: () => now });
  const url = await server.listen();
  const post = (route: string, body = {}) =>
    fetch(`${url}${route}`, { method: "POST", body: JSON.stringify(body) });
  try {
    expect(server.library.now).toBe(now);
    expect((await (await post("/oauth/token")).json()).created_at).toBe(now / 1000);
    await post("/sync/history", { episodes: [{ ids: { trakt: 880100 } }] });
    expect(server.library.shows[0]?.watchedAt.get(880100)).toBe(now);
    const activity = server.library.activities.episodes;
    await post("/sync/history", { episodes: [{ ids: { trakt: 880100 } }] });
    expect(server.library.activities.episodes).toBeGreaterThan(activity);
    now += 86_400_000;
    await post("/__reset");
    expect(server.library.now).toBe(now);
    expect(server.library.activities.episodes).toBe(now);
    await post("/__reset");
    expect(server.library.activities.episodes).toBe(now + 1);
    expect((await post("/__fault", { delayMs: 10 })).status).toBe(400);
  } finally {
    await server.close();
  }
});

it("releases a held response only through the control plane", async () => {
  const requests = new EventEmitter();
  const observed = once(requests, "request");
  const server = createMockTrakt({
    port: 0,
    log: false,
    faults: { hold: true },
    onRequest: () => requests.emit("request"),
  });
  const url = await server.listen();
  let answered = false;
  const request = fetch(`${url}/users/settings`).then((response) => {
    answered = true;
    return response;
  });
  try {
    await observed;
    expect(server.heldRequests).toBe(1);
    expect(answered).toBe(false);
    await fetch(`${url}/__fault`, { method: "DELETE" });
    expect((await request).status).toBe(200);
    expect(server.heldRequests).toBe(0);
  } finally {
    await server.close();
  }
});
