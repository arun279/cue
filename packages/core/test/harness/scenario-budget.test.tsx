// @vitest-environment jsdom
import { createCueRuntime } from "@cue/core/app/create-runtime";
import { TraktClient, TraktReadError } from "@cue/core/data/trakt/client";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import { DEFAULT_TRAKT_POLICY } from "@cue/core/data/trakt/policy";
import {
  loadUpNextEntries,
  readRetryFailure,
  readsPausedUntil,
  resetReadPause,
  subscribeReadRetry,
} from "@cue/core/data/trakt/read-budget";
import {
  CALENDAR_WINDOW_DAYS,
  RECENT_CALENDAR_WINDOW_DAYS,
  recentCalendarStart,
} from "@cue/core/domain/calendar";
import { dayKeyOf } from "@cue/core/domain/day";
import { chipBuckets } from "@cue/core/domain/library-buckets";
import { localTimeZone } from "@cue/core/domain/time";
import { groupUpNext } from "@cue/core/domain/up-next";
import { useActivitiesPoll } from "@cue/core/hooks/useActivitiesPoll";
import { useEpisodeReminders } from "@cue/core/hooks/useEpisodeReminders";
import { useLibrarySnapshot } from "@cue/core/hooks/useLibrarySnapshot";
import { type MarkWatched, useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { useWatchlistAdd } from "@cue/core/hooks/useWatchlistAdd";
import { calendarQuery } from "@cue/core/queries/calendar";
import { browseQuery } from "@cue/core/queries/discover";
import { movieLibraryQuery } from "@cue/core/queries/library";
import { ART_SETTLE_MS, showInfoQuery } from "@cue/core/queries/shows";
import { userProfileQuery } from "@cue/core/queries/user";
import { createQueryCachePolicy, createQueryClient } from "@cue/core/runtime/query-cache";
import { type CueRuntime, RuntimeProvider, useRuntime } from "@cue/core/runtime/runtime";
import { useSnackbar } from "@cue/core/stores/snackbar-store";
import {
  type DehydratedState,
  dehydrate,
  focusManager,
  hydrate,
  notifyManager,
  type QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, type ReactElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildRuntime, memoryKv } from "../data/_runtime";
import { type AccountSize, sized } from "../trakt-fake/account.ts";
import { createTraktFake, type TraktFake } from "../trakt-fake/fake.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

// AUTHED_API_GET_LIMIT, per user across all of that user's devices:
// https://developer.trakt.tv/docs/rate-limiting and https://github.com/trakt/trakt-api/issues/909
const TRAKT_GETS_PER_WINDOW = 500;

// One user action may spend a fifth of the window. Four such actions in five minutes (a launch on
// a phone and on a tablet, a relaunch after the OS ends the app, a full scroll) plus both devices'
// one-a-minute activity polls still leave 90 GETs for read retries.
const SCENARIO_GET_BUDGET = TRAKT_GETS_PER_WINDOW / 5;

const SMALL_LIBRARY: AccountSize = {
  inProgress: 14,
  lapsed: 6,
  caughtUp: 4,
  finished: 0,
  airingWatched: 0,
  airingWatchlist: 16,
  watchlistShows: 40,
  watchlistMovies: 20,
  watchedMovies: 5,
  hidden: 0,
};

const HEAVY_LIBRARY: AccountSize = {
  inProgress: 300,
  lapsed: 220,
  caughtUp: 200,
  finished: 1000,
  airingWatched: 100,
  airingWatchlist: 0,
  watchlistShows: 700,
  watchlistMovies: 300,
  watchedMovies: 400,
  hidden: 100,
};

// The query strings the app sends, so each budget is sized from the response the scenario needs.
const FULL = "extended=full";
const ART = "extended=full,images";
const PROGRESS = `${ART}&hidden=false&specials=false&count_specials=false`;
const COLD_CACHE_AGE_MS = 2 * 60 * 60 * 1000;
const REPLAY_TIMEOUT_MS = 120_000;

const SCENARIOS = [
  "sign-in and first sync",
  "cold launch, cache older than an hour",
  "warm launch, cache fresh",
  "return to foreground",
  "pull to refresh",
  "mark, undo, then the next poll",
  "Library Not started chip scrolled end to end",
] as const;
type Scenario = (typeof SCENARIOS)[number];

interface Cost {
  readonly gets: number;
  readonly bytes: number;
}
type Metric = keyof Cost;

interface Measured {
  readonly cost: Cost;
  readonly writes: number;
  readonly budget: Cost;
}

/** The fake's answer to a read as the app would send it, without spending a request on it. */
const bytesOf = async (trakt: TraktFake, path: string): Promise<number> =>
  (await (await trakt.peek(path)).arrayBuffer()).byteLength;

const pageOf = (path: string, page: number): string =>
  `${path}${path.includes("?") ? "&" : "?"}page=${page}&limit=100`;

/** Every page of a list, read 100 at a time as the app reads it. */
async function bytesOfList(trakt: TraktFake, path: string): Promise<number> {
  const pages = Number((await trakt.peek(pageOf(path, 1))).headers.get("x-pagination-page-count"));
  let bytes = 0;
  for (let page = 1; page <= Math.max(1, pages); page += 1)
    bytes += await bytesOf(trakt, pageOf(path, page));
  return bytes;
}

interface WatchedRow {
  readonly plays: number;
  readonly last_watched_at: string;
  readonly show: { readonly aired_episodes: number; readonly ids: { readonly trakt: number } };
}

async function watchedRows(trakt: TraktFake): Promise<WatchedRow[]> {
  const rows: WatchedRow[] = [];
  for (let page = 1; ; page += 1) {
    const answer = await trakt.peek(pageOf("/sync/watched/shows", page));
    rows.push(...((await answer.json()) as WatchedRow[]));
    if (page >= Number(answer.headers.get("x-pagination-page-count"))) return rows;
  }
}

const watchedPages = async (trakt: TraktFake): Promise<number> =>
  Math.max(1, Math.ceil((await watchedRows(trakt)).length / 100));

/** Shows with an aired episode still to watch, most recently watched first. */
const backlogShowIds = async (trakt: TraktFake): Promise<number[]> =>
  (await watchedRows(trakt))
    .filter((row) => row.plays < row.show.aired_episodes)
    .sort((a, b) => b.last_watched_at.localeCompare(a.last_watched_at))
    .map((row) => row.show.ids.trakt);

const CALENDAR_NEXT = "the calendar-derived next episode change";
const LIST_ART = "the change that takes queue row posters from list payloads and keeps them";
const LAZY_SEARCH = "the change that loads the Search tab's data on first focus";
const DELTA_RELOAD = "the delta reload after the app's own writes";
const HIDDEN_FROM_LIBRARY = "the change that filters calendars by the library's hidden flags";

const sum = <T,>(items: readonly T[], bytes: (item: T) => number): number =>
  items.reduce((total, item) => total + bytes(item), 0);

const fixedBy = (...changes: string[]): string => `fixed by ${changes.join(" and ")}`;

const KNOWN_OVER: Readonly<Record<string, Partial<Record<`${Scenario}: ${Metric}`, string>>>> = {
  small: {
    "sign-in and first sync: bytes": fixedBy(LIST_ART, LAZY_SEARCH),
    "cold launch, cache older than an hour: gets": fixedBy(
      LIST_ART,
      LAZY_SEARCH,
      HIDDEN_FROM_LIBRARY,
    ),
    "cold launch, cache older than an hour: bytes": fixedBy(
      LIST_ART,
      LAZY_SEARCH,
      HIDDEN_FROM_LIBRARY,
    ),
    "warm launch, cache fresh: gets": fixedBy(LAZY_SEARCH),
    "warm launch, cache fresh: bytes": fixedBy(LAZY_SEARCH),
    "mark, undo, then the next poll: gets": fixedBy(DELTA_RELOAD),
    "mark, undo, then the next poll: bytes": fixedBy(DELTA_RELOAD),
  },
  heavy: {
    "sign-in and first sync: gets": fixedBy(CALENDAR_NEXT, LIST_ART, LAZY_SEARCH),
    "sign-in and first sync: bytes": fixedBy(CALENDAR_NEXT, LIST_ART, LAZY_SEARCH),
    "cold launch, cache older than an hour: gets": fixedBy(
      CALENDAR_NEXT,
      LIST_ART,
      LAZY_SEARCH,
      HIDDEN_FROM_LIBRARY,
    ),
    "cold launch, cache older than an hour: bytes": fixedBy(
      CALENDAR_NEXT,
      LIST_ART,
      LAZY_SEARCH,
      HIDDEN_FROM_LIBRARY,
    ),
    "warm launch, cache fresh: gets": fixedBy(CALENDAR_NEXT, LAZY_SEARCH),
    "warm launch, cache fresh: bytes": fixedBy(CALENDAR_NEXT, LAZY_SEARCH),
    "mark, undo, then the next poll: gets": fixedBy(DELTA_RELOAD),
    "mark, undo, then the next poll: bytes": fixedBy(DELTA_RELOAD),
  },
};

interface Controls {
  queue: readonly LibraryEntry[];
  mark: MarkWatched | null;
  syncNow: (() => Promise<boolean>) | null;
  scrollNotStarted: (() => void) | null;
}

class Foreground {
  enter(): void {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  }
}

const today = (): string => dayKeyOf(localTimeZone(), Date.now());

// The native useShowArt, which packages/native/src/screens renders per queue row and Library tile.
function Poster({
  showId,
  enabled = true,
}: {
  readonly showId: number;
  readonly enabled?: boolean;
}): null {
  const runtime = useRuntime();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), ART_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);
  useQuery({ ...showInfoQuery(runtime, showId), enabled: enabled && settled });
  return null;
}

