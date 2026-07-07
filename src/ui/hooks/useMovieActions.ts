import { queryKeys } from "@data/query-keys";
import type { MovieEntry } from "@data/trakt/movie-library";
import {
  buildAddWatchlistOp,
  buildMarkMovieOp,
  buildRemoveWatchlistOp,
  buildUnmarkMovieOp,
} from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { writeMovieEntry } from "@ui/hooks/useMovieLibrary";
import { useOptimisticWrite } from "@ui/hooks/useOptimisticWrite";
import { useCallback, useState } from "react";

interface MarkUndo {
  readonly title: string;
  /** The exact pre-mark entry, restored verbatim on Undo. */
  readonly before: MovieEntry;
  readonly watchedAt: string;
}

export interface MovieActions {
  /** Toggle a movie watched/unwatched; a mark exposes an Undo. */
  markWatched(entry: MovieEntry): Promise<void>;
  toggleWatchlist(entry: MovieEntry): Promise<void>;
  undoMark(): Promise<void>;
  dismissUndo(): void;
  clearError(): void;
  readonly undoable: { readonly title: string } | null;
  readonly error: string | null;
}

/**
 * The Movie detail write surface: mark-watched (with a frozen
 * `watched_at`) and watchlist add/remove, each optimistic through the durable
 * write-queue and reconciled against watched-movie / watchlist membership. The
 * shared `movieLibrary` cache is patched instantly (materializing an entry for a
 * movie not yet in the library) so both the detail hero and the My Shows shelves
 * update at once; a hard failure rolls the patch back. A mark exposes an Undo
 * that issues the stored `/sync/history/remove` inverse.
 */
export function useMovieActions(): MovieActions {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const [undo, setUndo] = useState<MarkUndo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.movieLibrary() }),
    [queryClient],
  );

  const markWatched = useCallback(
    async (entry: MovieEntry) => {
      const next = !entry.watched;
      const watchedAt = new Date().toISOString();
      writeMovieEntry(queryClient, {
        ...entry,
        watched: next,
        watchedAt: next ? watchedAt : null,
      });
      const build = next ? buildMarkMovieOp : buildUnmarkMovieOp;
      const op = build({
        opId: crypto.randomUUID(),
        ids: entry.ids,
        watchedAt,
        inversePatch: { kind: "movie", movieId: entry.movieId },
      });
      const outcome = await submit([op], {
        rollback: () => writeMovieEntry(queryClient, entry),
        revalidate,
      });
      if (outcome === "failed") {
        setError(`Couldn't update ${entry.title}. Please try again.`);
        return;
      }
      setUndo(next ? { title: entry.title, before: entry, watchedAt } : null);
    },
    [queryClient, revalidate, submit],
  );

  const toggleWatchlist = useCallback(
    async (entry: MovieEntry) => {
      const next = !entry.inWatchlist;
      writeMovieEntry(queryClient, { ...entry, inWatchlist: next });
      const build = next ? buildAddWatchlistOp : buildRemoveWatchlistOp;
      const op = build({ opId: crypto.randomUUID(), section: "movies", ids: entry.ids });
      const outcome = await submit([op], {
        rollback: () => writeMovieEntry(queryClient, entry),
        revalidate,
      });
      if (outcome === "failed") setError("Couldn't update your watchlist. Please try again.");
    },
    [queryClient, revalidate, submit],
  );

  const undoMark = useCallback(async () => {
    const pending = undo;
    if (pending === null) return;
    setUndo(null);
    writeMovieEntry(queryClient, pending.before);
    const op = buildUnmarkMovieOp({
      opId: crypto.randomUUID(),
      ids: pending.before.ids,
      watchedAt: pending.watchedAt,
      inversePatch: { kind: "movie", movieId: pending.before.movieId },
    });
    const outcome = await submit([op], {
      rollback: () =>
        writeMovieEntry(queryClient, {
          ...pending.before,
          watched: true,
          watchedAt: pending.watchedAt,
        }),
      revalidate,
    });
    if (outcome === "failed") setError(`Couldn't undo ${pending.title}. Please try again.`);
  }, [undo, queryClient, revalidate, submit]);

  return {
    markWatched,
    toggleWatchlist,
    undoMark,
    dismissUndo: () => setUndo(null),
    clearError: () => setError(null),
    undoable: undo === null ? null : { title: undo.title },
    error,
  };
}
