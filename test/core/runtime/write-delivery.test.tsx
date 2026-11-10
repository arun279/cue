// @vitest-environment jsdom
/**
 * How the runtime's write queue delivers to the Trakt fake when Trakt's answers go
 * missing or keep failing: what is sent again, what is given up, and what the app
 * hears about each write afterwards.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SeasonView } from "@/core/domain/show-detail";
import {
  buildAddWatchlistOp,
  buildMarkEpisodeOp,
  buildMarkMovieOp,
  buildRemoveWatchlistOp,
  buildStopShowOp,
  buildUndoAddOp,
  buildUnmarkEpisodeOp,
} from "@/core/domain/write-queue/ops";
import { useMarkSeason } from "@/core/hooks/useMarkSeason";
import { useMarkWatched } from "@/core/hooks/useMarkWatched";
import { OP_LOG_KEY } from "@/core/ports/storage-keys";
import { libraryQuery } from "@/core/queries/library";
import type { RuntimeDeps } from "@/core/runtime/create-runtime";
import { createQueryClient } from "@/core/runtime/query-cache";
import type { CueRuntime } from "@/core/runtime/runtime";
import { resetMarkStore } from "@/core/stores/mark-store";
import { usePlayPolicy } from "@/core/stores/play-policy-store";
import { useSnackbar } from "@/core/stores/snackbar-store";
import { buildRuntime } from "../data/_runtime";
import { waited } from "../support/queue-time";
import { pressUndo, withRuntime } from "../support/runtime";
import { memoryKeyValueStore } from "../support/stores";
import { startTraktFake } from "../trakt-fake/in-process.ts";

const fake = startTraktFake();

afterEach(() => {
  vi.useRealTimers();
  resetMarkStore();
});

const AT = "2026-09-10T12:00:00.000Z";
const HISTORY = /^\/sync\/history$/;
const HIDDEN = /^\/users\/hidden\/progress_watched$/;
const EVERY = Number.POSITIVE_INFINITY;
// The seed's first show has its first 20 episodes watched; this is its 21st.
const NEXT_EPISODE = 880120;

/** A runtime whose writes each get their own id, as the app's do. */
function distinctIds(overrides: Partial<RuntimeDeps> = {}) {
  let made = 0;
  return buildRuntime({
    newId: () => {
      made += 1;
      return `op-${made}`;
    },
    ...overrides,
  });
}

const posts = (path: string) =>
  fake.requests.filter((entry) => entry.method === "POST" && entry.path === path);

it("sends the Undo of a mark whose answer was lost, so Trakt does not keep the mark", async () => {
  fake.drop({ method: "POST", path: HISTORY }, "after");
  fake.drop({ method: "GET", path: /\/progress\/watched$/, times: EVERY });
  const cue = await buildRuntime();
  const mark = buildMarkEpisodeOp({ opId: "mark", ids: { trakt: NEXT_EPISODE }, watchedAt: AT });
  await expect(cue.submit(mark)).resolves.toBe("deferred");

  const undo = buildUnmarkEpisodeOp({ opId: "undo", ids: { trakt: NEXT_EPISODE }, watchedAt: AT });
  await cue.submit(undo);
  await cue.flushWrites();

  expect(posts("/sync/history/remove")).toHaveLength(1);
  expect(await cue.loadEpisodePlays(NEXT_EPISODE)).toEqual([]);
  expect(cue.pendingWrites()).toBe(0);
});

it("sends a movie mark again when its answer was lost, and Trakt keeps one play", async () => {
  fake.drop({ method: "POST", path: HISTORY }, "after");
  const cue = await buildRuntime();
  await cue.submit(buildMarkMovieOp({ opId: "movie", ids: { trakt: 5503 }, watchedAt: AT }));
  await cue.flushWrites();

  expect(posts("/sync/history")).toHaveLength(2);
  expect(await cue.loadMoviePlays(5503)).toHaveLength(1);
  expect(cue.pendingWrites()).toBe(0);
});

it("gives up a write Trakt keeps refusing, and sends the writes queued behind it", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(AT));
  fake.fail({ method: "POST", path: HIDDEN, times: EVERY }, 500);
  const cue = await buildRuntime();
  void cue.submit(buildStopShowOp("hidden", { opId: "stuck", ids: { trakt: 8801 } }));
  void cue.submit(buildAddWatchlistOp({ opId: "behind", section: "shows", ids: { trakt: 8901 } }));

  for (let minute = 0; minute < 10 && cue.pendingWrites() > 0; minute += 1) {
    const flushed = cue.flushWrites();
    await vi.advanceTimersByTimeAsync(60_000);
    await flushed;
  }

  expect(cue.pendingWrites()).toBe(0);
  expect(posts("/sync/watchlist")).toHaveLength(1);
  await expect(cue.settled("stuck")).resolves.toBe("failed");
  await expect(cue.settled("behind")).resolves.toBe("done");
});