function UpNextTab({ controls }: { readonly controls: Controls }): ReactElement {
  const runtime = useRuntime();
  const { data, thresholdMs } = useLibrarySnapshot();
  useQuery(calendarQuery(runtime, today()));
  controls.mark = useMarkWatched();
  controls.syncNow = useSyncNow().run;
  const entries = data?.entries ?? [];
  const byId = new Map(entries.map((entry) => [entry.showId, entry]));
  controls.queue = groupUpNext(entries, Date.now(), thresholdMs).queue.flatMap(
    ({ showId }) => byId.get(showId) ?? [],
  );
  return (
    <>
      {controls.queue.map(({ showId }) => (
        <Poster key={showId} showId={showId} />
      ))}
    </>
  );
}

function LibraryTab({ controls }: { readonly controls: Controls }): ReactElement {
  const runtime = useRuntime();
  const { data, thresholdMs } = useLibrarySnapshot();
  useQuery({ ...movieLibraryQuery(runtime), enabled: false });
  const [scrolled, setScrolled] = useState(false);
  controls.scrollNotStarted = () => setScrolled(true);
  const tiles = scrolled
    ? chipBuckets(data?.entries ?? [], Date.now(), thresholdMs)["not-started"]
    : [];
  return (
    <>
      {tiles.map(({ showId, posters }) => (
        <Poster key={showId} showId={showId} enabled={posters.length === 0} />
      ))}
    </>
  );
}

