// @vitest-environment jsdom
/**
 * The reminders wiring above the pure planner: when the OS schedule is allowed
 * to move, and when it must be left alone. Cancelling is destructive and
 * silent, so the states that must NOT cancel matter more than the ones that do.
 */
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { CalendarEntry } from "@cue/core/domain/calendar";
import type { PlannedReminder } from "@cue/core/domain/reminders";
import { useEpisodeReminders } from "@cue/core/hooks/useEpisodeReminders";
import { type AppVisibility, AppVisibilityProvider } from "@cue/core/ports/app-visibility";
import type { PreferenceStorage } from "@cue/core/ports/preference-storage";
import { type Reminders, RemindersProvider } from "@cue/core/ports/reminders";
import { createPrefsStore, PrefsProvider } from "@cue/core/prefs/prefs-store";
import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const airingAt = (ms: number, overrides: Partial<CalendarEntry> = {}): CalendarEntry => ({
  showId: 8803,
  showTitle: "Midnight Cartography",
  season: 2,
  number: 5,
  episodeTitle: "Low Tide",
  firstAired: new Date(ms).toISOString(),
  ids: { trakt: 880305 },
  posters: [],
  network: null,
  tmdbId: null,
  ...overrides,
});

/** A show the user is caught up on, which is what makes its next airing an alert. */
const watching = (): LibraryEntry => ({
  showId: 8803,
  title: "Midnight Cartography",
  status: "returning series",
  hidden: false,
  inWatchlist: false,
  lastWatchedAt: new Date(Date.now() - DAY_MS).toISOString(),
  aired: 14,
  completed: 14,
  nextEpisode: null,
  lastAired: { season: 2, number: 4 },
  pendingAdvance: false,
  tmdbId: null,
});

const remindersPort = (): Reminders => ({
  requestPermission: vi.fn(() => Promise.resolve(true)),
  reconcile: vi.fn(() => Promise.resolve()),
  cancelAll: vi.fn(() => Promise.resolve()),
});

const plans = (reminders: Reminders): readonly PlannedReminder[][] =>
  vi.mocked(reminders.reconcile).mock.calls.map(([planned]) => [...planned]);

const bodies = (reminders: Reminders): readonly string[] =>
  (plans(reminders).at(-1) ?? []).map(({ title, body }) => `${title}: ${body}`);

function Probe(): null {
  useEpisodeReminders();
  return null;
}

/** The preferences this suite drives, over a storage that outlives nothing. */
function memoryStorage(): PreferenceStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    clearNamespace: () => values.clear(),
  };
}

/** The app's foreground state, flipped by the test the way the OS flips it. */
function foreground(): AppVisibility & { set: (visible: boolean) => void } {
  let visible = true;
  const listeners = new Set<() => void>();
  return {
    isVisible: () => visible,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      visible = next;
      for (const listener of listeners) listener();
    },
  };
}

let root: Root | null = null;
let app = foreground();
let queryClient: QueryClient | null = null;
let prefs = createPrefsStore(memoryStorage());

beforeEach(() => {
  app = foreground();
  prefs = createPrefsStore(memoryStorage());
  prefs.setState({ remindersEnabled: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  queryClient = null;
  vi.useRealTimers();
});

/** Mount the hook, then let react-query notify its subscribers (a macrotask). */
async function mountHook(loadCalendar: CueRuntime["loadCalendar"]): Promise<Reminders> {
  const reminders = remindersPort();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <PrefsProvider value={prefs}>
        <RuntimeProvider
          value={
            {
              loadCalendar,
              loadUpNext: () => Promise.resolve({ entries: [watching()] }),
            } as unknown as CueRuntime
          }
        >
          <AppVisibilityProvider value={app}>
            <RemindersProvider value={reminders}>
              <Probe />
            </RemindersProvider>
          </AppVisibilityProvider>
        </RuntimeProvider>
      </PrefsProvider>
    </QueryClientProvider>
  );
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(node));
  await settle();
  return reminders;
}

