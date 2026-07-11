import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";

/**
 * Bump when the app version or a persisted-schema shape changes: the persister
 * drops any cache whose `buster` differs. This, not an age cap, is how stale
 * snapshots are retired. This cache-version bump retires every pre-m6 cache:
 * their entries were serialized before the `progressKnown` field existed, so a
 * restored pre-m6 entry reads as `progressKnown: undefined`: which the watch-status
 * gate treats as `sync-pending` and drops from Up Next, silently hiding a genuinely
 * mid-watch show on the instant cache paint. Dropping the cache forces one clean
 * reload that re-materializes every entry with the field set, so no mid-watch show
 * is hidden. (The prior m5 bump likewise retired the pre-gate m4 caches, which had
 * no co-persisted last-activities baseline and would be trusted forever under the
 * `staleTime: Infinity` gate.)
 */
export const PERSIST_BUSTER = "cue-m6";

/**
 * `maxAge` governs how long a restored cache may be replayed, NOT freshness.
 * Freshness is owned by the last-activities reconciler, so an age cap here would
 * boot an offline user to an empty screen: the exact failure to avoid. Left
 * effectively unbounded; `buster` is the only invalidator. `gcTime` matches so
 * restored queries are never collected before they can paint.
 */
export const PERSIST_MAX_AGE = Number.POSITIVE_INFINITY;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: PERSIST_MAX_AGE,
      // Per-query freshness is explicit: user-state reads (library, movie library,
      // stats, watchlist, ratings) set `staleTime: Infinity` and revalidate ONLY
      // through the last-activities reconciler; content reads (show detail,
      // calendar) set a finite content window. The 0 default only covers ephemeral
      // reads (search) that are keyed per query and fine to refetch on mount.
      staleTime: 0,
      // Focus/reconnect no longer trigger a blanket per-screen re-fetch: a single
      // Page-Visibility-gated `/sync/last_activities` poll is the one freshness
      // check on regaining visibility, so navigation costs zero Trakt data calls.
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
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