function CalendarSearchAndAvatar(): null {
  const runtime = useRuntime();
  useQuery(calendarQuery(runtime, today()));
  useQuery(browseQuery(runtime));
  useWatchlistAdd();
  useQuery(userProfileQuery(runtime));
  return null;
}

// RoutedApp in packages/native/app/_layout.tsx, whose four tab roots mount eagerly.
function App({ controls }: { readonly controls: Controls }): ReactElement {
  useActivitiesPoll();
  useEpisodeReminders();
  return (
    <>
      <UpNextTab controls={controls} />
      <LibraryTab controls={controls} />
      <CalendarSearchAndAvatar />
    </>
  );
}

interface Saved {
  readonly kv: ReadonlyMap<string, string>;
  readonly cache: DehydratedState;
}

interface Session {
  readonly trakt: TraktFake;
  readonly kv: Map<string, string>;
  readonly qc: QueryClient;
  readonly runtime: CueRuntime;
  readonly foreground: Foreground;
  readonly controls: Controls;
  readonly root: Root;
}

async function boot(size: AccountSize, saved?: Saved, cacheAgeMs = 0): Promise<Session> {
  const trakt = createTraktFake({ account: () => sized(size, NOW) });
  vi.stubGlobal("fetch", trakt.fetch);
  resetReadPause();
  const kv = memoryKv(Object.fromEntries(saved?.kv ?? []));
  const qc = createQueryClient();
  if (saved !== undefined) {
    hydrate(qc, {
      ...saved.cache,
      queries: saved.cache.queries.map((query) => ({
        ...query,
        state: { ...query.state, dataUpdatedAt: query.state.dataUpdatedAt - cacheAgeMs },
      })),
    });
  }
  let ops = 0;
  const runtime = await createCueRuntime({
    newId: () => `op-${ops++}`,
    token: trakt.session(),
    kv,
    tokenStore: {
      read: async () => null,
      write: async () => undefined,
      clear: async () => undefined,
    },
    redirectUri: "cue://oauth",
    clientId: "client",
    endSession: async () => undefined,
    clearPersistedCaches: async () => undefined,
    clearLocalPreferences: () => undefined,
  });
  const host = document.body.appendChild(document.createElement("div"));
  return {
    trakt,
    kv: kv.values,
    qc,
    runtime,
    foreground: new Foreground(),
    controls: { queue: [], mark: null, syncNow: null, scrollNotStarted: null },
    root: createRoot(host),
  };
}

