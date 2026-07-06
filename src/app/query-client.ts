import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";

/**
 * Bump when the app version or a persisted-schema shape changes: the persister
 * drops any cache whose `buster` differs. This — not an age cap — is how stale
 * snapshots are retired.
 */
export const PERSIST_BUSTER = "cue-m4";

/**
 * `maxAge` governs how long a restored cache may be replayed, NOT freshness.
 * Freshness is owned by the last-activities reconciler, so an age cap here would
 * boot an offline user to an empty screen — the exact failure to avoid. Left
 * effectively unbounded; `buster` is the only invalidator. `gcTime` matches so
 * restored queries are never collected before they can paint.
 */
export const PERSIST_MAX_AGE = Number.POSITIVE_INFINITY;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: PERSIST_MAX_AGE,
      // Refetch on mount so a restored (possibly stale) cache paints instantly,
      // then revalidates — the stale-while-revalidate boot the whole app rides on.
      staleTime: 0,
      retry: false,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  key: "cue.query-cache",
  storage: {
    getItem: (key) => get<string>(key).then((value) => value ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
});
