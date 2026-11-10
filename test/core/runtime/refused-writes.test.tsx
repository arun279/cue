// @vitest-environment jsdom
/**
 * What the screen shows once Trakt refuses a write: the app says so, reads back from Trakt what the
 * write changed, and keeps the write on the device until that read has landed. The app's root, as
 * mounted here, is what corrects the screen; the screen that made the write may be long gone.
 */

import { IsRestoringProvider, type QueryClient, useQuery } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "@/core/data/query-keys";
import type { LibraryEntry } from "@/core/domain/model/library";
import type { MovieEntry } from "@/core/domain/model/movie";
import { useActivitiesPoll } from "@/core/hooks/useActivitiesPoll";
import { useHideShow } from "@/core/hooks/useHideShow";
import { useMarkSeason } from "@/core/hooks/useMarkSeason";
import { useMarkWatched } from "@/core/hooks/useMarkWatched";
import { useSetWatchlisted } from "@/core/hooks/useSetWatchlisted";
import type { KeyValueStore } from "@/core/ports/kv";
import { OP_LOG_KEY } from "@/core/ports/storage-keys";
import { libraryQuery, movieWatchlistQuery } from "@/core/queries/library";
import { showSeasonsQuery } from "@/core/queries/shows";
import { createQueryClient } from "@/core/runtime/query-cache";
import { type CueRuntime, forScreens, type UpNextData, useRuntime } from "@/core/runtime/runtime";
import { resetMarkStore } from "@/core/stores/mark-store";
import { dismissSnack, snackText, useSnackbar } from "@/core/stores/snackbar-store";
import { buildRuntime } from "../data/_runtime";
import { waited } from "../support/queue-time";
import { withRuntime } from "../support/runtime";
import { memoryKeyValueStore } from "../support/stores";
import { defaultAccount, libraryShow, type ShowSpec } from "../trakt-fake/account.ts";
import { startTraktFake } from "../trakt-fake/in-process.ts";

const LONG_RUN = 8999;
const longRun: ShowSpec = {
  trakt: LONG_RUN,
  tmdb: LONG_RUN + 90_000,
  slug: "long-run",
  title: "Long Run",
  year: 2004,
  status: "ended",
  network: null,
  runtime: 22,
  genres: ["comedy"],
  overview: "One season longer than a single write to Trakt can carry.",
  seasons: [150],
  startDaysAgo: 1200,
  completed: 0,
  lastWatchedDaysAgo: null,
};

const fake = startTraktFake({
  account: (multiplePlays) => {
    const account = defaultAccount(multiplePlays);
    return { ...account, shows: [...account.shows, libraryShow(longRun, account.now)] };
  },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  shown.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  resetMarkStore();
  dismissSnack();
});

const SHOW = 8801;
const NEW_SHOW = 8901;
const STOPPED_SHOW = 8805;
const NEW_MOVIE = 5601;
const HIDDEN = /^\/users\/hidden\/progress_watched$/;
const HISTORY = /^\/sync\/history$/;
const WATCHLIST = /^\/sync\/watchlist$/;
const EARLIER = "Couldn't save an earlier change to Trakt.";

let made = 0;
const launch = (kv: KeyValueStore = memoryKeyValueStore()) =>
  buildRuntime({
    kv,
    newId: () => {
      made += 1;
      return `op-${made}`;
    },
  });

/** The app starts again on the same device: its memory is gone, its storage and cache are kept. */
function relaunch(kv: KeyValueStore): Promise<CueRuntime> {
  resetMarkStore();
  dismissSnack();
  return launch(kv);
}

/** Every message the snackbar showed in this test, kept past its timeout. */
const shown: string[] = [];
useSnackbar.subscribe(({ snack }) => {
  if (snack !== null) shown.push(snackText(snack.message));
});
const posts = (path: RegExp) =>
  fake.requests.filter((request) => request.method === "POST" && path.test(request.path));

