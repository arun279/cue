import { expect, it } from "vitest";
import { type AccountSize, defaultAccount, sized } from "../trakt-fake/account.ts";
import { startTraktFake } from "../trakt-fake/in-process.ts";
import { buildRuntime } from "./_runtime";

const NO_PLAYS: AccountSize = {
  inProgress: 0,
  lapsed: 0,
  caughtUp: 0,
  finished: 0,
  airingWatched: 0,
  airingWatchlist: 0,
  watchlistShows: 5,
  watchlistMovies: 5,
  watchedMovies: 0,
  hidden: 0,
};

let withoutPlays = false;
const fake = startTraktFake({
  account: (multiplePlays) => (withoutPlays ? sized(NO_PLAYS) : defaultAccount(multiplePlays)),
});

const historyPages = (since: number) =>
  fake.requests
    .slice(since)
    .filter((request) => request.path === "/users/me/history")
    .map((request) => {
      const query = new URLSearchParams(request.search);
      return [query.get("page"), query.get("limit")];
    });

async function oldestPlay(): Promise<{ readonly at: string; readonly plays: string }> {
  const headers = { authorization: `Bearer ${fake.session().access_token}` };
  // The default account's oldest play is the long runner's first episode.
  const first = await fake.fetch("https://api.trakt.tv/sync/history/episodes/9900", { headers });
  const all = await fake.fetch("https://api.trakt.tv/users/me/history?limit=1", { headers });
  const [play] = (await first.json()) as { watched_at: string }[];
  return { at: play?.watched_at ?? "", plays: all.headers.get("x-pagination-item-count") ?? "" };
}

it("reads the oldest play from the last one-play page, in two reads", async () => {
  withoutPlays = false;
  fake.reset();
  const oldest = await oldestPlay();
  const since = fake.requests.length;

  expect(await (await buildRuntime()).loadFirstPlayAt()).toBe(oldest.at);
  expect(historyPages(since)).toEqual([
    ["1", "1"],
    [oldest.plays, "1"],
  ]);
});

it("answers null for an account with no plays, in one read", async () => {
  withoutPlays = true;
  fake.reset();

  expect(await (await buildRuntime()).loadFirstPlayAt()).toBeNull();
  expect(historyPages(0)).toEqual([["1", "1"]]);
});