const settle = (): Promise<void> =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe("useEpisodeReminders", () => {
  it("moves nothing while the calendar has not answered", async () => {
    // A cold or offline start: the query is in flight, so the plan is unknown.
    // Reconciling against it would cancel every pending alert.
    const reminders = await mountHook(() => new Promise(() => {}));

    expect(reminders.reconcile).not.toHaveBeenCalled();
    expect(reminders.cancelAll).not.toHaveBeenCalled();
  });

  it("reconciles an alert for the next airing of a show being watched", async () => {
    const reminders = await mountHook(() =>
      Promise.resolve({ entries: [airingAt(Date.now() + DAY_MS)], hiddenShowIds: [] }),
    );

    expect(reminders.reconcile).toHaveBeenCalledTimes(1);
    expect(bodies(reminders)).toEqual(["Midnight Cartography: S2 E5 Low Tide is out."]);
  });

  it("alerts for nothing muted, until it is unmuted", async () => {
    prefs.getState().setShowMuted(8803, true);
    const muted = await mountHook(() =>
      Promise.resolve({ entries: [airingAt(Date.now() + DAY_MS)], hiddenShowIds: [] }),
    );
    expect(bodies(muted)).toEqual([]);

    await act(async () => prefs.getState().setShowMuted(8803, false));
    expect(bodies(muted)).toEqual(["Midnight Cartography: S2 E5 Low Tide is out."]);
  });

  it("swaps the alerts for the morning summary in one reconcile", async () => {
    const reminders = await mountHook(() =>
      Promise.resolve({ entries: [airingAt(Date.now() + DAY_MS)], hiddenShowIds: [] }),
    );

    await act(async () => prefs.getState().setDailySummary(true));

    expect(reminders.reconcile).toHaveBeenCalledTimes(2);
    expect(bodies(reminders)).toEqual(["Airing today: Midnight Cartography S2 E5"]);
  });

  it("never re-plans a summary whose hour has passed since the calendar loaded", async () => {
    // The render clock is stamped per local day, so a session opened before the
    // summary fires still reads that hour as ahead at teatime. Scheduling it
    // again hands the OS a past date, which it delivers at once: the morning's
    // summary arrives a second time, out of nowhere.
    prefs.setState({ dailySummary: true });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-03-10T08:00:00"));
    const airsTonight = airingAt(Date.parse("2026-03-10T20:00:00"));
    const announced = airingAt(Date.parse("2026-03-11T20:00:00"), {
      number: 6,
      ids: { trakt: 880306 },
    });
    let entries = [airsTonight];
    const reminders = await mountHook(() =>
      Promise.resolve({ entries: [...entries], hiddenShowIds: [] }),
    );
    expect(plans(reminders)[0]).toHaveLength(1);

    vi.setSystemTime(Date.parse("2026-03-10T14:00:00"));
    entries = [airsTonight, announced];
    await act(async () => {
      await queryClient?.invalidateQueries();
    });
    await settle();

    const latest = plans(reminders).at(-1) ?? [];
    expect(latest).toHaveLength(1);
    for (const reminder of latest) expect(reminder.atMs).toBeGreaterThan(Date.now());
  });

  it("re-plans each time the app comes back to the foreground, and not on the way out", async () => {
    // The OS holds dated one-shots and nothing renews them but the app, so every
    // return to the foreground is the chance to reach four weeks past today.
    const reminders = await mountHook(() =>
      Promise.resolve({ entries: [airingAt(Date.now() + DAY_MS)], hiddenShowIds: [] }),
    );
    expect(reminders.reconcile).toHaveBeenCalledTimes(1);

    act(() => app.set(false));
    expect(reminders.reconcile).toHaveBeenCalledTimes(1);

    act(() => app.set(true));
    expect(reminders.reconcile).toHaveBeenCalledTimes(2);
    expect(plans(reminders)[1]).toEqual(plans(reminders)[0]);
  });

  it("empties the schedule when the switch goes off, and when the shell unmounts", async () => {
    const reminders = await mountHook(() =>
      Promise.resolve({ entries: [airingAt(Date.now() + DAY_MS)], hiddenShowIds: [] }),
    );

    await act(async () => prefs.setState({ remindersEnabled: false }));
    expect(reminders.cancelAll).toHaveBeenCalledTimes(1);

    // The calendar and library stay cached for the screens that share them, so
    // a foreground with the switch off has a plan to hand and must not.
    act(() => app.set(true));
    expect(reminders.reconcile).toHaveBeenCalledTimes(1);

    // Nothing is scheduled while the switch is off, so signing out has nothing
    // left to empty.
    act(() => root?.unmount());
    root = null;
    expect(reminders.cancelAll).toHaveBeenCalledTimes(1);
  });

  it("empties the schedule when the shell unmounts with reminders still on", async () => {
    // Signing out unmounts the routed shell this hook lives in, and a former
    // account's airings must not keep firing.
    const reminders = await mountHook(() =>
      Promise.resolve({ entries: [airingAt(Date.now() + DAY_MS)], hiddenShowIds: [] }),
    );

    act(() => root?.unmount());
    root = null;

    expect(reminders.cancelAll).toHaveBeenCalledTimes(1);
  });

  it("asks for nothing while the switch is off, cancel included", async () => {
    prefs.setState({ remindersEnabled: false });
    const reminders = await mountHook(() =>
      Promise.resolve({ entries: [airingAt(Date.now() + DAY_MS)], hiddenShowIds: [] }),
    );

    act(() => root?.unmount());
    root = null;

    expect(reminders.cancelAll).not.toHaveBeenCalled();
  });
});
