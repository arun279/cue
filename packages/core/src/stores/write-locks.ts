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

export function hasPendingMark(runtime: CueRuntime, itemKey: string): boolean {
  return (
    hasWriteLock(pendingMarkLock(itemKey)) ||
    runtime.pendingOps().some((op) => op.itemKey === itemKey && op.toState === "present")
  );
}

export function resetWriteLocks(): void {
  locks.clear();
}
