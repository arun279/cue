import { queryKeys } from "@data/query-keys";
import type { SearchHit } from "@data/trakt/search";
import { useQuery } from "@tanstack/react-query";
import { useRuntime } from "@ui/runtime/runtime";
import { useEffect, useState } from "react";
import { useWatchlistAdd } from "./useWatchlistAdd";

/**
 * Settle delay before a query fires. 300ms sits below the ~1s that
 * reads as sluggish yet above a fast typist's ~100-150ms inter-keystroke gap, so
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
  /** Reverse of `add`, for the snackbar Undo. */
  remove(hit: SearchHit): Promise<void>;
  readonly addError: string | null;
  clearAddError(): void;
}

/** A single-medium user never sees the other medium as a result row (which
 * would be a live entry point into a hidden section). */
export function visibleSearchHits(
  hits: readonly SearchHit[],
  showsEnabled: boolean,
  moviesEnabled: boolean,
): readonly SearchHit[] {
  return hits.filter((hit) => (hit.type === "movie" ? moviesEnabled : showsEnabled));
}

/**
 * The Search hook: a debounced text input that issues one
 * `/search/show,movie` after the user settles, tracks recent queries for the
 * pre-query state, and adds a hit to the watchlist optimistically. Empty input
 * issues no request (the pre-query empty state owns that). The inline watchlist
 * add is delegated to the shared {@link useWatchlistAdd}, so search results, the
 * browse rails, and the Movie-detail related rail add through one implementation.
 */
export function useSearch(): SearchView {
  const runtime = useRuntime();
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recent, setRecent] = useState<readonly string[]>([]);
  const watchlist = useWatchlistAdd();

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

  return {
    input,
    setInput,
    status,
    query: debounced,
    hits,
    recent,
    refetch: () => void query.refetch(),
    isAdded: watchlist.isAdded,
    add: watchlist.add,
    remove: watchlist.remove,
    addError: watchlist.addError,
    clearAddError: watchlist.clearAddError,
  };
}
