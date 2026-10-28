import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactElement, type ReactNode, useState } from "react";
import type { LibraryEntry } from "@/core/data/trakt/library";
import type { MovieEntry } from "@/core/data/trakt/movie-library";
import { type CalendarEntry, recentCalendarStart } from "@/core/domain/calendar";
import { dayKeyOf } from "@/core/domain/day";
import { localTimeZone } from "@/core/domain/time";
import type { QueuedOp } from "@/core/domain/write-queue/types";
import { type Haptics, HapticsProvider } from "@/core/ports/haptics";
import type { PreferenceStorage } from "@/core/ports/preference-storage";
import { createPrefsStore, PrefsProvider } from "@/core/prefs/prefs-store";
import { calendarQuery, recentlyAiredQuery } from "@/core/queries/calendar";
import {
  type BrowseData,
  type CueRuntime,
  RuntimeProvider,
  type SubmitOutcome,
} from "@/core/runtime/runtime";
import { resetMarkStore } from "@/core/stores/mark-store";
import { dismissSnack } from "@/core/stores/snackbar-store";
import { createAppQueryClient } from "../../src/platform/query-client";
import { SnackbarHost } from "../../src/ui/SnackbarHost";
import { partialRuntime } from "../../test/core/support/runtime";
import { memoryPreferenceStorage } from "../../test/core/support/stores";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A runtime call that holds until the test releases it. */
export function held<T>(): { readonly call: jest.Mock<Promise<T>, []>; release(value: T): void } {
  let resolve: (value: T) => void = () => {};
  const call = jest.fn(
    () =>
      new Promise<T>((settle) => {
        resolve = settle;
      }),
  );
  return { call, release: (value) => resolve(value) };
}

export function agesAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

export function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    showId: 8801,
    title: "Harbor Lights",
    year: null,
    status: "returning series",
    hidden: false,
    inWatchlist: false,
    addedAt: null,
    lastWatchedAt: agesAgo(2),
    plays: null,
    aired: 21,
    completed: 18,
    left: Math.max(0, (overrides.aired ?? 21) - (overrides.completed ?? 18)),
    nextEpisode: {
      season: 3,
      number: 5,
      title: "Salt Air",
      firstAired: agesAgo(1),
      still: null,
      ids: { trakt: 88_105 },
    },
    lastAired: { season: 3, number: 5 },
    tmdbId: null,
    runtime: null,
    posters: [],
    pendingAdvance: false,
    ...overrides,
  };
}

export function airing(overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    showId: 8803,
    showTitle: "Midnight Cartography",
    season: 2,
    number: 4,
    episodeTitle: "Dead Reckoning",
    episodeType: null,
    firstAired: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    ids: { trakt: 88_304 },
    posters: [],
    network: null,
    tmdbId: null,
    ...overrides,
  };
}

interface RuntimeFixture {
  readonly entries?: readonly LibraryEntry[];
  readonly movies?: readonly MovieEntry[];
  readonly calendar?: readonly CalendarEntry[];
  readonly submit?: CueRuntime["submit"];
  readonly search?: CueRuntime["search"];
  readonly browse?: Partial<BrowseData>;
}

const NO_BROWSE: BrowseData = {
  trending: [],
  popular: [],
  trendingMovies: [],
  popularMovies: [],
};

/** Trakt's answer to a write it applied by adding one play. */
const ADDED = { added: 1, updated: 0, deleted: 0, existing: 0, notFound: 0 };

export function fakeRuntime({
  entries = [],
  movies = [],
  calendar = [],
  submit,
  search,
  browse,
}: RuntimeFixture): CueRuntime {
  const answered = new Set<string>();
  const sending = new Set<QueuedOp>();
  const settle = submit ?? (() => Promise.resolve<SubmitOutcome>("done"));
  return partialRuntime({
    newId: () => "test-op-id",
    loadUpNext: () => Promise.resolve({ entries: [...entries], isPartial: false }),
    loadMovieLibrary: () => Promise.resolve({ entries: [...movies] }),
    loadMovieWatchlist: () => Promise.resolve([]),
    search: search ?? (() => Promise.resolve([])),
    loadBrowse: () => Promise.resolve({ ...NO_BROWSE, ...browse }),
    loadGenreNames: () => Promise.resolve({}),
    loadCalendar: () => Promise.resolve({ entries: calendar }),
    loadShowSeasons: () => Promise.resolve([]),
    loadShowInfo: (showId) =>
      Promise.resolve({
        ids: { trakt: showId },
        title: "",
        year: null,
        status: "returning series",
        network: null,
        genres: [],
        runtime: null,
        overview: null,
        posters: [],
        backdrops: [],
      }),
    submit: async (op: QueuedOp) => {
      sending.add(op);
      const outcome = await settle(op).finally(() => sending.delete(op));
      if (outcome === "done") answered.add(op.id);
      return outcome;
    },
    pendingWrites: () => 0,
    pendingOps: () => [...sending],
    inFlightOpId: () => null,
    writeReceipt: (opId: string) => (answered.has(opId) ? ADDED : null),
    flushWrites: () => Promise.resolve(0),
    pollActivities: () => Promise.resolve(null),
    loadEpisodePlays: () => Promise.resolve([]),
    loadFirstPlayAt: () => Promise.resolve(null),
  });
}

export function spyHaptics(): jest.Mocked<Haptics> {
  return {
    success: jest.fn(),
    failure: jest.fn(),
    warning: jest.fn(),
    thresholdActivate: jest.fn(),
    thresholdDeactivate: jest.fn(),
    selection: jest.fn(),
    contextClick: jest.fn(),
    prepare: jest.fn(),
  };
}

interface HarnessProps {
  readonly runtime: CueRuntime;
  readonly haptics: Haptics;
  readonly preferences?: PreferenceStorage;
  seed?(client: QueryClient): void;
  readonly children: ReactNode;
}

/** Every provider the screen reads through, with nothing stubbed that the screen
 * itself is meant to be exercising. */
export function Harness({
  runtime,
  haptics,
  preferences = memoryPreferenceStorage(),
  seed,
  children,
}: HarnessProps): ReactElement {
  // One client per mount, and no garbage collection timer: TanStack's own
  // testing guide sets `gcTime` to Infinity under jest, because a five minute
  // collection timer per query outlives the run and forces a worker exit.
  const [client] = useState(() => {
    const client = createAppQueryClient();
    client.setDefaultOptions({ queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } });
    seed?.(client);
    return client;
  });
  return (
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>
        <PrefsProvider value={createPrefsStore(preferences)}>
          <HapticsProvider value={haptics}>
            {children}
            {/* The host the composition root mounts around every screen: a mark's
                Undo is half of what the screen is for. */}
            <SnackbarHost placement="root" />
          </HapticsProvider>
        </PrefsProvider>
      </RuntimeProvider>
    </QueryClientProvider>
  );
}

/** The mark window and the snackbar are module-level singletons, so one case's
 * open window is the next case's phantom state. */
export function resetSharedStores(): void {
  resetMarkStore();
  dismissSnack();
}

/** The two calendar reads every home surface issues, seeded empty so a test
 * renders the screen rather than a network that is not there. */
export function seedCalendars(client: QueryClient, cue: CueRuntime): void {
  const today = dayKeyOf(localTimeZone(), Date.now());
  const empty = { entries: [] };
  client.setQueryData(calendarQuery(cue, today).queryKey, empty);
  client.setQueryData(recentlyAiredQuery(cue, recentCalendarStart(today)).queryKey, empty);
}
