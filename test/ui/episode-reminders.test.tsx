/**
 * The reminders wiring above the pure planner: when the OS schedule is allowed
 * to move, and when it must be left alone. Cancelling is destructive and
 * silent, so the states that must NOT cancel matter more than the ones that do.
 */
import type { CalendarEntry } from "@domain/calendar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEpisodeReminders } from "@ui/hooks/useEpisodeReminders";
import { usePrefs } from "@ui/prefs/prefs-store";
import { type Reminders, RemindersProvider } from "@ui/runtime/reminders";
import { type CueRuntime, RuntimeProvider } from "@ui/runtime/runtime";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY_MS = 24 * 60 * 60 * 1000;

const airingTomorrow = (): CalendarEntry => ({
  showId: 8803,
  showTitle: "Midnight Cartography",
  season: 2,
  number: 5,
  episodeTitle: "Low Tide",
  firstAired: new Date(Date.now() + DAY_MS).toISOString(),
  ids: { trakt: 880305 },
  posters: [],
  network: null,
  tmdbId: null,
});

const remindersPort = (): Reminders => ({
  requestPermission: vi.fn(() => Promise.resolve(true)),
  reconcile: vi.fn(() => Promise.resolve()),
  cancelAll: vi.fn(() => Promise.resolve()),
});

function Probe(): null {
  useEpisodeReminders();
  return null;
}

let root: Root | null = null;

beforeEach(() => {
  usePrefs.setState({ remindersEnabled: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  usePrefs.setState({ remindersEnabled: false });
});

/** Mount the hook, then let react-query notify its subscribers (a macrotask). */
async function mountHook(loadCalendar: CueRuntime["loadCalendar"]): Promise<Reminders> {
  const reminders = remindersPort();
  const node: ReactElement = (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RuntimeProvider value={{ loadCalendar } as unknown as CueRuntime}>
        <RemindersProvider value={reminders}>
          <Probe />
        </RemindersProvider>
      </RuntimeProvider>
    </QueryClientProvider>
  );
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(node));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return reminders;
}

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
      Promise.resolve({ entries: [airingTomorrow()], hiddenShowIds: [] }),
    );

    expect(reminders.reconcile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reminders.reconcile).mock.calls[0]?.[0]).toMatchObject([
      { title: "Airing today", body: "Midnight Cartography S2 E5" },
    ]);
  });

  it("empties the schedule when the switch goes off, and again when the shell unmounts", async () => {
    const reminders = await mountHook(() =>
      Promise.resolve({ entries: [airingTomorrow()], hiddenShowIds: [] }),
    );

    await act(async () => usePrefs.setState({ remindersEnabled: false }));
    expect(reminders.cancelAll).toHaveBeenCalledTimes(1);

    // Signing out unmounts the routed shell this hook lives in.
    act(() => root?.unmount());
    root = null;
    expect(reminders.cancelAll).toHaveBeenCalledTimes(2);
  });
});
