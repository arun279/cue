import { queryKeys } from "@data/query-keys";
import type { SearchHit } from "@data/trakt/search";
import { buildAddWatchlistOp } from "@domain/write-queue/ops";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useEffect, useState } from "react";
import { useQueuedWrite } from "./useQueuedWrite";

/**
 * Settle delay before a query fires. 300ms sits below the ~1s that
 * reads as sluggish yet above a fast typist's ~100–150ms inter-keystroke gap, so
 * a mid-word burst collapses to exactly one `/search` request.
 */
const DEBOUNCE_MS = 300;
const SEARCH_TYPES = "show,movie";
const RECENT_LIMIT = 5;

type SearchStatus = "idle" | "searching" | "results" | "empty" | "error";

export interface SearchView {
  readonly input: string;
  setInput(value: string): void;
  readonly status: SearchStatus;
  /** The settled query the current results/empty state describe. */
  readonly query: string;
  readonly hits: readonly SearchHit[];
  readonly recent: readonly string[];
  refetch(): void;
  isAdded(hit: SearchHit): boolean;
  add(hit: SearchHit): Promise<void>;
  readonly addError: string | null;
  clearAddError(): void;
}

function sectionOf(type: "show" | "movie"): "shows" | "movies" {
  return type === "movie" ? "movies" : "shows";
}

/** Trakt ids are namespaced per media type, so `show:123` and `movie:123` must not collide. */
function addKey(hit: SearchHit): string {
  return `${hit.type}:${hit.traktId}`;
}

/**
 * The Discover search hook: a debounced text input that issues one
 * `/search/show,movie` after the user settles, tracks recent queries for the
 * pre-query state, and adds a hit to the watchlist optimistically via the durable
 * queue. Empty input issues no request (the pre-query empty state owns that).
 * Membership is seeded from the shared watchlist caches so an already-listed hit
 * shows as added and a remount doesn't forget a just-added item.
 */
export function useSearch(): SearchView {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recent, setRecent] = useState<readonly string[]>([]);
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const write = useQueuedWrite();

  const [watchlistShows, watchlistMovies] = useQueries({
    queries: [
      { queryKey: queryKeys.watchlist("shows"), queryFn: () => runtime.loadWatchlistIds("shows") },
      {
        queryKey: queryKeys.watchlist("movies"),
        queryFn: () => runtime.loadWatchlistIds("movies"),
      },
    ],
  });
  const listedShows = watchlistShows.data;
  const listedMovies = watchlistMovies.data;

  const trimmed = input.trim();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const enabled = debounced.length > 0;
  const query = useQuery({
    queryKey: queryKeys.search(debounced, SEARCH_TYPES),
    queryFn: () => runtime.search(debounced),
    enabled,
  });

  useEffect(() => {
    if (query.isSuccess && debounced.length > 0) {
      setRecent((prev) =>
        [debounced, ...prev.filter((q) => q !== debounced)].slice(0, RECENT_LIMIT),
      );
    }
  }, [query.isSuccess, debounced]);

  const settling = trimmed.length > 0 && debounced !== trimmed;
  const hits = query.data ?? [];
  let status: SearchStatus;
  if (trimmed.length === 0) status = "idle";
  else if (settling || query.data === undefined) status = query.isError ? "error" : "searching";
  else if (query.isError) status = "error";
  else status = hits.length === 0 ? "empty" : "results";

  const isListed = useCallback(
    (hit: SearchHit) =>
      (hit.type === "movie" ? listedMovies : listedShows)?.includes(hit.traktId) ?? false,
    [listedShows, listedMovies],
  );

  const isAdded = useCallback(
    (hit: SearchHit) => added.has(addKey(hit)) || isListed(hit),
    [added, isListed],
  );

  const add = useCallback(
    async (hit: SearchHit) => {
      const key = addKey(hit);
      if (added.has(key) || isListed(hit)) return;
      setAdded((prev) => new Set(prev).add(key));
      const section = sectionOf(hit.type);
      const op = buildAddWatchlistOp({ opId: crypto.randomUUID(), section, ids: hit.ids });
      // The seam revalidates only once the write lands, so the library re-read
      // materializes the watchlisted item (and a Search remount reseeds its added
      // state from Trakt) — a still-deferred add keeps the optimistic "Added" without
      // a refetch that would read pre-add state.
      await write.run(
        op,
        () =>
          setAdded((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          }),
        `Couldn't add ${hit.title} to your watchlist. Please try again.`,
        () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.watchlist(section) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.library() });
        },
      );
    },
    [added, isListed, write, queryClient],
  );

  return {
    input,
    setInput,
    status,
    query: debounced,
    hits,
    recent,
    refetch: () => void query.refetch(),
    isAdded,
    add,
    addError: write.error,
    clearAddError: write.clearError,
  };
}
