import { queryKeys } from "@cue/core/data/query-keys";
import type { MovieEntry, MovieHeader } from "@cue/core/data/trakt/movie-library";
import { MARK_MATCH_TOLERANCE_MS } from "@cue/core/domain/reversal";
import {
  buildAddWatchlistOp,
  buildMarkMovieOp,
  buildRemoveHistoryPlayOp,
  buildRemoveWatchlistOp,
  buildUnmarkMovieOp,
} from "@cue/core/domain/write-queue/ops";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { resolveMovieUnmark } from "@cue/core/hooks/resolve-unmark";
import { useOptimisticWrite } from "@cue/core/hooks/useOptimisticWrite";
import { movieLibraryQuery } from "@cue/core/queries/library";
import { type MovieLibraryData, useRuntime } from "@cue/core/runtime/runtime";
import { showSnack, showUndoable } from "@cue/core/stores/snackbar-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";

export function useMovieActions(header: MovieHeader) {
  const runtime = useRuntime();
  const client = useQueryClient();
  const submit = useOptimisticWrite();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const library = useQuery(movieLibraryQuery(runtime));
  const entry: MovieEntry = library.data?.entries.find(
    (item) => item.movieId === header.movieId,
  ) ?? {
    ...header,
    watched: false,
    watchedAt: null,
    inWatchlist: false,
    listedAt: null,
  };
  const key = queryKeys.movieLibrary();
  const error = () => showSnack({ message: "Couldn't update this movie. Please try again." });
  const patch = (value: Partial<MovieEntry>) => {
    if (value.inWatchlist !== undefined) {
      client.setQueryData<readonly number[]>(queryKeys.watchlist("movies"), (ids) =>
        ids === undefined
          ? undefined
          : [
              ...ids.filter((id) => id !== header.movieId),
              ...(value.inWatchlist ? [header.movieId] : []),
            ],
      );
    }
    client.setQueryData<MovieLibraryData>(key, (data) => {
      const current = data?.entries.find((item) => item.movieId === header.movieId) ?? entry;
      const updated = { ...current, ...value };
      return {
        entries: [
          ...(data?.entries.filter((item) => item.movieId !== header.movieId) ?? []),
          ...(updated.watched || updated.inWatchlist ? [updated] : []),
        ],
      };
    });
  };
  const revalidate = () => {
    for (const queryKey of [
      key,
      queryKeys.watchlist("movies"),
      queryKeys.historyPrefix(),
      queryKeys.userStats(),
    ])
      void client.invalidateQueries({ queryKey });
  };
  const guard = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await action();
    } catch {
      error();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const write = async (op: QueuedOp, next: Partial<MovieEntry>, previous: Partial<MovieEntry>) => {
    await client.cancelQueries({ queryKey: key });
    patch(next);
    const outcome = await submit([op], { rollback: () => patch(previous), revalidate });
    if (outcome === "failed") error();
    return outcome;
  };
  const remove = (historyId: number, watchedAt: string) =>
    buildRemoveHistoryPlayOp({
      opId: runtime.newId(),
      ids: [historyId],
      restore: { section: "movies", ids: header.ids, watchedAt },
    });
  const reverseMark = async (op: QueuedOp) => {
    if (runtime.inFlightOpId() === op.id) {
      error();
      return;
    }
    let inverse: QueuedOp | undefined;
    let remainingAt: string | null = null;
    if (runtime.pendingOps().some((pending) => pending.id === op.id)) {
      inverse = buildUnmarkMovieOp({
        opId: runtime.newId(),
        ids: header.ids,
        watchedAt: op.watchedAt ?? "",
      });
    } else {
      const plays = [...(await runtime.loadMoviePlays(header.movieId))].sort(
        (a, b) => Date.parse(b.watchedAt) - Date.parse(a.watchedAt) || b.historyId - a.historyId,
      );
      const own = plays.find(
        (play) =>
          Math.abs(Date.parse(play.watchedAt) - Date.parse(op.watchedAt ?? "")) <=
          MARK_MATCH_TOLERANCE_MS,
      );
      if (own !== undefined) inverse = remove(own.historyId, own.watchedAt);
      remainingAt = plays.find((play) => play.historyId !== own?.historyId)?.watchedAt ?? null;
    }
    if (inverse === undefined) {
      revalidate();
      return;
    }
    await write(
      inverse,
      { watched: remainingAt !== null, watchedAt: remainingAt },
      { watched: true, watchedAt: op.watchedAt },
    );
  };
  const mark = async (watchedAt = new Date().toISOString(), undoable = true) => {
    const op = buildMarkMovieOp({ opId: runtime.newId(), ids: header.ids, watchedAt });
    if (
      (await write(op, { watched: true, watchedAt }, { watched: false, watchedAt: null })) ===
      "failed"
    )
      return;
    if (undoable)
      showUndoable(`${header.title} marked watched`, () => void guard(() => reverseMark(op)));
  };
  const unmark = async () => {
    const pending = runtime
      .pendingOps()
      .find((op) => op.itemKey === `movie:${header.movieId}` && op.toState === "present");
    if (pending !== undefined) {
      await reverseMark(pending);
      return;
    }
    const resolution = await resolveMovieUnmark(runtime, header.movieId);
    if (resolution.kind === "rewatch") {
      showSnack({
        message: `This movie has ${resolution.count} plays. Remove a specific play in your watch history.`,
        actions: [{ label: "Open history", onPress: () => router.push("/history?type=movies") }],
      });
    } else if (resolution.kind === "error") error();
    else if (resolution.kind === "none") {
      patch({ watched: false, watchedAt: null });
      revalidate();
    } else if (
      (await write(
        remove(resolution.historyId, resolution.watchedAt),
        { watched: false, watchedAt: null },
        { watched: true, watchedAt: entry.watchedAt },
      )) !== "failed"
    ) {
      showUndoable("Removed play", () => void guard(() => mark(resolution.watchedAt, false)));
    }
  };
  const watchlist = async (listed: boolean, undoable = true) => {
    const op = (listed ? buildAddWatchlistOp : buildRemoveWatchlistOp)({
      opId: runtime.newId(),
      section: "movies",
      ids: header.ids,
    });
    if ((await write(op, { inWatchlist: listed }, { inWatchlist: !listed })) === "failed") return;
    if (undoable)
      showUndoable(
        `${header.title} ${listed ? "added to" : "removed from"} Watchlist`,
        () => void guard(() => watchlist(!listed, false)),
      );
  };
  return {
    entry,
    busy,
    toggleWatched: () => void guard(() => (entry.watched ? unmark() : mark())),
    toggleWatchlist: () => void guard(() => watchlist(!entry.inWatchlist)),
  };
}
