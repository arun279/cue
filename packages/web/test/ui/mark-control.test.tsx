/**
 * The queue mark control over the real mark pipeline. A row that stays green for
 * as long as the write stays undelivered leaves several rows green at once with
 * no way to tell whether anything is wrong, so these pin the rule instead: green
 * is the undo window and nothing longer, the row advances the instant it is
 * tapped, and outstanding delivery is a quiet indicator rather than a green
 * check.
 */

import { queryKeys } from "@cue/core/data/query-keys";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import { useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import { createQueryClient } from "@cue/core/runtime/query-cache";
import { type CueRuntime, RuntimeProvider, type UpNextData } from "@cue/core/runtime/runtime";
import { resetMarkStore } from "@cue/core/stores/mark-store";
import { UNDO_WINDOW_MS } from "@cue/core/sync-contract";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "./_mount";

const SHOW = 1;

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    showId: SHOW,
    title: "Harbor Lights",
    status: "returning series",
    hidden: false,
    inWatchlist: false,
    lastWatchedAt: "2026-07-01T00:00:00.000Z",
    aired: 10,
    completed: 4,
    nextEpisode: {
      season: 3,
      number: 5,
      title: "Salt Air",
      firstAired: "2026-01-01T00:00:00.000Z",
      still: null,
      ids: { trakt: 305 },
    },
    lastAired: null,
    tmdbId: null,
    pendingAdvance: false,
    ...overrides,
  };
}

/** A runtime whose writes never settle: the deferred queue, held open. */
function heldRuntime(): CueRuntime {
  const queued: QueuedOp[] = [];
  return {
    submit: (op: QueuedOp) => {
      queued.push(op);
      return new Promise(() => {});
    },
    pendingOps: () => [...queued],
    inFlightOpId: () => null,
  } as unknown as CueRuntime;
}

interface Slot {
  state: string;
  pending: boolean;
  label: string;
  press(): void;
}

function Row({ qc, slot }: { qc: QueryClient; slot: Slot[] }) {
  const mark = useMarkWatched();
  const current = qc.getQueryData<UpNextData>(queryKeys.library())?.entries[0] ?? entry();
  const control = useMarkControl(current, mark);
  slot[0] = { ...control, press: control.onPress };
  return null;
}

function mountRow(runtime: CueRuntime): { slot: Slot[]; qc: QueryClient } {
  // The app's own client, so an hours-long case measures the fix rather than
  // the default 5-minute gcTime collecting the seeded library out from under it.
  const qc = createQueryClient();
  qc.setQueryData<UpNextData>(queryKeys.library(), { entries: [entry()] });
  const slot: Slot[] = [];
  mount(
    <QueryClientProvider client={qc}>
      <RuntimeProvider value={runtime}>
        <Row qc={qc} slot={slot} />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  return { slot, qc };
}

const currentEntry = (qc: QueryClient): LibraryEntry | undefined =>
  qc.getQueryData<UpNextData>(queryKeys.library())?.entries[0];

beforeEach(() => {
  resetMarkStore();
  vi.useFakeTimers();
});

describe("the queue mark control", () => {
  it("advances the row and goes green in the same frame as the tap", () => {
    const { slot, qc } = mountRow(heldRuntime());
    expect(slot[0]?.state).toBe("unwatched");

    act(() => slot[0]?.press());

    expect(currentEntry(qc)?.nextEpisode?.number).toBe(6);
    expect(currentEntry(qc)?.completed).toBe(5);
    expect(slot[0]?.state).toBe("just-marked");
  });

  it("leaves green on the clock, not on the write: a held write cannot pin it", () => {
    const { slot } = mountRow(heldRuntime());
    act(() => slot[0]?.press());
    expect(slot[0]?.state).toBe("just-marked");

    // The write never settles. The row must still stop being green on schedule,
    // and say plainly that the mark has not reached Trakt.
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS + 10));

    expect(slot[0]?.state).toBe("advancing");
    expect(slot[0]?.pending).toBe(true);
    expect(slot[0]?.label).toBe("Watched. Not synced yet.");
  });

  it("stays advanced rather than reverting, hours into an undelivered write", () => {
    const { slot, qc } = mountRow(heldRuntime());
    act(() => slot[0]?.press());
    act(() => vi.advanceTimersByTime(3_600_000));

    expect(slot[0]?.state).toBe("advancing");
    expect(currentEntry(qc)?.nextEpisode?.number).toBe(6);
  });

  it("reverses the mark while it is green, restoring the row exactly", () => {
    const { slot, qc } = mountRow(heldRuntime());
    act(() => slot[0]?.press());
    act(() => slot[0]?.press());

    expect(currentEntry(qc)?.nextEpisode?.number).toBe(5);
    expect(currentEntry(qc)?.completed).toBe(4);
    expect(slot[0]?.state).toBe("unwatched");
  });

  it("re-arms once the authoritative next episode lands", () => {
    const { slot, qc } = mountRow(heldRuntime());
    act(() => slot[0]?.press());
    // The revalidated read names the real next episode: pendingAdvance clears.
    act(() => {
      qc.setQueryData<UpNextData>(queryKeys.library(), {
        entries: [entry({ completed: 5, nextEpisode: entry().nextEpisode })],
      });
    });
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS + 10));

    expect(slot[0]?.state).toBe("unwatched");
    expect(slot[0]?.label).toBe("Mark Harbor Lights S3 E5 watched");
  });
});