async function open({ qc, runtime, controls, root }: Session): Promise<void> {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <RuntimeProvider value={runtime}>
          <App controls={controls} />
        </RuntimeProvider>
      </QueryClientProvider>,
    ),
  );
}

async function settle({ trakt, qc, runtime }: Session): Promise<void> {
  let quiet = 0;
  for (let step = 0; step < 200 && quiet < 3; step += 1) {
    const before = trakt.requests.length;
    // A read Trakt's rate limit refused waits out the pause, as the user would.
    const paused = readsPausedUntil() - Date.now();
    await act(() => vi.advanceTimersByTimeAsync(Math.max(ART_SETTLE_MS, paused)));
    const busy = qc.isFetching() + qc.isMutating() + runtime.pendingWrites();
    quiet = busy === 0 && trakt.requests.length === before ? quiet + 1 : 0;
  }
  if (quiet < 3) throw new Error("scenario did not settle");
}

async function measure(
  session: Session,
  run: () => Promise<unknown> | undefined,
  budget: () => Promise<Cost> | Cost,
): Promise<Measured> {
  const start = session.trakt.requests.length;
  await run();
  await settle(session);
  const served = session.trakt.requests.slice(start);
  const gets = served.filter((request) => request.method === "GET");
  return {
    cost: { gets: gets.length, bytes: sum(served, (request) => request.bytes) },
    writes: served.length - gets.length,
    budget: await budget(),
  };
}

async function markUndoAndPoll(session: Session): Promise<Cost> {
  const { trakt, controls, foreground } = session;
  const target = controls.queue[0];
  if (target?.nextEpisode == null) throw new Error("the queue has no episode to mark");
  const progress = `/shows/${target.showId}/progress/watched?${PROGRESS}`;
  await controls.mark?.mark(target);
  await settle(session);
  const markedBytes =
    (await bytesOf(trakt, progress)) +
    (await bytesOf(
      trakt,
      `/sync/history/episodes/${target.nextEpisode.ids.trakt}?${FULL}&page=1&limit=30`,
    ));
  const undo = useSnackbar.getState().snack?.actions?.find((a) => a.testId === "snackbar-undo");
  if (undo === undefined) throw new Error("no undo offered");
  await act(async () => undo.onPress());
  await settle(session);
  foreground.enter();
  // What a delta needs: the marked show's progress after the mark and after the undo, the undo's
  // play lookup, then one poll that re-reads the watched list and that one show's progress.
  return {
    gets: 5 + (await watchedPages(trakt)),
    bytes:
      markedBytes +
      2 * (await bytesOf(trakt, progress)) +
      (await bytesOf(trakt, "/sync/last_activities")) +
      (await bytesOfList(trakt, `/sync/watched/shows?${FULL},progress`)),
  };
}

