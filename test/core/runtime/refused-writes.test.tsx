// @vitest-environment jsdom
/**
 * What the screen shows once Trakt refuses a write: the app says so, reads back from Trakt what the
 * write changed, and keeps the write on the device until that read has landed. The app's root, as
 * mounted here, is what corrects the screen; the screen that made the write may be long gone.
 */

import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  IsRestoringProvider,
  onlineManager,
  type QueryClient,
  useQuery,
} from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from "@tanstack/react-query-persist-client";
import { act, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "@/core/data/query-keys";
import type { EpisodeDetail } from "@/core/domain/episode-detail";
import type { LibraryEntry } from "@/core/domain/model/library";
import type { MovieEntry } from "@/core/domain/model/movie";
import type { SeasonView } from "@/core/domain/show-detail";
import {
  buildAddWatchlistOp,
  buildMarkEpisodeOp,
  buildMarkMovieOp,
  buildRemoveWatchlistOp,
  buildStopShowOp,
} from "@/core/domain/write-queue/ops";
import { useActivitiesPoll } from "@/core/hooks/useActivitiesPoll";
import { useHideShow } from "@/core/hooks/useHideShow";
import { useMarkSeason } from "@/core/hooks/useMarkSeason";
import { useMarkWatched } from "@/core/hooks/useMarkWatched";
import { useOptimisticWrite } from "@/core/hooks/useOptimisticWrite";
import { useRefusedWrites } from "@/core/hooks/useRefusedWrites";
import { useSetWatchlisted } from "@/core/hooks/useSetWatchlisted";
import type { KeyValueStore } from "@/core/ports/kv";
import { OP_LOG_KEY } from "@/core/ports/storage-keys";
import { libraryQuery, movieLibraryQuery, movieWatchlistQuery } from "@/core/queries/library";
import { episodeQuery, showProgressQuery, showSeasonsQuery } from "@/core/queries/shows";
import {
  createQueryCachePolicy,
  createQueryClient,
  writeQueryCache,
} from "@/core/runtime/query-cache";
import { REFUSED_MESSAGE } from "@/core/runtime/refusals";
import { type CueRuntime, forScreens, type UpNextData, useRuntime } from "@/core/runtime/runtime";
import { resetMarkStore } from "@/core/stores/mark-store";
import { dismissSnack, snackText, useSnackbar } from "@/core/stores/snackbar-store";
import { buildRuntime } from "../data/_runtime";
import { waited } from "../support/queue-time";
import { withRuntime } from "../support/runtime";
import { type MemoryKeyValueStore, memoryKeyValueStore } from "../support/stores";
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
const MOVIE = 5503;
const REWATCHED_SHOW = 8806;
const AT = "2026-10-14T12:00:00.000Z";
const CACHE_KEY = "cue.query-cache";
const HIDDEN = /^\/users\/hidden\/progress_watched$/;
const HISTORY = /^\/sync\/history$/;
const WATCHLIST = /^\/sync\/watchlist$/;

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

/** What the app keeps mounted at its root for as long as a session lasts, Up Next among it. */
const mountRoot = (
  cue: CueRuntime,
  queryClient: QueryClient,
  saveCache: () => Promise<void> = async () => {},
) =>
  renderHook(
    () => {
      useActivitiesPoll();
      useRefusedWrites(saveCache);
      useQuery(libraryQuery(useRuntime()));
    },
    { wrapper: withRuntime(forScreens(cue), queryClient) },
  );

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
  expect(shown).toContain(REFUSED_MESSAGE);
  await vi.waitFor(() => expect(kv.values.get(OP_LOG_KEY)).toBe("[]"));
});