async function cached(cue: CueRuntime) {
  const queryClient = createQueryClient();
  await queryClient.fetchQuery(libraryQuery(cue));
  const entry = (showId: number) =>
    queryClient
      .getQueryData<UpNextData>(queryKeys.library())
      ?.entries.find((candidate) => candidate.showId === showId);
  return { queryClient, entry };
}

/** What the app keeps mounted at its root for as long as a session lasts. */
const mountRoot = (cue: CueRuntime, queryClient: QueryClient) =>
  renderHook(useActivitiesPoll, { wrapper: withRuntime(forScreens(cue), queryClient) });

/** Stops watching the show while offline, from a screen that is then closed. */
async function stoppedOffline(cue: CueRuntime, queryClient: QueryClient): Promise<void> {
  fake.drop({ method: "POST", path: HIDDEN }, "before");
  const screen = renderHook(useHideShow, { wrapper: withRuntime(forScreens(cue), queryClient) });
  await act(() => screen.result.current.hide(SHOW, { trakt: SHOW }, "Harbor Lights"));
  screen.unmount();
}

const hiddenOnTrakt = async (): Promise<number[]> =>
  (await (await fake.peek("/users/hidden/progress_watched")).json()).map(
    (row: { show: { ids: { trakt: number } } }) => row.show.ids.trakt,
  );

it("reads a write back and says so when Trakt refuses it after the app restarted", async () => {
  const kv = memoryKeyValueStore();
  const { queryClient, entry } = await cached(await launch(kv));
  await stoppedOffline(await launch(kv), queryClient);
  expect(entry(SHOW)?.hidden).toBe(true);

  fake.fail({ method: "POST", path: HIDDEN }, 404);
  const relaunched = await relaunch(kv);
  mountRoot(relaunched, queryClient);

  await vi.waitFor(() => expect(entry(SHOW)?.hidden).toBe(false));
  expect(shown).toContain(EARLIER);
  await vi.waitFor(() => expect(kv.values.get(OP_LOG_KEY)).toBe("[]"));
});

it("keeps a refused write until it is read back, so the next launch still corrects the screen", async () => {
  const kv = memoryKeyValueStore();
  const first = await launch(kv);
  const { queryClient, entry } = await cached(first);
  await stoppedOffline(first, queryClient);

  fake.fail({ method: "POST", path: HIDDEN }, 404);
  const refusing = await relaunch(kv);
  await waited(() => refusing.flushWrites());
  expect(entry(SHOW)?.hidden).toBe(true);

  mountRoot(await relaunch(kv), queryClient);

  await vi.waitFor(() => expect(entry(SHOW)?.hidden).toBe(false));
  await vi.waitFor(() => expect(kv.values.get(OP_LOG_KEY)).toBe("[]"));
  expect(await hiddenOnTrakt()).not.toContain(SHOW);
});

it("reads a refused write back only once the saved cache has been restored", async () => {
  const kv = memoryKeyValueStore();
  const first = await launch(kv);
  const { queryClient, entry } = await cached(first);
  await stoppedOffline(first, queryClient);
  fake.fail({ method: "POST", path: HIDDEN }, 404);
  const relaunched = await relaunch(kv);
  const Session = withRuntime(forScreens(relaunched), queryClient);
  let restoring = true;
  const root = renderHook(useActivitiesPoll, {
    wrapper: ({ children }) => (
      <Session>
        <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>
      </Session>
    ),
  });
  await waited(() => relaunched.flushWrites());
  expect(entry(SHOW)?.hidden).toBe(true);

  restoring = false;
  root.rerender();

  await vi.waitFor(() => expect(entry(SHOW)?.hidden).toBe(false));
});

it("never sends a write it could not keep on the device, and shows what Trakt has", async () => {
  const base = memoryKeyValueStore();
  let full = false;
  const kv: KeyValueStore = {
    ...base,
    write: (key, value) =>
      full && key === OP_LOG_KEY ? Promise.reject(new Error("disk full")) : base.write(key, value),
  };
  const cue = await launch(kv);
  const { queryClient, entry } = await cached(cue);
  mountRoot(cue, queryClient);
  const screen = renderHook(useHideShow, { wrapper: withRuntime(forScreens(cue), queryClient) });

  full = true;
  await act(() => screen.result.current.hide(SHOW, { trakt: SHOW }, "Harbor Lights"));
  full = false;
  await act(() => cue.flushWrites());

  expect(posts(HIDDEN)).toHaveLength(0);
  await vi.waitFor(() => expect(entry(SHOW)?.hidden).toBe(false));
  expect(shown).toEqual(["Couldn't stop watching Harbor Lights. Please try again."]);
});