async function replay(size: AccountSize) {
  const results = {} as Record<Scenario, Measured>;
  const unknown: string[] = [];
  const startDay = today();
  const activities = (trakt: TraktFake): Promise<number> => bytesOf(trakt, "/sync/last_activities");
  const calendars = async (trakt: TraktFake): Promise<number> =>
    (await bytesOf(trakt, `/calendars/my/shows/${startDay}/${CALENDAR_WINDOW_DAYS}?${ART}`)) +
    (await bytesOf(
      trakt,
      `/calendars/my/shows/${recentCalendarStart(startDay)}/${RECENT_CALENDAR_WINDOW_DAYS}?${ART}`,
    ));
  const sumOf = async <T,>(items: readonly T[], bytes: (item: T) => Promise<number>) =>
    sum(await Promise.all(items.map(bytes)), (value) => value);
  // Apart from the first sync's request share, each budget is one read of every response the
  // scenario needs, sized from the same fixture. With nothing changed on Trakt that is one poll.
  const pollOnly = async (trakt: TraktFake): Promise<Cost> => ({
    gets: 1,
    bytes: await activities(trakt),
  });

  const first = await boot(size);
  const { trakt, controls } = first;
  results["sign-in and first sync"] = await measure(
    first,
    () => open(first),
    async () => ({
      gets: SCENARIO_GET_BUDGET,
      bytes:
        (await activities(trakt)) +
        (await bytesOf(trakt, "/users/settings")) +
        (await calendars(trakt)) +
        (await sumOf(
          [
            `/sync/watched/shows?${FULL},progress`,
            "/users/hidden/progress_watched",
            `/sync/watchlist/shows?${ART}`,
          ],
          (list) => bytesOfList(trakt, list),
        )) +
        (await sumOf(
          (await backlogShowIds(trakt)).slice(0, DEFAULT_TRAKT_POLICY.progressBudget),
          (id) => bytesOf(trakt, `/shows/${id}/progress/watched?${PROGRESS}`),
        )) +
        (await sumOf(controls.queue, ({ showId }) => bytesOf(trakt, `/shows/${showId}?${ART}`))),
    }),
  );
  const saved: Saved = {
    kv: new Map(first.kv),
    cache: dehydrate(first.qc, createQueryCachePolicy(first.qc)),
  };
  results["return to foreground"] = await measure(
    first,
    () => void first.foreground.enter(),
    () => pollOnly(trakt),
  );
  results["pull to refresh"] = await measure(
    first,
    () => controls.syncNow?.(),
    () => pollOnly(trakt),
  );
  results["Library Not started chip scrolled end to end"] = await measure(
    first,
    () => void controls.scrollNotStarted?.(),
    // The watchlist and collection payloads already carry every tile's poster.
    () => ({ gets: 0, bytes: 0 }),
  );
  let markBudget: Cost = { gets: 0, bytes: 0 };
  results["mark, undo, then the next poll"] = await measure(
    first,
    async () => {
      markBudget = await markUndoAndPoll(first);
    },
    () => markBudget,
  );
  unknown.push(...trakt.noRoute);
  act(() => first.root.unmount());

  for (const [scenario, ageMs] of [
    ["cold launch, cache older than an hour", COLD_CACHE_AGE_MS],
    ["warm launch, cache fresh", 0],
  ] as const) {
    const session = await boot(size, saved, ageMs);
    results[scenario] = await measure(
      session,
      () => open(session),
      () =>
        ageMs === 0
          ? pollOnly(session.trakt)
          : // Only the two calendar windows are content past their hour. Trakt asks apps to cache
            // images (https://developer.trakt.tv/docs/images); user state moves only with activities.
            (async () => ({
              gets: 3,
              bytes: (await activities(session.trakt)) + (await calendars(session.trakt)),
            }))(),
    );
    unknown.push(...session.trakt.noRoute);
    act(() => session.root.unmount());
  }
  return { results, unknown };
}

describe.each([
  ["small", SMALL_LIBRARY],
  ["heavy", HEAVY_LIBRARY],
] as const)("scenario request budget for a %s library", (label, size) => {
  let replayed: Awaited<ReturnType<typeof replay>>;

  beforeAll(async () => {
    notifyManager.setScheduler(queueMicrotask);
    vi.useFakeTimers({ now: NOW });
    replayed = await replay(size);
  }, REPLAY_TIMEOUT_MS);

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("requests only known endpoints and writes only what the user did", () => {
    expect(replayed.unknown).toEqual([]);
    expect(Object.fromEntries(SCENARIOS.map((s) => [s, replayed.results[s].writes]))).toEqual(
      Object.fromEntries(SCENARIOS.map((s) => [s, s === "mark, undo, then the next poll" ? 2 : 0])),
    );
  });

  for (const scenario of SCENARIOS) {
    for (const metric of ["gets", "bytes"] as const) {
      const name = `${scenario}: ${metric} within budget`;
      const check = (): void => {
        const { cost, budget } = replayed.results[scenario];
        expect(cost[metric], `${label} ${name}`).toBeLessThanOrEqual(budget[metric]);
      };
      const known = KNOWN_OVER[label]?.[`${scenario}: ${metric}`];
      if (known === undefined) it(name, check);
      else it.fails(`${name}, known over budget until ${known}`, check);
    }
  }
});

