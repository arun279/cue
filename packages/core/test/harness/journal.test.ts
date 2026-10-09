import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readJournal } from "../../../../scripts/mock-trakt/journal.mjs";
import { createHarnessServer } from "./mock-server";

const mock = createHarnessServer("cue-journal-", "nested/journal.ndjson");
const file = mock.journalFile;
let baseUrl = "";

beforeAll(async () => {
  baseUrl = await mock.listen();
});

afterAll(async () => {
  await mock.close();
});

const call = (path: string, init?: RequestInit): Promise<Response> =>
  fetch(`${baseUrl}${path}`, init);

describe("the mock request journal", () => {
  it("records method, path, query, and body in order", async () => {
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

  it("records a request no route answers", async () => {
    await call("/no/such/endpoint");
    expect(readJournal(file).at(-1)).toEqual({
      method: "GET",
      path: "/no/such/endpoint",
      search: "",
      body: {},
    });
  });
});
