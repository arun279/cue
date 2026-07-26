import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { type Query, QueryClient } from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";

/** The build's own identity, injected by `vite.config.ts`. */
declare const __BUILD_ID__: string;

/**
 * The persisted-cache buster: any cache a different build wrote is dropped rather
 * than replayed. Derived from the build rather than hand-typed because under
 * `staleTime: Infinity`, with freshness gated only on `/sync/last_activities`, a
 * forgotten bump after a shape change is silent and permanent corruption with no
 * self-heal path. This, not an age cap, is how stale snapshots are retired.
 */
export const PERSIST_BUSTER = __BUILD_ID__;

/**
 * Query-key heads whose data earns its place in the restored blob: the user-state
 * reads that must paint before the network answers. Everything else (search,
 * browse, the finite-`staleTime` content reads) refetches on mount anyway, so
 * persisting it would only bloat every launch's restore.
 */
const PERSISTED_KEY_HEADS: ReadonlySet<unknown> = new Set([
  "library",
  "movie-library",
  "watchlist",
  "users",
]);

export function shouldDehydrateQuery(query: Query): boolean {
  if (query.state.status !== "success") return false;
  const [head, section] = query.queryKey;
  // Per-card art is the one `show` read worth keeping: it is what a restored row
  // paints its poster from, and re-reading it costs a GET per visible card.
  return PERSISTED_KEY_HEADS.has(head) || (head === "show" && section === "art");
}

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
      // stats, watchlist) set `staleTime: Infinity` and revalidate ONLY
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
