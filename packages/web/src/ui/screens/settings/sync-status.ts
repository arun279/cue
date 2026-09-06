/**
 * Pure derivations for the Settings ▸ Data status line. "Last synced" is read
 * off successful account-data queries in the cache, not a separate clock.
 * Editorial browse, search, artwork, and detail reads do not represent an
 * account sync and therefore cannot advance this line.
 */

interface QueryStateLike {
  readonly status: string;
  readonly dataUpdatedAt: number;
}

interface QueryLike {
  readonly queryKey: readonly unknown[];
  readonly state: QueryStateLike;
}

function startsWithKey(queryKey: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((part, index) => queryKey[index] === part);
}

/** The newest successful account-data read; 0 when none has loaded yet. */
export function newestSyncedAt(
  queries: readonly QueryLike[],
  accountPrefixes: readonly (readonly unknown[])[],
): number {
  let newest = 0;
  for (const { queryKey, state } of queries) {
    if (!accountPrefixes.some((prefix) => startsWithKey(queryKey, prefix))) continue;
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

/** `Last synced 2 min ago · 0 pending`, the one place full sync state lives. */
export function syncStatusLine(syncedAt: number, pending: number, now: number): string {
  return `${syncedPhrase(syncedAt, now)} · ${pending} pending`;
}