const NOTHING: AccountSize = {
  inProgress: 0,
  lapsed: 0,
  caughtUp: 0,
  finished: 0,
  airingWatched: 0,
  airingWatchlist: 0,
  watchlistShows: 0,
  watchlistMovies: 0,
  watchedMovies: 0,
  hidden: 0,
};

describe("what a cold sync reads from Trakt", () => {
  const { progressBudget, readAttempts } = DEFAULT_TRAKT_POLICY;
  const fastRetry = { ...DEFAULT_TRAKT_POLICY, retryDelayMs: { base: 1, max: 1 } };

  function reading(size: Partial<AccountSize>, policy = DEFAULT_TRAKT_POLICY) {
    const trakt = createTraktFake({ account: () => sized({ ...NOTHING, ...size }) });
    const started: string[] = [];
    const client = new TraktClient({
      clientId: "client",
      getToken: () => trakt.session().access_token,
      fetch: (input, init) => {
        started.push(`${Date.now()} ${new URL(String(input)).pathname}`);
        return trakt.fetch(input, init);
      },
      policy,
    });
    const count = (path: RegExp): number => trakt.requests.filter((r) => path.test(r.path)).length;
    return { trakt, client, count, started };
  }

  const PROGRESS_READ = /\/progress\/watched$/;
  const HIDDEN = /^\/users\/hidden\/progress_watched$/;

  afterEach(() => {
    resetReadPause();
    vi.unstubAllGlobals();
  });

  it.each([
    250, 1000,
  ])("reads a page per 100 rows of each list, progress for at most the budget, and no artwork, for %i shows in progress", async (shows) => {
    const { client, count, trakt } = reading({
      inProgress: shows,
      finished: 200,
      hidden: 200,
      watchlistShows: 200,
    });
    const entries = await loadUpNextEntries(client);
    const reads = {
      watched: count(/^\/sync\/watched\/shows$/),
      progress: count(PROGRESS_READ),
      art: count(/^\/shows\/\d+$/),
      hidden: count(HIDDEN),
      dropped: count(/^\/users\/hidden\/dropped$/),
      watchlist: count(/^\/sync\/watchlist\/shows$/),
      collection: count(/^\/sync\/collection\/shows$/),
    };
    expect(reads).toEqual({
      watched: Math.ceil((shows + 200) / 100),
      progress: progressBudget,
      art: 0,
      hidden: 2,
      dropped: 1,
      watchlist: 2,
      collection: 1,
    });
    expect(entries).toHaveLength(shows + 400);
    expect(trakt.requests).toHaveLength(Object.values(reads).reduce((sum, n) => sum + n, 0));
    expect(trakt.requests.length).toBeLessThanOrEqual(SCENARIO_GET_BUDGET);
  });

  it("costs list pages, not a read per show, for 4000 watchlisted shows never started", async () => {
    const { client, count } = reading({ watchlistShows: 4000 });
    const entries = await loadUpNextEntries(client);
    expect(entries).toHaveLength(4000);
    expect(count(PROGRESS_READ) + count(/^\/shows\/\d+$/)).toBe(0);
    expect(count(/^\/sync\/watchlist\/shows$/)).toBe(40);
    expect(entries.every((entry) => entry.posters.length > 0)).toBe(true);
  });

  it("costs list pages, not a read per movie, for 4000 watchlisted movies never watched", async () => {
    const { trakt } = reading({ watchlistMovies: 4000 });
    vi.stubGlobal("fetch", trakt.fetch);
    const { entries } = await (await buildRuntime()).loadMovieLibrary();
    expect(entries).toHaveLength(4000);
    expect(
      trakt.requests.map((r) => r.path).filter((path) => path.includes("watchlist")),
    ).toHaveLength(40);
    expect(trakt.requests).toHaveLength(42);
  });

  it("stops a show dropped on Trakt, as it stops a hidden one", async () => {
    const trakt = createTraktFake();
    const client = new TraktClient({
      clientId: "client",
      getToken: () => trakt.session().access_token,
      fetch: trakt.fetch,
    });
    const hidden = (await loadUpNextEntries(client)).filter((entry) => entry.hidden);
    expect(hidden.map((entry) => entry.showId).sort()).toEqual([8804, 8805]);
  });

  it("reads progress for the most recently watched head, and keeps the tail's bulk counts", async () => {
    const { client, count } = reading({ inProgress: progressBudget + 5, lapsed: 5 });
    const entries = await loadUpNextEntries(client);
    expect(count(PROGRESS_READ)).toBe(progressBudget);
    expect(entries.find((e) => e.showId === 100_000)?.nextEpisode).not.toBeNull();
    expect(entries.find((e) => e.showId === 100_000 + progressBudget + 4)).toMatchObject({
      aired: 16,
      completed: 14,
      nextEpisode: null,
    });
  });

  it("reads every show's progress within the budget, and none for shows caught up", async () => {
    const within = reading({ inProgress: progressBudget - 20 });
    await loadUpNextEntries(within.client);
    expect(within.count(PROGRESS_READ)).toBe(progressBudget - 20);
    const caughtUp = reading({ caughtUp: 300 });
    const entries = await loadUpNextEntries(caughtUp.client);
    expect(caughtUp.count(PROGRESS_READ)).toBe(0);
    expect(entries).toHaveLength(300);
    expect(entries.every((e) => e.aired === e.completed)).toBe(true);
  });

  it("pauses the whole fan-out on one 429 instead of each read waiting alone", async () => {
    const { client, trakt, started } = reading({ inProgress: 10 });
    trakt.fail({ path: PROGRESS_READ }, 429, 1);
    await loadUpNextEntries(client);
    const progress = started.filter((line) => line.endsWith("/progress/watched"));
    const at = progress.map((line) => Number(line.split(" ")[0]));
    expect(progress).toHaveLength(11);
    expect(at.filter((when) => when - (at[0] ?? 0) < 900).length).toBeLessThanOrEqual(6);
  });

  it("retries one failing read on its own, so a single 502 costs that read once more", async () => {
    const { client, trakt, count } = reading({ inProgress: 10 }, fastRetry);
    trakt.fail({ path: /^\/shows\/100003\/progress\/watched$/ }, 502);
    trakt.fail({ path: HIDDEN }, 500);
    expect(await loadUpNextEntries(client)).toHaveLength(10);
    expect(count(PROGRESS_READ)).toBe(11);
    expect(count(HIDDEN)).toBe(2);
  });

  it("publishes the failure it is retrying past, and clears it once the read lands", async () => {
    const { client, trakt } = reading({ inProgress: 3 }, fastRetry);
    trakt.fail({ path: HIDDEN }, 503);
    const seen: unknown[] = [];
    const unsubscribe = subscribeReadRetry(() => seen.push(readRetryFailure()));
    await loadUpNextEntries(client);
    unsubscribe();
    expect(seen).toEqual([{ kind: "server", status: 503 }, null]);
    expect(readRetryFailure()).toBeNull();
  });

  it("stops and settles the fan-out once a read has spent its retries, before it throws", async () => {
    const { client, trakt, count } = reading({ inProgress: 10 }, fastRetry);
    trakt.fail({ path: PROGRESS_READ, times: Number.POSITIVE_INFINITY }, 503);
    await expect(loadUpNextEntries(client)).rejects.toThrow(TraktReadError);
    const settled = count(PROGRESS_READ);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(count(PROGRESS_READ)).toBe(settled);
    expect(settled).toBeGreaterThanOrEqual(readAttempts);
  });

  it("keeps two screens' identical browse reads to one request each while they are in flight", async () => {
    const trakt = createTraktFake();
    vi.stubGlobal("fetch", trakt.fetch);
    const rails = /^\/(shows|movies)\/(trending|popular)$/;
    const inFlight = () => trakt.requests.filter((r) => rails.test(r.path)).length;
    const release = trakt.hold({ path: rails, times: Number.POSITIVE_INFINITY });
    const runtime = await buildRuntime();
    const both = Promise.all([runtime.loadBrowse(), runtime.loadBrowse()]);
    await vi.waitFor(() => expect(inFlight()).toBe(4));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(inFlight()).toBe(4);
    release();
    await both;
  });
});
