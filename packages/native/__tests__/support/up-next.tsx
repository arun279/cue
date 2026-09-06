import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { CalendarEntry } from "@cue/core/domain/calendar";
import { type Haptics, HapticsProvider } from "@cue/core/ports/haptics";
import { type Network, NetworkProvider } from "@cue/core/ports/network";
import type { PreferenceStorage } from "@cue/core/ports/preference-storage";
import { createPrefsStore, PrefsProvider } from "@cue/core/prefs/prefs-store";
import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { resetMarkStore } from "@cue/core/stores/mark-store";
import { dismissSnack } from "@cue/core/stores/snackbar-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { SnackbarHost } from "../../src/ui/SnackbarHost";

const DAY_MS = 24 * 60 * 60 * 1000;

export function agesAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

export function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    showId: 8801,
    title: "Harbor Lights",
    status: "returning series",
    hidden: false,
    inWatchlist: false,
    lastWatchedAt: agesAgo(2),
    aired: 21,
    completed: 18,
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
    firstAired: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    ids: { trakt: 88_304 },
    posters: [],
    network: null,
    tmdbId: null,
    ...overrides,
  };
}

export interface RuntimeFixture {
  readonly entries?: readonly LibraryEntry[];
  readonly calendar?: readonly CalendarEntry[];
  readonly submit?: CueRuntime["submit"];
}

/**
 * The slice of the runtime the home screen actually reaches. Cast once, here,
 * rather than in every file that needs one: the interface is the composition
 * root's contract with twenty-five methods, and a screen test that had to fill
 * all of them would be a test of the fixture.
 */
export function fakeRuntime({ entries = [], calendar = [], submit }: RuntimeFixture): CueRuntime {
  return {
    loadUpNext: () => Promise.resolve({ entries: [...entries], isPartial: false }),
    loadCalendar: () => Promise.resolve({ entries: calendar, hiddenShowIds: [] }),
    loadShowSeasons: () => Promise.resolve([]),
    loadShowInfo: () => Promise.resolve({ posters: [], backdrops: [] }),
    submit: submit ?? (() => Promise.resolve("done")),
    pendingWrites: () => 0,
    pendingOps: () => [],
    inFlightOpId: () => null,
    flushWrites: () => Promise.resolve(0),
    pollActivities: () => Promise.resolve(null),
    loadEpisodePlays: () => Promise.resolve([]),
  } as unknown as CueRuntime;
}

export function memoryPreferences(): PreferenceStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    clearNamespace: (prefix) => {
      for (const key of [...values.keys()]) if (key.startsWith(prefix)) values.delete(key);
    },
  };
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

export const OFFLINE: Network = { isOnline: () => false, subscribe: () => () => {} };

export interface HarnessProps {
  readonly runtime: CueRuntime;
  readonly haptics: Haptics;
  readonly preferences?: PreferenceStorage;
  readonly network?: Network;
  readonly children: ReactNode;
}

/** Every provider the screen reads through, with nothing stubbed that the screen
 * itself is meant to be exercising. */
export function Harness({
  runtime,
  haptics,
  preferences = memoryPreferences(),
  network,
  children,
}: HarnessProps): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
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

  return network === undefined ? tree : <NetworkProvider value={network}>{tree}</NetworkProvider>;
}

/** The mark window and the snackbar are module-level singletons, so one case's
 * open window is the next case's phantom state. */
export function resetSharedStores(): void {
  resetMarkStore();
  dismissSnack();
}