it("keeps a refused write until it is read back, so the next launch still corrects the screen", async () => {
  const { kv, queryClient, entry } = await refusedAfterRestart();
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
  const root = renderHook(() => useRefusedWrites(async () => {}), {
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
  expect(shown).toEqual([REFUSED_MESSAGE]);
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

  expect(shown).toContain(REFUSED_MESSAGE);
  expect(entry(NEW_SHOW)).toMatchObject({ hidden: true });
  release();
  await waited(() => flushing);
  expect(entry(NEW_SHOW)).toBeUndefined();
});

/** The long run's show screen: its first season as the screen shows it, and its season mark. */
async function longRunScreen() {
  const cue = await launch();
  const { queryClient } = await cached(cue);
  mountRoot(cue, queryClient);
  const wrapper = withRuntime(forScreens(cue), queryClient);
  const marks = renderHook(useMarkSeason, { wrapper }).result;
  renderHook(() => useQuery(showSeasonsQuery(useRuntime(), LONG_RUN)), { wrapper });
  const first = () =>
    queryClient
      .getQueryData<readonly SeasonView[]>(queryKeys.showSeasons(LONG_RUN))
      ?.find((season) => season.number === 1);
  await vi.waitFor(() => expect(first()).toBeDefined());
  const season = first();
  if (season === undefined) throw new Error("the long run needs its first season");
  const target = { showId: LONG_RUN, ids: { trakt: LONG_RUN }, includeSpecials: false };
  return {
    flush: () => cue.flushWrites(),
    mark: () => marks.current.markSeason(target, season),
    watched: () => (first()?.episodes ?? []).filter((e) => e.watched).map((e) => e.number),
  };
}

/** Stops the app now, lets held requests through, and starts it again from what it had saved. */
async function stopAndRelaunch(kv: MemoryKeyValueStore, release: () => void): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(0));
  const atStop = copyOf(kv);
  release();
  const relaunched = await relaunch(atStop);
  await waited(() => relaunched.flushWrites());
}

/** The episodes of the long run's first season Trakt counts as watched. */
const watchedOnTrakt = async (): Promise<number[]> =>
  (await (await fake.peek(`/shows/${LONG_RUN}/progress/watched`)).json()).seasons[0].episodes
    .filter((episode: { completed: boolean }) => episode.completed)
    .map((episode: { number: number }) => episode.number);