it("gives up a write five minutes after Trakt first refused it, though the app stopped while waiting", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(AT));
  fake.fail({ method: "POST", path: HIDDEN, times: EVERY }, 429, 60);
  const kv = memoryKeyValueStore();
  const first = await buildRuntime({ kv });
  void first.submit(buildStopShowOp("hidden", { opId: "stuck", ids: { trakt: 8801 } }));
  await vi.advanceTimersByTimeAsync(150_000);

  const relaunched = await buildRuntime({ kv: memoryKeyValueStore(Object.fromEntries(kv.values)) });
  const flushed = relaunched.flushWrites();
  await vi.advanceTimersByTimeAsync(180_000);
  await flushed;

  expect(relaunched.writeState("stuck")).toBe("failed");
});

/** A runtime whose mark is held in flight, so the writes queued behind it are not sent yet. */
async function behindAHeldMark() {
  const release = fake.hold({ method: "POST", path: HISTORY });
  const cue = await buildRuntime();
  const ahead = cue.submit(
    buildMarkEpisodeOp({ opId: "ahead", ids: { trakt: NEXT_EPISODE }, watchedAt: AT }),
  );
  await vi.waitFor(() => expect(cue.writeState("ahead")).toBe("sent"));
  return { cue, ahead, release };
}

const show = { section: "shows", ids: { trakt: 8901 } } as const;

it("tells each write it was cancelled when its opposite was queued before either was sent", async () => {
  const { cue, ahead, release } = await behindAHeldMark();
  const add = cue.submit(buildAddWatchlistOp({ opId: "add", ...show }));
  const remove = cue.submit(buildRemoveWatchlistOp({ opId: "remove", ...show }));
  release();

  await expect(Promise.all([ahead, add, remove])).resolves.toEqual([
    "done",
    "cancelled",
    "cancelled",
  ]);
  expect(posts("/sync/watchlist")).toHaveLength(0);
});

it("tells a write that repeats one already queued how that one went", async () => {
  const { cue, ahead, release } = await behindAHeldMark();
  const first = cue.submit(buildAddWatchlistOp({ opId: "first", ...show }));
  const again = cue.submit(buildAddWatchlistOp({ opId: "again", ...show }));
  release();

  await expect(Promise.all([ahead, first, again])).resolves.toEqual(["done", "done", "done"]);
  expect(posts("/sync/watchlist")).toHaveLength(1);
});

// Harbor Lights (8801) was watched through S3E4; S1E1 and S1E2 each have one play from then.
const SHOW = 8801;
const FIRST_EPISODE = 880100;
const SECOND_EPISODE = 880101;

/** The show started again from S1E1, which Up Next offers once more. */
async function restarted() {
  const cue = await distinctIds();
  const queryClient = createQueryClient();
  const library = await queryClient.fetchQuery(libraryQuery(cue));
  const entry = library.entries.find((candidate) => candidate.showId === SHOW);
  if (entry?.nextEpisode == null) throw new Error("the show needs a next episode");
  const again = {
    ...entry,
    completed: 0,
    nextEpisode: { ...entry.nextEpisode, season: 1, number: 1, ids: { trakt: FIRST_EPISODE } },
  };
  const earlier = await cue.loadEpisodePlays(FIRST_EPISODE);
  const wrapper = withRuntime(cue, queryClient);
  return { cue, queryClient, entry: again, earlier, wrapper };
}

const playsOf = async (cue: CueRuntime, episode: number) =>
  (await cue.loadEpisodePlays(episode)).map((play) => play.historyId);

it("undoes a mark whose answer was lost by removing only that mark's play", async () => {
  const { cue, entry, earlier, wrapper } = await restarted();
  usePlayPolicy.setState({ policy: "multiple" });
  fake.drop({ method: "POST", path: HISTORY }, "after");
  const up = renderHook(useMarkWatched, { wrapper });
  await act(() => up.result.current.mark(entry));
  await act(() => up.result.current.reverse(SHOW));

  expect(await playsOf(cue, FIRST_EPISODE)).toEqual(earlier.map((play) => play.historyId));
});

