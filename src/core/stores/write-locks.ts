import type { QueuedOp } from "../domain/write-queue/types";
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

const readBacks = new Map<string, { writes: number; owed: (() => void)[] }>();

/** Counts a write to `target`, so no read back of it runs while this write is still pending. */
export function beginWrite(target: string): void {
  const pending = readBacks.get(target) ?? { writes: 0, owed: [] };
  pending.writes += 1;
  readBacks.set(target, pending);
}

/** Ends a write to `target`; once none is left pending, runs every read back owed to it. */
export function endWrite(target: string, readBack: (() => void) | null): void {
  const pending = readBacks.get(target);
  if (pending === undefined) return;
  if (readBack !== null) pending.owed.push(readBack);
  pending.writes -= 1;
  if (pending.writes > 0) return;
  readBacks.delete(target);
  for (const owed of pending.owed) owed();
}

export function resetWriteLocks(): void {
  locks.clear();
  readBacks.clear();
}
