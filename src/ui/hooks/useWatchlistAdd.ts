import { queryKeys } from "@data/query-keys";
import type { SearchHit } from "@data/trakt/search";
import { buildAddWatchlistOp, buildRemoveWatchlistOp } from "@domain/write-queue/ops";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { USER_STATE_STALE_TIME } from "@ui/hooks/query-freshness";
import { useQueuedWrite } from "@ui/hooks/useQueuedWrite";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

export interface WatchlistAddView {
  /** True once this hit is in the user's library in any sense: optimistically
   * added here, already on the watchlist, or already tracked/watched. */
  isAdded(hit: SearchHit): boolean;
  /** Optimistically add a hit to its section's watchlist through the durable queue. */
  add(hit: SearchHit): Promise<void>;
  /** The inverse of {@link add}, for the snackbar Undo: optimistically drops the
   * hit from its section's watchlist (coalescing against a still-queued add). */
  remove(hit: SearchHit): Promise<void>;
  readonly addError: string | null;
  clearAddError(): void;
}

/** Which watchlist sections a surface seeds membership from. A movie-only rail
 * (Movie-detail "More like this", the movie-home Discover) passes `{ movies: true }`
 * so it never spends a `/sync/watchlist/shows` read it can never use: the
 * gated-by-medium rate budget. The mixed Discover search leaves both on (default). */
interface WatchlistSections {
  readonly shows?: boolean;
  readonly movies?: boolean;
}

function sectionOf(type: "show" | "movie"): "shows" | "movies" {
  return type === "movie" ? "movies" : "shows";
}

/** Trakt ids are namespaced per media type, so `show:123` and `movie:123` must not collide. */
function addKey(hit: SearchHit): string {
  return `${hit.type}:${hit.traktId}`;
}

/**
 * The inline "add to watchlist" surface shared by every poster rail: Discover
 * search results, the trending/popular browse rails, and the Movie-detail "More
 * like this" rail. Membership is seeded from the shared watchlist caches so an
 * already-listed hit shows as added and a remount doesn't forget a just-added
 * item, and additionally peeked (never fetched: `enabled: false`) from the
 * persisted library caches so a show you're watching or a movie you've seen
 * reads as "in library" rather than offering a second add. The add is
 * optimistic through the durable queue, revalidating the section only once the
 * write lands (a still-deferred add keeps the optimistic "Added" without a
 * refetch that would read pre-add state). `sections` scopes which membership
 * reads fire, so a movie-only rail never pulls the show watchlist.
 */
export function useWatchlistAdd(
  sections: WatchlistSections = { shows: true, movies: true },
): WatchlistAddView {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const write = useQueuedWrite();
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());

  const showsEnabled = sections.shows ?? false;
  const moviesEnabled = sections.movies ?? false;
  const [watchlistShows, watchlistMovies] = useQueries({
    queries: [
      {
        queryKey: queryKeys.watchlist("shows"),
        queryFn: () => runtime.loadWatchlistIds("shows"),
        staleTime: USER_STATE_STALE_TIME,
        enabled: showsEnabled,
      },
      {
        queryKey: queryKeys.watchlist("movies"),
        queryFn: () => runtime.loadWatchlistIds("movies"),
        staleTime: USER_STATE_STALE_TIME,
        enabled: moviesEnabled,
      },
    ],
  });
  const listedShows = watchlistShows.data;
  const listedMovies = watchlistMovies.data;

  // Library membership is a cache PEEK, never a fetch: these disabled queries
  // subscribe to whatever the home/library screens already loaded (persisted
  // across boots), so "In library" costs this surface zero requests.
  const libraryEntries = useQuery({
    queryKey: queryKeys.library(),
    queryFn: () => runtime.loadUpNext(),
    enabled: false,
  }).data?.entries;
  const movieEntries = useQuery({
    queryKey: queryKeys.movieLibrary(),
    queryFn: () => runtime.loadMovieLibrary(),
    enabled: false,
  }).data?.entries;

  const isListed = useCallback(
    (hit: SearchHit) =>
      hit.type === "movie"
        ? (listedMovies?.includes(hit.traktId) ?? false) ||
          (movieEntries?.some((entry) => entry.movieId === hit.traktId) ?? false)
        : (listedShows?.includes(hit.traktId) ?? false) ||
          (libraryEntries?.some((entry) => entry.showId === hit.traktId) ?? false),
    [listedShows, listedMovies, libraryEntries, movieEntries],
  );

  const isAdded = useCallback(
    (hit: SearchHit) => added.has(addKey(hit)) || isListed(hit),
    [added, isListed],
  );

  // A settled membership write refreshes the section's watchlist read AND the
  // library aggregate that derives its "To watch" shelf from membership.
  const revalidateMembership = useCallback(
    (section: "shows" | "movies") => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchlist(section) });
      void queryClient.invalidateQueries({
        queryKey: section === "movies" ? queryKeys.movieLibrary() : queryKeys.library(),
      });
    },
    [queryClient],
  );

  const add = useCallback(
    async (hit: SearchHit) => {
      const key = addKey(hit);
      if (added.has(key) || isListed(hit)) return;
      setAdded((prev) => new Set(prev).add(key));
      const section = sectionOf(hit.type);
      const op = buildAddWatchlistOp({ opId: crypto.randomUUID(), section, ids: hit.ids });
      await write.run(
        op,
        () =>
          setAdded((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          }),
        `Couldn't add ${hit.title} to your watchlist. Please try again.`,
        () => revalidateMembership(section),
      );
    },
    [added, isListed, write, revalidateMembership],
  );

  const remove = useCallback(
    async (hit: SearchHit) => {
      const key = addKey(hit);
      const section = sectionOf(hit.type);
      // Forward (undone) state first: forget the optimistic add and drop cached
      // membership so the control returns to its add affordance immediately.
      // Cancel any in-flight membership read so a settling response can't
      // re-materialize the id over the optimistic drop.
      setAdded((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      await queryClient.cancelQueries({ queryKey: queryKeys.watchlist(section) });
      queryClient.setQueryData<readonly number[]>(queryKeys.watchlist(section), (old) =>
        old?.filter((id) => id !== hit.traktId),
      );
      const op = buildRemoveWatchlistOp({ opId: crypto.randomUUID(), section, ids: hit.ids });
      await write.run(
        op,
        // Trakt still lists it: restore the added state rather than stranding
        // the row unlisted while the server never changed.
        () => setAdded((prev) => new Set(prev).add(key)),
        `Couldn't remove ${hit.title} from your watchlist. Please try again.`,
        () => revalidateMembership(section),
      );
    },
    [write, queryClient, revalidateMembership],
  );

  return { isAdded, add, remove, addError: write.error, clearAddError: write.clearError };
}