it("removes nothing, and says so, when it cannot tell which play a lost mark added", async () => {
  const { cue, entry, wrapper } = await restarted();
  fake.drop({ method: "POST", path: HISTORY }, "after");
  const up = renderHook(useMarkWatched, { wrapper });
  await act(() => up.result.current.mark(entry));
  await act(() => up.result.current.reverse(SHOW));

  expect(await playsOf(cue, FIRST_EPISODE)).toHaveLength(2);
  expect(posts("/sync/history/remove")).toHaveLength(0);
  expect(useSnackbar.getState().snack?.message).toBe(
    `Couldn't undo ${entry.title}. Please try again.`,
  );
});

it("keeps the one play a lost mark replaced when the account keeps one play per episode", async () => {
  fake.reset({ multiplePlays: false });
  const { cue, entry, wrapper } = await restarted();
  fake.drop({ method: "POST", path: HISTORY }, "after");
  const up = renderHook(useMarkWatched, { wrapper });
  await act(() => up.result.current.mark(entry));
  await act(() => up.result.current.reverse(SHOW));

  expect(await playsOf(cue, FIRST_EPISODE)).toHaveLength(1);
  expect(posts("/sync/history/remove")).toHaveLength(0);
});

const TARGET = { showId: SHOW, ids: { trakt: SHOW }, includeSpecials: false };
const unwatched = (number: number, trakt: number) => ({
  season: 1,
  number,
  title: null,
  firstAired: "2025-01-01T00:00:00.000Z",
  ids: { trakt },
  stills: [],
  watched: false,
  watchedAt: null,
  aired: true,
});

it("undoes a show-screen mark whose answer was lost by removing only that mark's play", async () => {
  const { cue, earlier, wrapper } = await restarted();
  usePlayPolicy.setState({ policy: "multiple" });
  fake.drop({ method: "POST", path: HISTORY }, "after");
  const show = renderHook(useMarkSeason, { wrapper });
  await act(() =>
    show.result.current.toggleEpisode(TARGET, unwatched(1, FIRST_EPISODE), {
      undoLabel: "S1 E1 marked",
    }),
  );
  await act(() => pressUndo());

  expect(await playsOf(cue, FIRST_EPISODE)).toEqual(earlier.map((play) => play.historyId));
});

it("clears an episode tick whose mark's answer was lost by removing only that mark's play", async () => {
  const { cue, earlier, wrapper } = await restarted();
  fake.drop({ method: "POST", path: HISTORY }, "after");
  const show = renderHook(useMarkSeason, { wrapper });
  await act(() => show.result.current.toggleEpisode(TARGET, unwatched(1, FIRST_EPISODE)));
  await act(() =>
    show.result.current.toggleEpisode(TARGET, { ...unwatched(1, FIRST_EPISODE), watched: true }),
  );

  expect(await playsOf(cue, FIRST_EPISODE)).toEqual(earlier.map((play) => play.historyId));
});

it("undoes a catch-up whose answer was lost by removing only the plays it added", async () => {
  const { cue, wrapper } = await restarted();
  usePlayPolicy.setState({ policy: "multiple" });
  const before = [await playsOf(cue, FIRST_EPISODE), await playsOf(cue, SECOND_EPISODE)];
  const season: SeasonView = {
    number: 1,
    title: "Season 1",
    isSpecial: false,
    isHidden: false,
    episodes: [unwatched(1, FIRST_EPISODE), unwatched(2, SECOND_EPISODE)],
    airedCount: 2,
    completedCount: 0,
  };
  fake.drop({ method: "POST", path: HISTORY }, "after");
  const show = renderHook(useMarkSeason, { wrapper });
  await act(() => show.result.current.markUpToHere(TARGET, [season], { season: 1, number: 2 }));
  await act(() => pressUndo());

  expect([await playsOf(cue, FIRST_EPISODE), await playsOf(cue, SECOND_EPISODE)]).toEqual(before);
});

it("shows a mark Trakt refused later as not watched, however the library is read again", async () => {
  const cue = await distinctIds();
  const queryClient = createQueryClient();
  const library = await queryClient.fetchQuery(libraryQuery(cue));
  const entry = library.entries.find((candidate) => candidate.showId === SHOW);
  if (entry === undefined) throw new Error("the show needs to be in the library");
  fake.drop({ method: "POST", path: HISTORY });
  const up = renderHook(useMarkWatched, { wrapper: withRuntime(cue, queryClient) });
  await act(() => up.result.current.mark(entry));
  up.unmount();

  fake.fail({ method: "POST", path: HISTORY }, 404);
  await act(() => cue.flushWrites());
  await act(() => queryClient.refetchQueries({ queryKey: libraryQuery(cue).queryKey }));

  const reread = queryClient
    .getQueryData(libraryQuery(cue).queryKey)
    ?.entries.find((candidate) => candidate.showId === SHOW);
  expect(reread?.nextEpisode?.ids.trakt).toBe(NEXT_EPISODE);
  expect(reread?.completed).toBe(entry.completed);
});

