import type { QueuedOp, WriteTarget } from "../domain/write-queue/types";
import type { CueRuntime } from "../runtime/runtime";

const locks = new Map<string, unknown>();

export const showWriteLock = (showId: number): string => `show:${showId}`;
export const seasonWriteLock = (showId: number, season: number): string =>
  `season:${showId}:${season}`;
export const episodeWriteLock = (showId: number, season: number, episode: number): string =>
  `episode:${showId}:${season}:${episode}`;
export const pendingMarkLock = (itemKey: string): string => `pending:${itemKey}`;

export function claimWriteLock(key: string, owner: unknown): boolean {
  if (locks.has(key)) return false;
  locks.set(key, owner);
  return true;
}

export function releaseWriteLock(key: string, owner: unknown): void {
  if (locks.get(key) === owner) locks.delete(key);
}

function hasWriteLock(key: string): boolean {
  return locks.has(key);
}

/** The queued mark an item's state rests on: its latest queued write, when that is a mark. */
export function pendingMark(runtime: CueRuntime, itemKey: string): QueuedOp | undefined {
  const latest = runtime.pendingOps().findLast((op) => op.itemKey === itemKey);
  return latest?.toState === "present" ? latest : undefined;
}

export function hasPendingMark(runtime: CueRuntime, itemKey: string): boolean {
  return hasWriteLock(pendingMarkLock(itemKey)) || pendingMark(runtime, itemKey) !== undefined;
}

const keyOf = ({ kind, id }: WriteTarget): string => `${kind}:${id}`;

const readBacks = new Map<string, { writes: number; owed: (() => void)[] }>();
const latestWrites = new Map<string, number>();
let writesStarted = 0;
let writesPending = 0;
let sharedReads: (() => void)[] = [];

/** Counts a write to `target`, so no read back of it runs while this write is still pending. */
export function beginWrite(target: WriteTarget): void {
  const key = keyOf(target);
  const pending = readBacks.get(key) ?? { writes: 0, owed: [] };
  pending.writes += 1;
  readBacks.set(key, pending);
  writesPending += 1;
  writesStarted += 1;
  latestWrites.set(key, writesStarted);
}

/** Which write to `target` began last; a later write gives a higher number. */
export const latestWrite = (target: WriteTarget): number => latestWrites.get(keyOf(target)) ?? 0;

/** How many writes have begun, to compare with `latestWrite`. */
export const writesBegun = (): number => writesStarted;

/** Ends a write to `target`; once none is left pending, runs every read back owed to it. */
export function endWrite(target: WriteTarget, readBack: (() => void) | null): void {
  const key = keyOf(target);
  const pending = readBacks.get(key);
  if (pending === undefined) return;
  writesPending -= 1;
  if (readBack !== null) pending.owed.push(readBack);
  pending.writes -= 1;
  if (pending.writes === 0) {
    readBacks.delete(key);
    for (const owed of pending.owed) owed();
  }
  if (writesPending > 0) return;
  const reads = sharedReads;
  sharedReads = [];
  for (const read of reads) read();
}

/** Runs a read of a query that holds many shows or movies once no write to any of them is pending. */
export function whenNoWritePending(read: () => void): void {
  if (writesPending === 0) read();
  else sharedReads.push(read);
}

export function resetWriteLocks(): void {
  locks.clear();
  readBacks.clear();
  latestWrites.clear();
  writesPending = 0;
  sharedReads = [];
}
