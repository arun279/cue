// @vitest-environment jsdom
/**
 * The queue mark control over the real mark pipeline. A row that stays green for
 * as long as the write stays undelivered leaves several rows green at once with
 * no way to tell whether anything is wrong, so these pin the rule instead: green
 * is the undo window and nothing longer, the row advances the instant it is
 * tapped, and outstanding delivery is a quiet indicator rather than a green
 * check.
 */

import type { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/core/data/query-keys";
import type { LibraryEntry } from "@/core/domain/model/library";
import type { QueuedOp } from "@/core/domain/write-queue/types";
import { useMarkControl } from "@/core/hooks/useMarkControl";
import { useMarkWatched } from "@/core/hooks/useMarkWatched";
import { createQueryClient } from "@/core/runtime/query-cache";
import type { CueRuntime, UpNextData } from "@/core/runtime/runtime";
import { resetMarkStore } from "@/core/stores/mark-store";
import { UNDO_WINDOW_MS } from "@/core/sync-contract";
import { partialRuntime, withRuntime } from "../support/runtime";

const SHOW = 1;

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    showId: SHOW,
    title: "Harbor Lights",
    year: null,
    status: "returning series",
    hidden: false,
    inWatchlist: false,
    addedAt: null,
    lastWatchedAt: "2026-07-01T00:00:00.000Z",
    plays: null,
    aired: 10,
    completed: 4,
    left: Math.max(0, (overrides.aired ?? 10) - (overrides.completed ?? 4)),
    nextEpisode: {
      season: 3,
      number: 5,
      title: "Salt Air",
      firstAired: "2026-01-01T00:00:00.000Z",
      still: null,
      ids: { trakt: 305 },
    },
    lastAired: { season: 3, number: 10 },
    tmdbId: null,
    runtime: null,
    posters: [],
    pendingAdvance: false,
    ...overrides,
  };
}

/** A runtime whose writes never settle: the deferred queue, held open. */
function heldRuntime(): CueRuntime {
  const queued: QueuedOp[] = [];
  return partialRuntime({
    newId: () => `op-${queued.length}`,
    submit: (op: QueuedOp) => {
      queued.push(op);
      return new Promise(() => {});
    },
    pendingOps: () => [...queued],
    inFlightOpId: () => null,
    writeReceipt: () => null,
  });
}

function mountRow(runtime: CueRuntime, seeded = entry()) {
  // The app's own client, so an hours-long case measures the fix rather than
  // the default 5-minute gcTime collecting the seeded library out from under it.
  const qc = createQueryClient();
  qc.setQueryData<UpNextData>(queryKeys.library(), { entries: [seeded] });
  const { result } = renderHook(
    () =>
      useMarkControl(
        qc.getQueryData<UpNextData>(queryKeys.library())?.entries[0] ?? entry(),
        useMarkWatched(),
      ),
    { wrapper: withRuntime(runtime, qc) },
  );
  return { control: result, qc };
}

const currentEntry = (qc: QueryClient): LibraryEntry | undefined =>
  qc.getQueryData<UpNextData>(queryKeys.library())?.entries[0];

beforeEach(() => {
  resetMarkStore();
  vi.useFakeTimers();
});

describe("the queue mark control", () => {
  it("advances the row and goes green in the same frame as the tap", () => {
    const { control, qc } = mountRow(heldRuntime());
    expect(control.current.state).toBe("unwatched");

    act(() => control.current.onPress());

    expect(currentEntry(qc)?.nextEpisode?.number).toBe(6);
    expect(currentEntry(qc)?.completed).toBe(5);
    expect(control.current.state).toBe("just-marked");
  });

  it("leaves green on the clock, not on the write: a held write cannot pin it", () => {
    const { control } = mountRow(heldRuntime());
    act(() => control.current.onPress());
    expect(control.current.state).toBe("just-marked");

    // The write never settles. The row must still stop being green on schedule,
    // and say plainly that the mark has not reached Trakt.
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS + 10));

    expect(control.current.state).toBe("advancing");
    expect(control.current.pending).toBe(true);
    expect(control.current.label).toBe("Watched. Not synced yet.");
  });

  it("stays advanced rather than reverting, hours into an undelivered write", () => {
    const { control, qc } = mountRow(heldRuntime());
    act(() => control.current.onPress());
    act(() => vi.advanceTimersByTime(3_600_000));

    expect(control.current.state).toBe("advancing");
    expect(currentEntry(qc)?.nextEpisode?.number).toBe(6);
  });

  it("reverses the mark while it is green, restoring the row exactly", () => {
    const { control, qc } = mountRow(heldRuntime());
    act(() => control.current.onPress());
    act(() => control.current.onPress());

    expect(currentEntry(qc)?.nextEpisode?.number).toBe(5);
    expect(currentEntry(qc)?.completed).toBe(4);
    expect(control.current.state).toBe("unwatched");
  });

  it("re-arms once the authoritative next episode lands", () => {
    const { control, qc } = mountRow(heldRuntime());
    act(() => control.current.onPress());
    // The revalidated read names the real next episode: pendingAdvance clears.
    act(() => {
      qc.setQueryData<UpNextData>(queryKeys.library(), {
        entries: [entry({ completed: 5, nextEpisode: entry().nextEpisode })],
      });
    });
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS + 10));

    expect(control.current.state).toBe("unwatched");
    expect(control.current.label).toBe("Mark Harbor Lights S3 E5 watched");
  });

  it("marks once when a double tap lands before the row re-renders", () => {
    const { control, qc } = mountRow(heldRuntime());
    act(() => {
      control.current.onPress();
      control.current.onPress();
    });
    expect(currentEntry(qc)?.completed).toBe(5);
  });

  it("writes nothing for a row whose next episode is not known yet", () => {
    const unknownNext = entry({ nextEpisode: null });
    const { control, qc } = mountRow(heldRuntime(), unknownNext);
    act(() => control.current.onPress());
    expect(currentEntry(qc)).toStrictEqual(unknownNext);
    expect(control.current.state).toBe("unwatched");
  });
});