/** No connection for the next `posts` history writes: none of them reaches Trakt. */
const offlineFor = (posts: number) =>
  fake.drop({ method: "POST", path: HISTORY, times: posts }, "before");

async function online(cue: CueRuntime): Promise<void> {
  await waited(() => cue.flushWrites());
}

async function libraryAt() {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(AT));
  const cue = await distinctIds();
  const queryClient = createQueryClient();
  const library = await queryClient.fetchQuery(libraryQuery(cue));
  const entry = library.entries.find((candidate) => candidate.showId === SHOW);
  if (entry === undefined) throw new Error("the show needs to be in the library");
  return { cue, queryClient, entry, wrapper: withRuntime(cue, queryClient) };
}

it("applies an Undo made offline once Trakt is reachable, so a new episode ends unwatched", async () => {
  const { cue, entry, wrapper } = await libraryAt();
  offlineFor(2);
  const up = renderHook(useMarkWatched, { wrapper });
  await waited(() => up.result.current.mark(entry));
  await waited(() => up.result.current.reverse(SHOW));
  await online(cue);

  expect(await cue.loadEpisodePlays(NEXT_EPISODE)).toEqual([]);
});

it.each([
  [true, 2],
  [false, 1],
])("keeps an episode's earlier play when an offline mark is undone and the account's play setting is unknown (Multiple Plays %s)", async (multiplePlays, plays) => {
  fake.reset({ multiplePlays });
  const { cue, queryClient, entry, wrapper } = await libraryAt();
  const again = {
    ...entry,
    completed: 0,
    nextEpisode: entry.nextEpisode && {
      ...entry.nextEpisode,
      season: 1,
      number: 1,
      ids: { trakt: FIRST_EPISODE },
    },
  };
  queryClient.setQueryData(
    libraryQuery(cue).queryKey,
    (data) =>
      data && { ...data, entries: data.entries.map((e) => (e.showId === SHOW ? again : e)) },
  );
  offlineFor(2);
  const up = renderHook(useMarkWatched, { wrapper });
  await waited(() => up.result.current.mark(again));
  await waited(() => up.result.current.reverse(SHOW));
  await online(cue);

  expect(await cue.loadEpisodePlays(FIRST_EPISODE)).toHaveLength(plays);
  expect(posts("/sync/history/remove")).toHaveLength(0);
});

const THIRD_SEASON = (number: number, trakt: number) => ({
  ...unwatched(number, trakt),
  season: 3,
});

it("applies a show-screen Undo made offline once Trakt is reachable", async () => {
  const { cue, wrapper } = await libraryAt();
  offlineFor(2);
  const show = renderHook(useMarkSeason, { wrapper });
  await waited(() =>
    show.result.current.toggleEpisode(TARGET, THIRD_SEASON(5, NEXT_EPISODE), {
      undoLabel: "S3 E5 marked",
    }),
  );
  await waited(() => pressUndo());
  await online(cue);

  expect(await cue.loadEpisodePlays(NEXT_EPISODE)).toEqual([]);
});

it("takes back the latest stored mark when an episode tick is cleared after a relaunch", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(AT));
  const ids = { trakt: NEXT_EPISODE };
  const first = buildMarkEpisodeOp({ opId: "first", ids, watchedAt: AT });
  const again = buildMarkEpisodeOp({ opId: "again", ids, watchedAt: "2026-09-10T12:01:00.000Z" });
  const stored = [first, buildUndoAddOp("undo", first), again];
  offlineFor(1);
  const cue = await distinctIds({
    kv: memoryKeyValueStore({ [OP_LOG_KEY]: JSON.stringify(stored) }),
  });
  const queryClient = createQueryClient();
  await queryClient.fetchQuery(libraryQuery(cue));
  const show = renderHook(useMarkSeason, { wrapper: withRuntime(cue, queryClient) });
  offlineFor(1);
  await waited(() =>
    show.result.current.toggleEpisode(TARGET, { ...THIRD_SEASON(5, NEXT_EPISODE), watched: true }),
  );
  await online(cue);

  expect(await cue.loadEpisodePlays(NEXT_EPISODE)).toEqual([]);
});

