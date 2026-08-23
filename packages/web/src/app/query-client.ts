import { queryKeys } from "@cue/core/data/query-keys";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { type Query, QueryClient } from "@tanstack/react-query";
import { PERSISTED_CACHE } from "@ui/runtime/persist-buster";
import { del, get, set } from "idb-keyval";

export const PERSIST_BUSTER = PERSISTED_CACHE.buster;

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
 * opened and which cost a single GET to re-read on demand. A LIBRARY show's
 * `show/info` is the one exception: it is what a restored row paints its poster
 * from, and re-reading it costs a GET per card on screen.
 */
const PERSISTED_KEY_HEADS: ReadonlySet<unknown> = new Set([
  "library",
  "movie-library",
  "watchlist",
  "users",
  "history",
  "calendar",
]);

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

/**
 * Does the restored library hold a card for this show? Show detail and the
 * per-card art read share one `showInfo` entry, so anything opened from Search,
 * Calendar or the Diary writes one too. Those have no card to paint on a cold
 * boot, and with `gcTime` and `PERSIST_MAX_AGE` both unbounded they would
 * accumulate in the blob for the life of the install. Gating on library
 * membership is what keeps the persisted set bounded by the library.
 */
function paintsALibraryCard(showId: unknown): boolean {
  const library = queryClient.getQueryData<{
    readonly entries: readonly { readonly showId: number }[];
  }>(queryKeys.library());
  return library?.entries.some((entry) => entry.showId === showId) ?? false;
}

export function shouldDehydrateQuery(query: Query): boolean {
  if (query.state.status !== "success") return false;
  const [head, section, showId] = query.queryKey;
  if (head === "show") return section === "info" && paintsALibraryCard(showId);
  return PERSISTED_KEY_HEADS.has(head);
}

export const queryPersister = createAsyncStoragePersister({
  key: "cue.query-cache",
  storage: {
    getItem: (key) => get<string>(key).then((value) => value ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
});
