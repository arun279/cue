// @vitest-environment jsdom
import { createCueRuntime } from "@cue/core/app/create-runtime";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import { DEFAULT_TRAKT_POLICY } from "@cue/core/data/trakt/policy";
import { resetReadPause } from "@cue/core/data/trakt/read-budget";
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
import { type AppVisibility, AppVisibilityProvider } from "@cue/core/ports/app-visibility";
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
  hydrate,
  notifyManager,
  type QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, type ReactElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { memoryKv } from "../data/_runtime";
import { FakeTrakt, HEAVY_LIBRARY, type LibrarySize, SMALL_LIBRARY } from "./fake-trakt";
import { SCENARIO_GET_BUDGET } from "./trakt-limits";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
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

class Foreground implements AppVisibility {
  private readonly listeners = new Set<() => void>();
  isVisible = (): boolean => true;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  enter(): void {
    for (const listener of this.listeners) listener();
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
  readonly trakt: FakeTrakt;
  readonly kv: Map<string, string>;
  readonly qc: QueryClient;
  readonly runtime: CueRuntime;
  readonly foreground: Foreground;
  readonly controls: Controls;
  readonly root: Root;
}

async function boot(size: LibrarySize, saved?: Saved, cacheAgeMs = 0): Promise<Session> {
  const trakt = new FakeTrakt(size, NOW);
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
    token: {
      access_token: "access",
      refresh_token: "refresh",
      created_at: Math.floor(NOW / 1000),
      expires_in: 604_800,
    },
    kv,
    tokenStore: {
      read: async () => null,
      write: async () => undefined,
      clear: async () => undefined,
    },
    redirectUri: "cue://oauth",
    clientId: "client",
    browser: false,
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

async function open({ qc, runtime, foreground, controls, root }: Session): Promise<void> {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <RuntimeProvider value={runtime}>
          <AppVisibilityProvider value={foreground}>
            <App controls={controls} />
          </AppVisibilityProvider>
        </RuntimeProvider>
      </QueryClientProvider>,
    ),
  );
}

async function settle({ trakt, qc, runtime }: Session): Promise<void> {
  let quiet = 0;
  for (let step = 0; step < 200 && quiet < 3; step += 1) {
    const before = trakt.requests.length;
    await act(() => vi.advanceTimersByTimeAsync(ART_SETTLE_MS));
    const busy = qc.isFetching() + qc.isMutating() + runtime.pendingWrites();
    quiet = busy === 0 && trakt.requests.length === before ? quiet + 1 : 0;
  }
  if (quiet < 3) throw new Error("scenario did not settle");
}

async function measure(
  session: Session,
  run: () => Promise<unknown> | undefined,
  budget: () => Cost,
): Promise<Measured> {
  const start = session.trakt.requests.length;
  await run();
  await settle(session);
  const served = session.trakt.requests.slice(start);
  const gets = served.filter((request) => request.method === "GET");
  return {
    cost: { gets: gets.length, bytes: sum(served, (request) => request.bytes) },
    writes: served.length - gets.length,
    budget: budget(),
  };
}

async function markUndoAndPoll(session: Session): Promise<Cost> {
  const { trakt, controls, foreground } = session;
  const target = controls.queue[0];
  if (target?.nextEpisode == null) throw new Error("the queue has no episode to mark");
  const progress = `/shows/${target.showId}/progress/watched`;
  await controls.mark?.mark(target);
  await settle(session);
  const markedBytes =
    2 * trakt.bytesOf(progress) +
    trakt.bytesOf(`/sync/history/episodes/${target.nextEpisode.ids.trakt}?page=1&limit=30`);
  const undo = useSnackbar.getState().snack?.actions?.find((a) => a.testId === "snackbar-undo");
  if (undo === undefined) throw new Error("no undo offered");
  await act(async () => undo.onPress());
  await settle(session);
  foreground.enter();
  // What a delta needs: the marked show's progress after the mark and after the undo, the undo's
  // play lookup, then one poll that re-reads the watched list and that one show's progress.
  return {
    gets: 5 + trakt.watchedPages,
    bytes:
      markedBytes +
      trakt.bytesOf(progress) +
      trakt.bytesOf("/sync/last_activities") +
      trakt.bytesOfList("/sync/watched/shows"),
  };
}

async function replay(size: LibrarySize) {
  const results = {} as Record<Scenario, Measured>;
  const unknown: string[] = [];
  const startDay = today();
  const activities = (trakt: FakeTrakt): number => trakt.bytesOf("/sync/last_activities");
  const calendars = (trakt: FakeTrakt): number =>
    trakt.bytesOf(`/calendars/my/shows/${startDay}/${CALENDAR_WINDOW_DAYS}`) +
    trakt.bytesOf(
      `/calendars/my/shows/${recentCalendarStart(startDay)}/${RECENT_CALENDAR_WINDOW_DAYS}`,
    );
  // Apart from the first sync's request share, each budget is one read of every response the
  // scenario needs, sized from the same fixture. With nothing changed on Trakt that is one poll.
  const pollOnly = (trakt: FakeTrakt): Cost => ({ gets: 1, bytes: activities(trakt) });

  const first = await boot(size);
  const { trakt, controls } = first;
  results["sign-in and first sync"] = await measure(
    first,
    () => open(first),
    () => ({
      gets: SCENARIO_GET_BUDGET,
      bytes:
        activities(trakt) +
        trakt.bytesOf("/users/settings") +
        calendars(trakt) +
        sum(
          ["/sync/watched/shows", "/users/hidden/progress_watched", "/sync/watchlist/shows"],
          (list) => trakt.bytesOfList(list),
        ) +
        sum(trakt.backlogShowIds().slice(0, DEFAULT_TRAKT_POLICY.progressBudget), (id) =>
          trakt.bytesOf(`/shows/${id}/progress/watched`),
        ) +
        sum(controls.queue, ({ showId }) => trakt.bytesOf(`/shows/${showId}`)),
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
  unknown.push(...trakt.unknown);
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
            { gets: 3, bytes: activities(session.trakt) + calendars(session.trakt) },
    );
    unknown.push(...session.trakt.unknown);
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