it("applies a catch-up Undo made offline once Trakt is reachable", async () => {
  const { cue, wrapper } = await libraryAt();
  const season: SeasonView = {
    number: 3,
    title: "Season 3",
    isSpecial: false,
    isHidden: false,
    episodes: [THIRD_SEASON(5, NEXT_EPISODE), THIRD_SEASON(6, NEXT_EPISODE + 1)],
    airedCount: 2,
    completedCount: 0,
  };
  offlineFor(2);
  const show = renderHook(useMarkSeason, { wrapper });
  await waited(() => show.result.current.markUpToHere(TARGET, [season], { season: 3, number: 6 }));
  await waited(() => pressUndo());
  await online(cue);

  expect([
    await cue.loadEpisodePlays(NEXT_EPISODE),
    await cue.loadEpisodePlays(NEXT_EPISODE + 1),
  ]).toEqual([[], []]);
});

it("undoes a mark whose answer was lost after it was sent again, for an episode never played before", async () => {
  const { cue, entry, wrapper } = await libraryAt();
  fake.drop({ method: "POST", path: HISTORY }, "after");
  const up = renderHook(useMarkWatched, { wrapper });
  await waited(() => up.result.current.mark(entry));
  await online(cue);
  expect(cue.writeState("op-1")).toBe("done");
  await waited(() => up.result.current.reverse(SHOW));
  await online(cue);

  expect(await cue.loadEpisodePlays(NEXT_EPISODE)).toEqual([]);
});

/** Another app signed in to the same account plays an episode or a movie at `watchedAt`. */
async function playedElsewhere(
  section: "episodes" | "movies",
  trakt: number,
  watchedAt: string,
): Promise<void> {
  const response = await fake.fetch("https://api.trakt.tv/sync/history", {
    method: "POST",
    headers: { authorization: `Bearer ${fake.session().access_token}` },
    body: JSON.stringify({ [section]: [{ ids: { trakt }, watched_at: watchedAt }] }),
  });
  if (response.status >= 300) throw new Error(`the other app's play answered ${response.status}`);
}

it("keeps the play another app made when an offline mark replaced it and the mark is undone", async () => {
  fake.reset({ multiplePlays: false });
  const { cue, entry, wrapper } = await libraryAt();
  await playedElsewhere("episodes", NEXT_EPISODE, "2026-09-09T20:00:00.000Z");
  offlineFor(2);
  const up = renderHook(useMarkWatched, { wrapper });
  await waited(() => up.result.current.mark(entry));
  await waited(() => up.result.current.reverse(SHOW));
  const said: unknown[] = [];
  const listening = useSnackbar.subscribe(({ snack }) => said.push(snack?.message));
  await online(cue);
  listening();

  expect(await cue.loadEpisodePlays(NEXT_EPISODE)).toHaveLength(1);
  expect(posts("/sync/history/remove")).toHaveLength(0);
  expect(said).toContain("Couldn't save an earlier change to Trakt.");
});

it("keeps the play a mark replaced when the app is relaunched before that mark's Undo is sent", async () => {
  fake.reset({ multiplePlays: false });
  await playedElsewhere("episodes", NEXT_EPISODE, "2026-09-09T20:00:00.000Z");
  const kv = memoryKeyValueStore();
  const release = fake.hold({ method: "POST", path: HISTORY });
  const cue = await buildRuntime({ kv });
  const mark = buildMarkEpisodeOp({ opId: "mark", ids: { trakt: NEXT_EPISODE }, watchedAt: AT });
  const marking = cue.submit(mark);
  await vi.waitFor(() => expect(cue.writeState("mark")).toBe("sent"));
  void cue.submit(buildStopShowOp("hidden", { opId: "hide", ids: { trakt: 8802 } }));
  void cue.submit(buildUndoAddOp("undo", mark));
  fake.drop({ method: "POST", path: HIDDEN });
  release();
  await marking;

  const relaunched = await buildRuntime({ kv });
  await relaunched.flushWrites();

  expect(relaunched.pendingWrites()).toBe(0);
  expect(await relaunched.loadEpisodePlays(NEXT_EPISODE)).toHaveLength(1);
  expect(posts("/sync/history/remove")).toHaveLength(0);
});

