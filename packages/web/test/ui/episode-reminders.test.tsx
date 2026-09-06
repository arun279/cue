/**
 * The reminders wiring above the pure planner: when the OS schedule is allowed
 * to move, and when it must be left alone. Cancelling is destructive and
 * silent, so the states that must NOT cancel matter more than the ones that do.
 */
import type { CalendarEntry } from "@cue/core/domain/calendar";
import { useEpisodeReminders } from "@cue/core/hooks/useEpisodeReminders";
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

const remindersPort = (): Reminders => ({
  requestPermission: vi.fn(() => Promise.resolve(true)),
  reconcile: vi.fn(() => Promise.resolve()),
  cancelAll: vi.fn(() => Promise.resolve()),
});

const plans = (reminders: Reminders): readonly { atMs: number }[][] =>
  vi.mocked(reminders.reconcile).mock.calls.map(([planned]) => [...planned]);

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

let root: Root | null = null;
let queryClient: QueryClient | null = null;
let prefs = createPrefsStore(memoryStorage());

beforeEach(() => {
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
        <RuntimeProvider value={{ loadCalendar } as unknown as CueRuntime}>
          <RemindersProvider value={reminders}>
            <Probe />
          </RemindersProvider>
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
    // Reconciling against it would cancel every pending digest.
    const reminders = await mountHook(() => new Promise(() => {}));

    expect(reminders.reconcile).not.toHaveBeenCalled();
    expect(reminders.cancelAll).not.toHaveBeenCalled();
  });

  it("reconciles the digest the loaded calendar implies", async () => {
    const reminders = await mountHook(() =>
      Promise.resolve({ entries: [airingAt(Date.now() + DAY_MS)], hiddenShowIds: [] }),
    );

    expect(reminders.reconcile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reminders.reconcile).mock.calls[0]?.[0]).toMatchObject([
      { title: "Airing today", body: "Midnight Cartography S2 E5" },
    ]);
  });

  it("never re-plans a digest whose hour has passed since the calendar loaded", async () => {
    // The render clock is stamped per local day, so a session opened before the
    // digest fires still reads that hour as ahead at teatime. Scheduling it
    // again hands the OS a past date, which it delivers at once: the morning's
    // digest arrives a second time, out of nowhere.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-03-10T08:00:00"));
    const airsTonight = airingAt(Date.parse("2026-03-10T20:00:00"));
    const announced = airingAt(Date.parse("2026-03-11T20:00:00"), {
      showId: 4110,
      showTitle: "Tin Harbour",
      ids: { trakt: 411001 },
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

  it("empties the schedule when the switch goes off, and when the shell unmounts", async () => {
    const reminders = await mountHook(() =>
      Promise.resolve({ entries: [airingAt(Date.now() + DAY_MS)], hiddenShowIds: [] }),
    );

    await act(async () => prefs.setState({ remindersEnabled: false }));
    expect(reminders.cancelAll).toHaveBeenCalledTimes(1);

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
