import { queryKeys } from "@cue/core/data/query-keys";
import { TraktClient } from "@cue/core/data/trakt/client";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import { describe, expect, it } from "vitest";
import { FIXTURE_NOW } from "../trakt-fake/account.ts";
import { startTraktFake } from "../trakt-fake/in-process.ts";
import { buildRuntime } from "./_runtime";

let now = FIXTURE_NOW;
const fake = startTraktFake({ clock: () => now });
const client = new TraktClient({ clientId: "cid", getToken: () => fake.session().access_token });

/** A runtime that has already polled once and kept the stamps it saw. */
async function polledRuntime(): Promise<CueRuntime> {
  const runtime = await buildRuntime({ token: fake.session() });
  const first = await runtime.pollActivities();
  expect(first?.keys).toEqual([]);
  await first?.commit();
  return runtime;
}

/** One write as the app sends it, a few seconds after the last so Trakt's POST limit allows it. */
async function write(path: string, body: unknown): Promise<void> {
  now += 5000;
  const response = await client.send("POST", path, { body });
  if (response.status >= 300) throw new Error(`${path} answered ${response.status}`);
}

const sorted = (keys: readonly (readonly unknown[])[] | undefined) =>
  keys?.map((key) => JSON.stringify(key)).sort();

const library = queryKeys.library();
const movieLibrary = queryKeys.movieLibrary();
const movieWatchlist = queryKeys.movieWatchlist();
const history = queryKeys.historyPrefix();

describe("what an activities poll refreshes after a write on Trakt", () => {
  it.each([
    [
      "marking an episode",
      "/sync/history",
      { episodes: [{ ids: { trakt: 880120 } }] },
      [library, history],
    ],
    [
      "marking a movie",
      "/sync/history",
      { movies: [{ ids: { trakt: 5502 } }] },
      [movieLibrary, history],
    ],
    [
      "adding a show to the watchlist",
      "/sync/watchlist",
      { shows: [{ ids: { trakt: 8801 } }] },
      [library],
    ],
    [
      "adding a movie to the watchlist",
      "/sync/watchlist",
      { movies: [{ ids: { trakt: 5502 } }] },
      [movieLibrary, movieWatchlist],
    ],
    [
      "hiding a show",
      "/users/hidden/progress_watched",
      { shows: [{ ids: { trakt: 8801 } }] },
      [library, ...(["progress", "seasons", "episode"] as const).map(queryKeys.showSection)],
    ],
    ["dropping a show", "/users/hidden/dropped", { shows: [{ ids: { trakt: 8801 } }] }, [library]],
  ])("refreshes the reads %s moved", async (_, path, body, keys) => {
    const runtime = await polledRuntime();
    await write(path, body);
    expect(sorted((await runtime.pollActivities())?.keys)).toEqual(sorted(keys));
  });

  it("refreshes nothing when nothing moved", async () => {
    const runtime = await polledRuntime();
    expect((await runtime.pollActivities())?.keys).toEqual([]);
  });

  it("offers nothing to commit when the poll fails", async () => {
    const runtime = await buildRuntime({ token: fake.session() });
    fake.fail({ path: /^\/sync\/last_activities$/, times: Number.POSITIVE_INFINITY }, 500);
    expect(await runtime.pollActivities()).toBeNull();
  });
});
