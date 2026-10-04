import { create } from "zustand";
import type { LibraryEntry } from "../data/trakt/library";
import { resetWriteLocks } from "./write-locks";

export interface MarkRecord {
  readonly opId: string;
  readonly showId: number;
  readonly title: string;
  readonly code: string;
  readonly at: number;
  readonly episodeIds: NonNullable<LibraryEntry["nextEpisode"]>["ids"];
  readonly season: number;
  readonly number: number;
  readonly watchedAt: string;
  readonly preCompleted: number;
  readonly beforeMark: LibraryEntry;
}

interface MarkState {
  readonly records: ReadonlyMap<number, MarkRecord>;
  readonly batch: readonly MarkRecord[];
  open(record: MarkRecord): void;
  close(showId: number, opId?: string): boolean;
  setBatch(batch: readonly MarkRecord[]): void;
}

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

let ownedSnackSeq = 0;

export function setOwnedSnackSeq(seq: number): void {
  ownedSnackSeq = seq;
}

export function ownsSnack(seq: number | undefined): boolean {
  return seq === ownedSnackSeq;
}

export function resetMarkStore(): void {
  useMarkStore.setState({ records: new Map(), batch: [] });
  reversalRequested.clear();
  resetWriteLocks();
  ownedSnackSeq = 0;
}
