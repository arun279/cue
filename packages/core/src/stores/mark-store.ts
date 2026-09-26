import { create } from "zustand";
import type { LibraryEntry } from "../data/trakt/library";
import { resetWriteLocks } from "./write-locks";

/**
 * One committed mark, held for the two reversal affordances: the live-toggle
 * window on the row's check (until re-arm) and the snackbar batch (5s rolling
 * window). `beforeMark` is the verbatim pre-mark cache entry, so a reversal
 * restores exactly what the tap replaced.
 */
export interface MarkRecord {
  readonly opId: string;
  readonly showId: number;
  readonly title: string;
  readonly code: string;
  /** Epoch ms of the tap: the batch window + re-arm floor pivot. */
  readonly at: number;
  readonly episodeIds: NonNullable<LibraryEntry["nextEpisode"]>["ids"];
  readonly season: number;
  readonly number: number;
  readonly watchedAt: string;
  readonly preCompleted: number;
  readonly beforeMark: LibraryEntry;
}

interface MarkState {
  /** The open reverse windows, keyed by show id; `at` drives `justMarkedAt`. */
  readonly records: ReadonlyMap<number, MarkRecord>;
  /** The rolling snackbar batch, chronological. */
  readonly batch: readonly MarkRecord[];
  open(record: MarkRecord): void;
  /** Close the show's window; with `opId`, only if that op still owns it (a
   * later hard failure of an earlier mark can't clear a newer window). */
  close(showId: number, opId?: string): boolean;
  setBatch(batch: readonly MarkRecord[]): void;
}

/**
 * The app-level mark manager: reverse windows and the rolling
 * snackbar batch live at MODULE level, one store for the whole session, like
 * the snackbar's. Marks made on different surfaces therefore share one batch
 * (two surfaces within 5s coalesce into `N episodes marked` · Undo-all), and a
 * just-marked check is a live undo toggle on EVERY mounted surface, not only
 * the one that was tapped. `useMarkWatched` is a thin view/action wrapper.
 */
export const useMarkStore = create<MarkState>((set, get) => ({
  records: new Map(),
  batch: [],
  open: (record) => set((s) => ({ records: new Map(s.records).set(record.showId, record) })),
  close: (showId, opId) => {
    const current = get().records.get(showId);
    if (current === undefined || (opId !== undefined && current.opId !== opId)) return false;
    set((s) => {
      const records = new Map(s.records);
      records.delete(showId);
      return { records };
    });
    return true;
  },
  setBatch: (batch) => set({ batch }),
}));

/** Ops whose reversal has been requested: their mark-side revalidate is
 * suppressed, else a landed mark's refetch would clobber the undone UI with
 * post-mark server state until the removal lands (the reversal's own
 * revalidate reconciles once it does). */
const reversalRequested = new Set<string>();

export function requestReversal(opId: string): void {
  reversalRequested.add(opId);
}

export function settleReversal(opId: string): void {
  reversalRequested.delete(opId);
}

export function isReversalRequested(opId: string): boolean {
  return reversalRequested.has(opId);
}

/** seq of the snack the shared batch currently owns, so a retraction never
 * clobbers an unrelated snack that replaced it. */
let ownedSnackSeq = 0;

export function setOwnedSnackSeq(seq: number): void {
  ownedSnackSeq = seq;
}

export function ownsSnack(seq: number | undefined): boolean {
  return seq === ownedSnackSeq;
}

/** Test-only: restore the pristine module state between cases. */
export function resetMarkStore(): void {
  useMarkStore.setState({ records: new Map(), batch: [] });
  reversalRequested.clear();
  resetWriteLocks();
  ownedSnackSeq = 0;
}
