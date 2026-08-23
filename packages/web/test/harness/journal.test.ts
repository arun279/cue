import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeJournal, readJournal } from "../../../../scripts/mock-trakt/journal.mjs";
import { createMockTrakt } from "../../../../scripts/mock-trakt/server.mjs";

/**
 * The write-journal harness, at the layer where it can be asserted at all.
 *
 * What it uniquely owns is the equivalence comparison's own correctness: a
 * normalizer that drops too much would let a genuine behavioral difference
 * through silently, and that is the one failure the whole equivalence layer
 * exists to catch, so it cannot be the thing nobody checks.
 */

const directory = mkdtempSync(join(tmpdir(), "cue-journal-"));
const file = join(directory, "nested", "journal.ndjson");
const mock = createMockTrakt({ port: 0, log: false, journalFile: file });
let baseUrl = "";

beforeAll(async () => {
  baseUrl = await mock.listen();
});

afterAll(async () => {
  await mock.close();
  rmSync(directory, { recursive: true, force: true });
});

const call = (path: string, init?: RequestInit): Promise<Response> =>
  fetch(`${baseUrl}${path}`, init);

describe("the mock's request journal", () => {
  it("records method, path, query and body, in order", async () => {
    await call("/users/settings");
    await call("/sync/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        episodes: [{ ids: { trakt: 1 }, watched_at: "2026-08-22T10:00:00Z" }],
      }),
    });

    expect(readJournal(file)).toEqual([
      { method: "GET", path: "/users/settings", search: "", body: {} },
      {
        method: "POST",
        path: "/sync/history",
        search: "",
        body: { episodes: [{ ids: { trakt: 1 }, watched_at: "2026-08-22T10:00:00Z" }] },
      },
    ]);
  });

  it("records a request no route answers, so a hole is visible on both sides", async () => {
    await call("/no/such/endpoint");
    expect(readJournal(file).at(-1)).toEqual({
      method: "GET",
      path: "/no/such/endpoint",
      search: "",
      body: {},
    });
  });
});

describe("what two runs are compared on", () => {
  const entry = (path: string, extra: Record<string, unknown> = {}) => ({
    method: "GET",
    path,
    search: "",
    body: null,
    ...extra,
  });

  it("drops the requests whose count measures timing or layout, not behavior", () => {
    expect(
      normalizeJournal([
        entry("/shows/1/images/poster.jpg"),
        entry("/oauth/authorize"),
        entry("/oauth/device/code", { method: "POST" }),
        entry("/oauth/device/token", { method: "POST" }),
        entry("/sync/last_activities"),
        entry("/users/settings"),
      ]),
    ).toEqual([entry("/users/settings")]);
  });

  it("keeps a token exchange, and compares it on what it was rather than on its secrets", () => {
    const exchange = (grant: string, secret: string) => [
      entry("/oauth/token", {
        method: "POST",
        body: { grant_type: grant, code_verifier: secret, redirect_uri: `cue://${secret}` },
      }),
    ];
    expect(normalizeJournal(exchange("authorization_code", "one"))).toEqual(
      normalizeJournal(exchange("authorization_code", "two")),
    );
    expect(normalizeJournal(exchange("refresh_token", "one"))).not.toEqual(
      normalizeJournal(exchange("authorization_code", "one")),
    );
  });

  it("makes the same run yesterday equal to the same run today", () => {
    const monday = normalizeJournal([
      entry("/calendars/my/shows/2026-08-17/7", { search: "?extended=full" }),
      entry("/sync/history", {
        method: "POST",
        body: { episodes: [{ watched_at: "2026-08-17T09:30:00.000Z" }] },
      }),
    ]);
    const tuesday = normalizeJournal([
      entry("/calendars/my/shows/2026-08-18/7", { search: "?extended=full" }),
      entry("/sync/history", {
        method: "POST",
        body: { episodes: [{ watched_at: "2026-08-18T21:04:11.000Z" }] },
      }),
    ]);
    expect(monday).toEqual(tuesday);
  });

  it("still tells two different requests apart", () => {
    expect(normalizeJournal([entry("/shows/1/progress/watched")])).not.toEqual(
      normalizeJournal([entry("/shows/2/progress/watched")]),
    );
  });

  it("still tells two different payloads apart", () => {
    const mark = (trakt: number) => [
      entry("/sync/history", {
        method: "POST",
        body: { episodes: [{ ids: { trakt }, watched_at: "2026-08-18T21:04:11.000Z" }] },
      }),
    ];
    expect(normalizeJournal(mark(1))).not.toEqual(normalizeJournal(mark(2)));
  });

  it("still tells a missing date apart from a present one", () => {
    expect(
      normalizeJournal([entry("/sync/history", { body: { watched_at: "2026-08-18" } })]),
    ).not.toEqual(normalizeJournal([entry("/sync/history", { body: {} })]));
  });
});
