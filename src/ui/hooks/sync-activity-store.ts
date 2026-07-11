import { create } from "zustand";

interface SyncActivityState {
  /** In-flight durable write-queue flushes. `>0` means a real write is syncing. */
  readonly pending: number;
  begin(): void;
  end(): void;
}

/**
 * A tiny global counter of in-flight write-queue flushes so the sync pill can rest
 * honestly. Read-side freshness lights the pill via a query's `isFetching` (which,
 * post-gating, only fires on a real change-driven refetch); this counter is the
 * DISTINCT write-side signal: the pill ORs the two so "Syncing…" also covers a
 * pending write flush without conflating a read revalidate with the write queue.
 * Every write funnels through `useTrackedSubmit` (which `useOptimisticWrite` and
 * the direct submitters, rating, watchlist, resume, all use), and it brackets
 * `runtime.submit` with begin/end, so the count reflects exactly the writes being
 * sent.
 */
export const useSyncActivity = create<SyncActivityState>((set) => ({
  pending: 0,
  begin: () => set((state) => ({ pending: state.pending + 1 })),
  end: () => set((state) => ({ pending: Math.max(0, state.pending - 1) })),
}));

/** Bracket a write-submit promise with the pending counter (finally-safe). */
export async function trackWrite<T>(run: () => Promise<T>): Promise<T> {
  const { begin, end } = useSyncActivity.getState();
  begin();
  try {
    return await run();
  } finally {
    end();
  }
}