it("reads back a refused part of a long season write while the other part is still unanswered", async () => {
  const { flush, mark, watched } = await longRunScreen();
  fake.drop({ method: "POST", path: HISTORY }, "before");
  await waited(mark);
  expect(watched()).toHaveLength(150);

  fake.fail({ method: "POST", path: HISTORY }, 422);
  fake.drop({ method: "POST", path: HISTORY }, "before");
  await waited(flush);

  expect(shown).toContain(REFUSED_MESSAGE);
  expect(watched()).toEqual(await watchedOnTrakt());
  await waited(flush);
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

  expect(shown).toContain(REFUSED_MESSAGE);
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

type Step = "mark" | "undo" | "season" | "unmark" | "rewatch" | "refuse" | "offline" | "restart";
const STEPS: readonly Step[] = [
  "mark",
  "undo",
  "season",
  "unmark",
  "rewatch",
  "refuse",
  "offline",
  "restart",
];
const ACTIVITIES_POLL_MS = 60_000;
const HISTORY_WRITES = /^\/sync\/history(\/remove)?$/;
const progressOf = (shown: LibraryEntry | undefined) => ({
  completed: shown?.completed,
  next: shown?.nextEpisode?.ids.trakt,
});
const ticksOf = (seasons: readonly SeasonView[] | undefined) =>
  seasons?.map((season) => season.episodes.map((episode) => episode.watched));

it("shows what Trakt has once every write has settled, after any run of marks, Undo presses, season writes, refusals and restarts", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const target = { showId: SHOW, ids: { trakt: SHOW }, includeSpecials: false };
  await fc.assert(
    fc.asyncProperty(fc.array(fc.constantFrom(...STEPS), { maxLength: 8 }), async (steps) => {
      fake.reset();
      resetMarkStore();
      const kv = memoryKeyValueStore();
      let cue = await launch(kv);
      const { queryClient, entry } = await cached(cue);
      const seasons = () =>
        queryClient.getQueryData<readonly SeasonView[]>(queryKeys.showSeasons(SHOW));
      const mount = (runtime: CueRuntime) =>
        renderHook(
          () => {
            useActivitiesPoll();
            useRefusedWrites(noSave);
            useQuery(libraryQuery(useRuntime()));
            useQuery(showSeasonsQuery(useRuntime(), SHOW));
            return { up: useMarkWatched(), show: useMarkSeason() };
          },
          { wrapper: withRuntime(forScreens(runtime), queryClient) },
        );
      let screen = mount(cue);
      await vi.waitFor(() => expect(seasons()).toBeDefined());
      const onThird = (write: (season: SeasonView) => Promise<void>) =>
        waited(async () => {
          const third = seasons()?.find((season) => season.number === 3);
          if (third !== undefined) await write(third);
        });
      const run: Record<Step, () => Promise<unknown>> = {
        mark: () =>
          waited(async () => {
            const shown = entry(SHOW);
            if (shown !== undefined) await screen.result.current.up.mark(shown);
          }),
        undo: () => waited(() => screen.result.current.up.reverse(SHOW)),
        season: () => onThird((third) => screen.result.current.show.markSeason(target, third)),
        unmark: () => onThird((third) => screen.result.current.show.unmarkSeason(target, third)),
        rewatch: () => onThird((third) => screen.result.current.show.rewatchSeason(target, third)),
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
      expect(ticksOf(seasons())).toEqual(ticksOf(await cue.loadShowSeasons(SHOW)));
      screen.unmount();
    }),
    { numRuns: 100, seed: 2026 },
  );
}, 120_000);

const noSave = async (): Promise<void> => undefined;

const savedLog = (kv: { readonly values: Map<string, string> }): { id: string; refused?: true }[] =>
  JSON.parse(kv.values.get(OP_LOG_KEY) ?? "[]");
const copyOf = (kv: { readonly values: Map<string, string> }) =>
  memoryKeyValueStore(Object.fromEntries(kv.values));

it("keeps two opposite writes cancelled when the app stops while an earlier write is unanswered", async () => {
  const kv = memoryKeyValueStore();
  const cue = await launch(kv);
  const release = fake.hold({ method: "POST", path: HIDDEN });
  void cue.submit(buildStopShowOp("hidden", { opId: "earlier", ids: { trakt: SHOW } }));
  const title = { section: "shows", ids: { trakt: NEW_SHOW } } as const;
  void cue.submit(buildAddWatchlistOp({ opId: "add", ...title }));
  await act(() => vi.advanceTimersByTimeAsync(0));
  void cue.submit(buildRemoveWatchlistOp({ opId: "remove", ...title }));
  await stopAndRelaunch(kv, release);

  expect(posts(WATCHLIST)).toHaveLength(0);
});

it("never sends a refused write again when the app stops before the writes behind it are answered", async () => {
  const kv = memoryKeyValueStore();
  const cue = await launch(kv);
  fake.fail({ method: "POST", path: HIDDEN }, 404);
  const release = fake.hold({ method: "POST", path: WATCHLIST });
  void cue.submit(buildStopShowOp("hidden", { opId: "refused", ids: { trakt: SHOW } }));
  void cue.submit(
    buildAddWatchlistOp({ opId: "behind", section: "shows", ids: { trakt: NEW_SHOW } }),
  );
  await vi.waitFor(() => expect(cue.writeState("refused")).toBe("failed"));
  await stopAndRelaunch(kv, release);

  expect(posts(HIDDEN)).toHaveLength(1);
});

it("keeps a refused write until its correction is saved with the query cache, so a restart shows it", async () => {
  const kv = memoryKeyValueStore();
  const disk = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  };
  const persister = createAsyncStoragePersister({ storage, key: CACHE_KEY });
  const session = async (cache: Map<string, string>) => {
    const queryClient = createQueryClient();
    disk.clear();
    for (const [key, value] of cache) disk.set(key, value);
    await persistQueryClientRestore({ queryClient, persister });
    const { shouldDehydrateQuery } = createQueryCachePolicy(queryClient);
    persistQueryClientSubscribe({
      queryClient,
      persister,
      dehydrateOptions: { shouldDehydrateQuery },
    });
    const save = () => writeQueryCache(queryClient, storage, CACHE_KEY, "");
    const entry = (showId: number) =>
      queryClient
        .getQueryData<UpNextData>(queryKeys.library())
        ?.entries.find((e) => e.showId === showId);
    return { queryClient, save, entry };
  };
  const first = await launch(kv);
  const before = await session(new Map());
  await act(() => before.queryClient.fetchQuery(libraryQuery(first)).then(() => undefined));
  await stoppedOffline(first, before.queryClient);
  await act(() => vi.advanceTimersByTimeAsync(2_000));

  fake.fail({ method: "POST", path: HIDDEN }, 404);
  const refusing = await relaunch(kv);
  const during = await session(new Map(disk));
  mountRoot(refusing, during.queryClient, during.save);
  await vi.waitFor(() => expect(savedLog(kv)).toEqual([]), { interval: 5 });
  const atStop = { kv: copyOf(kv), cache: new Map(disk) };

  const relaunched = await relaunch(atStop.kv);
  const after = await session(atStop.cache);
  mountRoot(relaunched, after.queryClient);

  await vi.waitFor(() => expect(after.entry(SHOW)?.hidden).toBe(false));
});

it("keeps a refused write while Trakt cannot be read, and reads it back at the next sync", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const kv = memoryKeyValueStore();
  const first = await launch(kv);
  const { queryClient, entry } = await cached(first);
  await stoppedOffline(first, queryClient);
  fake.fail({ method: "POST", path: HIDDEN }, 404);
  fake.fail({ method: "GET", path: HIDDEN, times: 3 }, 500);

  mountRoot(await relaunch(kv), queryClient);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(savedLog(kv)).toEqual([expect.objectContaining({ refused: true })]);
  expect(entry(SHOW)?.hidden).toBe(true);

  await act(() => vi.advanceTimersByTimeAsync(ACTIVITIES_POLL_MS));
  expect(entry(SHOW)?.hidden).toBe(false);
  expect(savedLog(kv)).toEqual([]);
});

