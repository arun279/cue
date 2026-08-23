import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { CueRuntime } from "@ui/runtime/runtime";
import { create } from "zustand";

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

// The store's synchronous companions. None of these drive rendering, so they
// live beside the reactive state as plain module singletons: still one truth
// per session, readable inside async closures without a hook.

/** Per-show in-flight mark lock. `entry.pendingAdvance` only guards AFTER the
 * optimistic patch re-renders, so two activations on the same stale entry (a
 * fast double-tap / Enter key-repeat) would both enqueue a play. Checked-and-set
 * synchronously before the patch; released when the write settles or the mark
 * is reversed. */
const marksInFlight = new Set<number>();

/** Claim the show's mark slot; false = a mark is already in flight (drop). */
export function lockShow(showId: number): boolean {
  if (marksInFlight.has(showId)) return false;
  marksInFlight.add(showId);
  return true;
}

export function unlockShow(showId: number): void {
  marksInFlight.delete(showId);
}

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

/**
 * The session pending-mark registry: write-queue itemKey → the op id that owns
 * the pending mark. Every plain on-mark path (queue mark, season-row /
 * sheet toggle ON) registers before submitting and consults first, so one
 * episode can never collect two queued plays from two surfaces whose caches
 * lag each other. Ownership makes release idempotent: a reversed mark's late
 * `finally` can't clear a successor's registration.
 */
const pendingMarks = new Map<string, string>();

export function registerPendingMark(itemKey: string, opId: string): void {
  pendingMarks.set(itemKey, opId);
}

export function releasePendingMark(itemKey: string, opId: string): void {
  if (pendingMarks.get(itemKey) === opId) pendingMarks.delete(itemKey);
}

/**
 * Whether a mark for this item is already pending anywhere: the synchronous
 * registry covers the tap-to-persist window, the durable queue snapshot covers
 * everything already enqueued: including ops restored from a previous session
 * that no registry entry survives. Additive plays carry uniquified itemKeys,
 * so they neither register here nor block a toggle (F6), and a queued UNMARK
 * (`toState: "absent"`) never reads as a pending mark.
 */
export function hasPendingMark(runtime: CueRuntime, itemKey: string): boolean {
  return (
    pendingMarks.has(itemKey) ||
    runtime.pendingOps().some((op) => op.itemKey === itemKey && op.toState === "present")
  );
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
  marksInFlight.clear();
  reversalRequested.clear();
  pendingMarks.clear();
  ownedSnackSeq = 0;
}