it("keeps later changes to a new watchlist entry when Trakt refuses adding it", async () => {
  const cue = await launch();
  const { queryClient, entry } = await cached(cue);
  mountRoot(cue, queryClient);
  const screen = renderHook(() => ({ list: useSetWatchlisted(), shows: useHideShow() }), {
    wrapper: withRuntime(forScreens(cue), queryClient),
  });
  const ids = { trakt: NEW_SHOW };
  fake.drop({ method: "POST", path: WATCHLIST, times: 2 }, "before");
  const title = {
    type: "show" as const,
    traktId: NEW_SHOW,
    ids,
    title: "The Harbor Master",
    year: 2011,
  };
  await waited(() => screen.result.current.list({ ...title, posters: [], tmdbId: null }, true));
  await waited(() => screen.result.current.shows.hide(NEW_SHOW, ids, "The Harbor Master"));
  expect(entry(NEW_SHOW)?.hidden).toBe(true);

  fake.fail({ method: "POST", path: WATCHLIST }, 404);
  const release = fake.hold({ method: "POST", path: HIDDEN });
  const flushing = cue.flushWrites();
  await act(() => vi.advanceTimersByTimeAsync(2_000));

  expect(shown).toContain(EARLIER);
  expect(entry(NEW_SHOW)).toMatchObject({ hidden: true });
  release();
  await waited(() => flushing);
  expect(entry(NEW_SHOW)).toBeUndefined();
});

/** The episodes of the long run's first season Trakt counts as watched. */
const watchedOnTrakt = async (): Promise<number[]> =>
  (await (await fake.peek(`/shows/${LONG_RUN}/progress/watched`)).json()).seasons[0].episodes
    .filter((episode: { completed: boolean }) => episode.completed)
    .map((episode: { number: number }) => episode.number);

it("reads back a refused part of a long season write while the other part is still unanswered", async () => {
  const cue = await launch();
  const { queryClient } = await cached(cue);
  mountRoot(cue, queryClient);
  const screen = renderHook(
    () => ({
      marks: useMarkSeason(),
      seasons: useQuery(showSeasonsQuery(forScreens(cue), LONG_RUN)),
    }),
    { wrapper: withRuntime(forScreens(cue), queryClient) },
  );
  await vi.waitFor(() => expect(screen.result.current.seasons.data).toBeDefined());
  const watched = () =>
    (screen.result.current.seasons.data?.find((season) => season.number === 1)?.episodes ?? [])
      .filter((episode) => episode.watched)
      .map((episode) => episode.number);
  const season = screen.result.current.seasons.data?.find((candidate) => candidate.number === 1);
  if (season === undefined) throw new Error("the long run needs its first season");
  const target = { showId: LONG_RUN, ids: { trakt: LONG_RUN }, includeSpecials: false };
  fake.drop({ method: "POST", path: HISTORY }, "before");
  await waited(() => screen.result.current.marks.markSeason(target, season));
  expect(watched()).toHaveLength(150);

  fake.fail({ method: "POST", path: HISTORY }, 422);
  fake.drop({ method: "POST", path: HISTORY }, "before");
  await waited(() => cue.flushWrites());

  expect(shown).toContain(EARLIER);
  expect(watched()).toEqual(await watchedOnTrakt());
  await waited(() => cue.flushWrites());
  expect(watched()).toEqual(await watchedOnTrakt());
});