it("says at once that Trakt refused part of a long season write, while the rest is unanswered", async () => {
  const { mark } = await longRunScreen();
  fake.fail({ method: "POST", path: HISTORY }, 422);
  const release = fake.hold({ method: "POST", path: HISTORY });
  const marking = mark();
  await act(() => vi.advanceTimersByTimeAsync(5_000));

  expect(shown.filter((message) => message === REFUSED_MESSAGE)).toHaveLength(1);
  release();
  await waited(() => marking);
  expect(shown.filter((message) => message === REFUSED_MESSAGE)).toHaveLength(1);
});

it("reads back every show a write saved by an earlier build may have changed when Trakt refuses it", async () => {
  const stored = buildMarkEpisodeOp({ opId: "old", ids: { trakt: 880120 }, watchedAt: AT });
  const kv = memoryKeyValueStore({ [OP_LOG_KEY]: JSON.stringify([stored]) });
  fake.drop({ method: "POST", path: HISTORY }, "before");
  const cue = await launch(kv);
  const { queryClient } = await cached(cue);
  const seasons = renderHook(() => useQuery(showSeasonsQuery(forScreens(cue), SHOW)), {
    wrapper: withRuntime(forScreens(cue), queryClient),
  });
  await vi.waitFor(() => expect(seasons.result.current.data).toBeDefined());
  const ticked = () =>
    queryClient
      .getQueryData<readonly SeasonView[]>(queryKeys.showSeasons(SHOW))
      ?.find((season) => season.number === 3)?.episodes[4]?.watched;
  act(() =>
    queryClient.setQueryData(
      queryKeys.showSeasons(SHOW),
      (old: typeof seasons.result.current.data) =>
        old?.map((season) => ({
          ...season,
          episodes: season.episodes.map((episode) => ({ ...episode, watched: true })),
        })),
    ),
  );
  expect(ticked()).toBe(true);

  fake.fail({ method: "POST", path: HISTORY }, 404);
  const relaunched = await relaunch(kv);
  mountRoot(relaunched, queryClient);
  await waited(() => relaunched.flushWrites());

  await vi.waitFor(() => expect(ticked()).toBe(false));
});