it("removes only the plays it found before it was first sent when an Undo whose answer was lost goes again", async () => {
  const { cue } = await libraryAt();
  const mark = buildMarkEpisodeOp({ opId: "mark", ids: { trakt: NEXT_EPISODE }, watchedAt: AT });
  await waited(() => cue.submit(mark));
  fake.drop({ method: "POST", path: /^\/sync\/history\/remove$/ }, "after");
  await waited(() => cue.submit(buildUndoAddOp("undo", mark)));
  await playedElsewhere("episodes", NEXT_EPISODE, AT);
  await online(cue);

  expect(await cue.loadEpisodePlays(NEXT_EPISODE)).toHaveLength(1);
  expect(cue.pendingWrites()).toBe(0);
});

it("marks an episode again after an offline Undo of its mark, so Trakt keeps the new mark", async () => {
  const { cue, entry, wrapper } = await libraryAt();
  offlineFor(3);
  const up = renderHook(useMarkWatched, { wrapper });
  await waited(() => up.result.current.mark(entry));
  await waited(() => up.result.current.reverse(SHOW));
  vi.setSystemTime(Date.now() + 60_000);
  const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  await waited(() => up.result.current.mark(entry));
  await online(cue);

  expect((await cue.loadEpisodePlays(NEXT_EPISODE)).map((play) => play.watchedAt)).toEqual([
    minute,
  ]);
  expect(cue.pendingWrites()).toBe(0);
});

it("takes back a mark while a read of its history begun before the mark is still answering", async () => {
  const cue = await buildRuntime();
  const releaseRead = fake.hold(
    { method: "GET", path: new RegExp(`^/sync/history/episodes/${NEXT_EPISODE}$`) },
    "after",
  );
  const early = cue.loadEpisodePlays(NEXT_EPISODE);
  const releaseMark = fake.hold({ method: "POST", path: HISTORY });
  const mark = buildMarkEpisodeOp({ opId: "mark", ids: { trakt: NEXT_EPISODE }, watchedAt: AT });
  const marking = cue.submit(mark);
  await vi.waitFor(() => expect(cue.writeState("mark")).toBe("sent"));
  const undoing = cue.submit(buildUndoAddOp("undo", mark));
  releaseMark();
  await vi.waitFor(() => expect(cue.writeState("undo")).not.toBe("unsent"));
  releaseRead();
  await Promise.all([marking, undoing, early]);
  await cue.flushWrites();

  expect(await cue.loadEpisodePlays(NEXT_EPISODE)).toEqual([]);
});

it("cancels every still-queued write of a folded Undo before any is sent, keeping earlier plays", async () => {
  const { cue, wrapper } = await restarted();
  const before = [await playsOf(cue, FIRST_EPISODE), await playsOf(cue, SECOND_EPISODE)];
  const release = fake.hold({ method: "POST", path: HIDDEN });
  void cue.submit(buildStopShowOp("hidden", { opId: "slow", ids: { trakt: 8802 } }));
  await vi.waitFor(() => expect(cue.writeState("slow")).toBe("sent"));
  const show = renderHook(useMarkSeason, { wrapper });
  act(
    () =>
      void show.result.current.toggleEpisode(TARGET, unwatched(1, FIRST_EPISODE), {
        undoLabel: "S1 E1 marked",
      }),
  );
  const season: SeasonView = {
    number: 1,
    title: "Season 1",
    isSpecial: false,
    isHidden: false,
    episodes: [{ ...unwatched(1, FIRST_EPISODE), watched: true }, unwatched(2, SECOND_EPISODE)],
    airedCount: 2,
    completedCount: 1,
  };
  act(
    () =>
      void show.result.current.markUpToHere(
        TARGET,
        [season],
        { season: 1, number: 2 },
        { absorbUndo: true },
      ),
  );
  await act(async () => {
    const undone = pressUndo();
    release();
    await undone;
  });
  await cue.flushWrites();

  expect([await playsOf(cue, FIRST_EPISODE), await playsOf(cue, SECOND_EPISODE)]).toEqual(before);
});

it("takes back a movie mark by removing only that mark's play", async () => {
  const { cue } = await libraryAt();
  const earlier = "2026-09-09T20:00:00.000Z";
  await playedElsewhere("movies", 5503, earlier);
  const mark = buildMarkMovieOp({ opId: "mark", ids: { trakt: 5503 }, watchedAt: AT });
  await waited(() => cue.submit(mark));
  await waited(() => cue.submit(buildUndoAddOp("undo", mark)));

  expect((await cue.loadMoviePlays(5503)).map((play) => play.watchedAt)).toEqual([earlier]);
});
