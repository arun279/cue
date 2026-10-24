import { TraktClient } from "@cue/core/data/trakt/client";
import { createLastActivitiesRepository } from "@cue/core/data/trakt/repositories";
import type { LastActivities } from "@cue/core/domain/sync-activities";
import { describe, expect, it } from "vitest";
import { FIXTURE_NOW } from "../trakt-fake/account.ts";
import { startTraktFake } from "../trakt-fake/in-process.ts";

let now = FIXTURE_NOW;
const fake = startTraktFake({ clock: () => now });
const client = new TraktClient({ clientId: "cid", getToken: () => fake.session().access_token });
const repo = createLastActivitiesRepository(client);

async function stored(): Promise<LastActivities> {
  const poll = await repo.poll(undefined);
  if (!poll.ok) throw new Error("the first poll failed");
  return poll.activities;
}

/** One write as the app sends it, a few seconds after the last so Trakt's POST limit allows it. */
async function write(path: string, body: unknown): Promise<void> {
  now += 5000;
  const response = await client.send("POST", path, { body });
  if (response.status >= 300) throw new Error(`${path} answered ${response.status}`);
}

describe("last_activities repository drives the invalidation map", () => {
  it.each([
    [
      "marking an episode",
      "/sync/history",
      { episodes: [{ ids: { trakt: 880120 } }] },
      ["progress/watched", "watched/shows"],
    ],
    [
      "marking a movie",
      "/sync/history",
      { movies: [{ ids: { trakt: 5502 } }] },
      ["movie-progress", "watched/movies"],
    ],
    [
      "adding a show to the watchlist",
      "/sync/watchlist",
      { shows: [{ ids: { trakt: 8801 } }] },
      ["recompute:following", "recompute:to-watch", "watchlist/movies", "watchlist/shows"],
    ],
    [
      "adding a movie to the watchlist",
      "/sync/watchlist",
      { movies: [{ ids: { trakt: 5502 } }] },
      ["recompute:following", "watchlist/movies", "watchlist/shows"],
    ],
    [
      "hiding a show",
      "/users/hidden/progress_watched",
      { shows: [{ ids: { trakt: 8801 } }] },
      ["hidden/progress_watched", "recompute:buckets"],
    ],
    [
      "dropping a show",
      "/users/hidden/dropped",
      { shows: [{ ids: { trakt: 8801 } }] },
      ["hidden/dropped", "recompute:buckets"],
    ],
  ])("returns the targets of what %s moved", async (_, path, body, targets) => {
    const before = await stored();
    await write(path, body);
    const poll = await repo.poll(before);
    expect(poll.ok && [...poll.targets].sort()).toEqual(targets);
  });

  it("returns no targets when nothing advanced", async () => {
    const poll = await repo.poll(await stored());
    expect(poll.ok && poll.targets).toEqual([]);
  });

  it("surfaces a transport failure", async () => {
    fake.fail({ path: /^\/sync\/last_activities$/, times: Number.POSITIVE_INFINITY }, 500);
    const poll = await repo.poll(undefined);
    expect(poll).toEqual({ ok: false, error: { kind: "server", status: 500 } });
  });
});