it("shows a movie mark Trakt refused as not watched", async () => {
  const cue = await launch();
  const queryClient = createQueryClient();
  await queryClient.fetchQuery(movieLibraryQuery(cue));
  mountRoot(cue, queryClient);
  const watched = () =>
    queryClient
      .getQueryData<{ entries: readonly MovieEntry[] }>(queryKeys.movieLibrary())
      ?.entries.find((movie) => movie.movieId === MOVIE)?.watched;
  const writes = renderHook(useOptimisticWrite, {
    wrapper: withRuntime(forScreens(cue), queryClient),
  });
  queryClient.setQueryData<{ entries: readonly MovieEntry[] }>(
    queryKeys.movieLibrary(),
    (old) =>
      old && {
        entries: old.entries.map((movie) =>
          movie.movieId === MOVIE ? { ...movie, watched: true } : movie,
        ),
      },
  );
  fake.fail({ method: "POST", path: HISTORY }, 404);
  const mark = buildMarkMovieOp({ opId: "movie", ids: { trakt: MOVIE }, watchedAt: AT });
  await waited(() => writes.result.current({ kind: "movie", id: MOVIE }, [mark]));

  await vi.waitFor(() => expect(watched()).toBe(false));
  expect(shown).toContain(REFUSED_MESSAGE);
});

it("shows a rewatched episode at its newest play when Trakt refuses removing that play", async () => {
  const cue = await launch();
  const { queryClient } = await cached(cue);
  mountRoot(cue, queryClient);
  const wrapper = withRuntime(forScreens(cue), queryClient);
  renderHook(() => useQuery(episodeQuery(useRuntime(), REWATCHED_SHOW, 1, 9)), { wrapper });
  const show = renderHook(useMarkSeason, { wrapper });
  const page = () =>
    queryClient.getQueryData<EpisodeDetail>(queryKeys.episode(REWATCHED_SHOW, 1, 9));
  await vi.waitFor(() => expect(page()).toBeDefined());
  const shown = page();
  if (shown === undefined) throw new Error("the rewatched episode needs its page");
  fake.fail({ method: "POST", path: /^\/sync\/history\/remove$/ }, 404);
  const target = { showId: REWATCHED_SHOW, ids: { trakt: REWATCHED_SHOW }, includeSpecials: false };
  await waited(() =>
    show.result.current.toggleEpisode(
      target,
      { ...shown, season: 1, number: 9 },
      { knownPlays: 2 },
    ),
  );

  const onTrakt = await cue.loadEpisode(REWATCHED_SHOW, 1, 9);
  await vi.waitFor(() => expect(page()?.watchedAt).toBe(onTrakt.watchedAt));
  expect(page()?.watched).toBe(true);
});

it("says once that Trakt refused a long season write, however many of its parts it refused", async () => {
  const { mark } = await longRunScreen();
  fake.fail({ method: "POST", path: HISTORY, times: 2 }, 422);
  await waited(mark);

  expect(posts(HISTORY)).toHaveLength(2);
  expect(shown.filter((message) => message === REFUSED_MESSAGE)).toHaveLength(1);
});

/** Stops the show offline, then has Trakt refuse it after a restart, with no root yet to read it back. */
async function refusedAfterRestart() {
  const kv = memoryKeyValueStore();
  const first = await launch(kv);
  const { queryClient, entry } = await cached(first);
  await stoppedOffline(first, queryClient);
  fake.fail({ method: "POST", path: HIDDEN }, 404);
  const refusing = await relaunch(kv);
  await waited(() => refusing.flushWrites());
  expect(savedLog(kv)).toEqual([expect.objectContaining({ refused: true })]);
  return { kv, refusing, queryClient, entry };
}

