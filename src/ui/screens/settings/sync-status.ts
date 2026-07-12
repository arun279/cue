/**
 * Pure derivations for the Settings ▸ Data status line. "Last synced" is read
 * off the query cache (the newest successful read of anything), not a separate
 * clock: silence-means-synced everywhere else in the app, so the one place that
 * SAYS when must derive from the same freshness the screens actually render.
 */

interface QueryStateLike {
  readonly status: string;
  readonly dataUpdatedAt: number;
}

/** The newest successful read across the cache; 0 when nothing has loaded yet. */
export function newestSyncedAt(states: readonly QueryStateLike[]): number {
  let newest = 0;
  for (const state of states) {
    if (state.status === "success" && state.dataUpdatedAt > newest) {
      newest = state.dataUpdatedAt;
    }
  }
  return newest;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function syncedPhrase(syncedAt: number, now: number): string {
  if (syncedAt <= 0) return "Not synced yet";
  const age = Math.max(0, now - syncedAt);
  if (age < MINUTE_MS) return "Last synced just now";
  if (age < HOUR_MS) return `Last synced ${Math.floor(age / MINUTE_MS)} min ago`;
  if (age < DAY_MS) return `Last synced ${Math.floor(age / HOUR_MS)} hr ago`;
  const days = Math.floor(age / DAY_MS);
  return `Last synced ${days} day${days === 1 ? "" : "s"} ago`;
}

/** `Last synced 2 min ago · 0 pending` — the one place full sync state lives. */
export function syncStatusLine(syncedAt: number, pending: number, now: number): string {
  return `${syncedPhrase(syncedAt, now)} · ${pending} pending`;
}