it("shows a show resumed, as Trakt has it, when the Undo of the mark that resumed it is refused", async () => {
  const cue = await launch();
  const { queryClient, entry } = await cached(cue);
  mountRoot(cue, queryClient);
  const stopped = entry(STOPPED_SHOW);
  if (stopped?.hidden !== true) throw new Error("the account needs a stopped show to resume");
  const upNext = renderHook(useMarkWatched, { wrapper: withRuntime(forScreens(cue), queryClient) });
  await waited(() => upNext.result.current.mark(stopped));
  fake.fail({ method: "POST", path: /^\/sync\/history\/remove$/ }, 404);
  await waited(() => upNext.result.current.reverse(STOPPED_SHOW));

  expect(shown).toContain(`Couldn't undo ${stopped.title}. Please try again.`);
  expect(entry(STOPPED_SHOW)?.hidden).toBe(false);
  expect(await hiddenOnTrakt()).not.toContain(STOPPED_SHOW);
});

it("reads the movie lists back when Trakt refuses adding a movie to the watchlist", async () => {
  const cue = await launch();
  const queryClient = createQueryClient();
  await queryClient.fetchQuery(movieWatchlistQuery(cue));
  mountRoot(cue, queryClient);
  const list = renderHook(useSetWatchlisted, {
    wrapper: withRuntime(forScreens(cue), queryClient),
  });
  const movie = {
    type: "movie" as const,
    traktId: NEW_MOVIE,
    ids: { trakt: NEW_MOVIE },
    year: 2015,
  };
  fake.fail({ method: "POST", path: WATCHLIST }, 404);
  await waited(() =>
    list.result.current({ ...movie, title: "Harbor Sound", posters: [], tmdbId: null }, true),
  );

  expect(
    queryClient
      .getQueryData<readonly MovieEntry[]>(queryKeys.movieWatchlist())
      ?.map((entry) => entry.movieId),
  ).not.toContain(NEW_MOVIE);
});

type Step = "mark" | "undo" | "refuse" | "offline" | "restart";
const STEPS: readonly Step[] = ["mark", "undo", "refuse", "offline", "restart"];
const ACTIVITIES_POLL_MS = 60_000;
const HISTORY_WRITES = /^\/sync\/history(\/remove)?$/;
const progressOf = (shown: LibraryEntry | undefined) => ({
  completed: shown?.completed,
  next: shown?.nextEpisode?.ids.trakt,
});

it("shows what Trakt has once every write has settled, after any run of marks, Undo presses, refusals and restarts", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  await fc.assert(
    fc.asyncProperty(fc.array(fc.constantFrom(...STEPS), { maxLength: 8 }), async (steps) => {
      fake.reset();
      resetMarkStore();
      const kv = memoryKeyValueStore();
      let cue = await launch(kv);
      const { queryClient, entry } = await cached(cue);
      const mount = (runtime: CueRuntime) =>
        renderHook(
          () => {
            useActivitiesPoll();
            useQuery(libraryQuery(useRuntime()));
            return useMarkWatched();
          },
          { wrapper: withRuntime(forScreens(runtime), queryClient) },
        );
      let screen = mount(cue);
      const run: Record<Step, () => Promise<unknown>> = {
        mark: () =>
          waited(async () => {
            const shown = entry(SHOW);
            if (shown !== undefined) await screen.result.current.mark(shown);
          }),
        undo: () => waited(() => screen.result.current.reverse(SHOW)),
        refuse: async () => fake.fail({ method: "POST", path: HISTORY_WRITES }, 422),
        offline: async () => fake.drop({ method: "POST", path: HISTORY_WRITES }, "before"),
        restart: async () => {
          await waited(() => Promise.resolve());
          screen.unmount();
          cue = await relaunch(kv);
          screen = mount(cue);
        },
      };
      for (const step of steps) await run[step]();
      for (let flush = 0; flush < 4; flush += 1) await waited(() => cue.flushWrites());
      await act(() => vi.advanceTimersByTimeAsync(ACTIVITIES_POLL_MS));

      const onTrakt = (await cue.loadUpNext()).entries.find((show) => show.showId === SHOW);
      expect(progressOf(entry(SHOW))).toEqual(progressOf(onTrakt));
      screen.unmount();
    }),
    { numRuns: 100 },
  );
}, 60_000);