it("keeps a refused write while its read-back waits for a connection", async () => {
  const { kv, refusing, queryClient, entry } = await refusedAfterRestart();
  onlineManager.setOnline(false);
  try {
    mountRoot(refusing, queryClient);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(entry(SHOW)?.hidden).toBe(true);
    expect(savedLog(kv)).toEqual([expect.objectContaining({ refused: true })]);
  } finally {
    onlineManager.setOnline(true);
  }
  await vi.waitFor(() => expect(entry(SHOW)?.hidden).toBe(false));
  await vi.waitFor(() => expect(savedLog(kv)).toEqual([]));
});

it("keeps a refused write when another change cancels its read-back", async () => {
  const { kv, refusing, queryClient, entry } = await refusedAfterRestart();
  const release = fake.hold({ method: "GET", path: HIDDEN });
  mountRoot(refusing, queryClient);
  await act(() => vi.advanceTimersByTimeAsync(100));
  await act(() => queryClient.cancelQueries({ queryKey: queryKeys.library() }));
  await act(() => vi.advanceTimersByTimeAsync(0));

  expect(entry(SHOW)?.hidden).toBe(true);
  expect(savedLog(kv)).toEqual([expect.objectContaining({ refused: true })]);
  release();
});

it("saves a movie library rebuilt from the corrected watchlist when Trakt refuses adding a movie", async () => {
  const kv = memoryKeyValueStore();
  const cue = await launch(kv);
  const queryClient = createQueryClient();
  await queryClient.fetchQuery(movieLibraryQuery(cue));
  const disk = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  };
  mountRoot(cue, queryClient, () => writeQueryCache(queryClient, storage, CACHE_KEY, ""));
  const list = renderHook(useSetWatchlisted, {
    wrapper: withRuntime(forScreens(cue), queryClient),
  });
  fake.fail({ method: "POST", path: WATCHLIST }, 404);
  const movie = {
    type: "movie" as const,
    traktId: NEW_MOVIE,
    ids: { trakt: NEW_MOVIE },
    year: 2015,
  };
  await waited(() =>
    list.result.current({ ...movie, title: "Harbor Sound", posters: [], tmdbId: null }, true),
  );
  await vi.waitFor(() => expect(savedLog(kv)).toEqual([]));

  const restored = createQueryClient();
  const persister = createAsyncStoragePersister({ storage, key: CACHE_KEY });
  await persistQueryClientRestore({ queryClient: restored, persister });
  const listed = restored
    .getQueryData<{ entries: readonly MovieEntry[] }>(queryKeys.movieLibrary())
    ?.entries.some((entry) => entry.movieId === NEW_MOVIE);
  expect(listed).toBe(false);
});

it("keeps a refused mark when another change cancels the read of its show's progress", async () => {
  const kv = memoryKeyValueStore();
  const first = await launch(kv);
  const { queryClient, entry } = await cached(first);
  await queryClient.fetchQuery(showProgressQuery(first, SHOW));
  const shown = entry(SHOW);
  if (shown === undefined) throw new Error("the show needs to be in the library");
  fake.drop({ method: "POST", path: HISTORY }, "before");
  const upNext = renderHook(useMarkWatched, {
    wrapper: withRuntime(forScreens(first), queryClient),
  });
  await waited(() => upNext.result.current.mark(shown));
  upNext.unmount();
  fake.fail({ method: "POST", path: HISTORY }, 404);
  const refusing = await relaunch(kv);
  await waited(() => refusing.flushWrites());
  const release = fake.hold({
    method: "GET",
    path: new RegExp(`^/shows/${SHOW}/progress/watched$`),
  });
  mountRoot(refusing, queryClient);
  await act(() => vi.advanceTimersByTimeAsync(100));
  await act(() => queryClient.cancelQueries({ queryKey: queryKeys.showProgress(SHOW) }));
  await act(() => vi.advanceTimersByTimeAsync(5_000));

  expect(savedLog(kv)).toEqual([expect.objectContaining({ refused: true })]);
  release();
});
