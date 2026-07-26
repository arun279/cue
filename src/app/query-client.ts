import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { type Query, QueryClient } from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";

/** A content hash over the persisted shapes, injected by `vite.config.ts`. */
declare const __PERSIST_BUSTER__: string;

/**
 * The persisted-cache buster: any cache written against a different shape is
 * dropped rather than replayed. Derived from the shape's own source rather than
 * hand-typed because under `staleTime: Infinity`, with freshness gated only on
 * `/sync/last_activities`, a forgotten bump after a shape change is silent and
 * permanent corruption with no self-heal path. This, not an age cap, is how stale
 * snapshots are retired.
 */
export const PERSIST_BUSTER = __PERSIST_BUSTER__;

/**
 * Query-key heads whose data earns its place in the restored blob: everything a
 * home, Library, Diary or Profile screen paints from before the network answers,
 * and no more. `library`, `movie-library`, `watchlist`, `users` and `history` are
 * `staleTime: Infinity` user state that only the last-activities reconciler ever
 * refreshes, so dropping them from the blob strips those screens on a cold or
 * offline boot with nothing to restore them. `calendar` carries a finite horizon
 * but is what "On the way" paints, so it is persisted for the same reason.
 *
 * Left out: `search` and `discover` (unbounded key spaces nobody boots into), and
 * the per-show/per-movie detail trees, whose count grows with every title ever
 * opened and which cost a single GET to re-read on demand. Per-card `show/art` is
 * the one exception: it is bounded by the library, it is what a restored row
 * paints its poster from, and re-reading it costs a GET per card on screen.
 */
const PERSISTED_KEY_HEADS: ReadonlySet<unknown> = new Set([
  "library",
  "movie-library",
  "watchlist",
  "users",
  "history",
  "calendar",
]);

export function shouldDehydrateQuery(query: Query): boolean {
  if (query.state.status !== "success") return false;
  const [head, section] = query.queryKey;
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
