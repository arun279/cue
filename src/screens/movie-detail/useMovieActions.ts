import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { queryKeys } from "@/core/data/query-keys";
import type { MovieEntry, MovieHeader } from "@/core/domain/model/movie";
import {
  buildMarkMovieOp,
  buildRemoveHistoryPlayOp,
  buildUndoAddOp,
  buildUnmarkMovieOp,
} from "@/core/domain/write-queue/ops";
import { replacedPlays } from "@/core/domain/write-queue/receipt";
import type { QueuedOp } from "@/core/domain/write-queue/types";
import { REPLACED_COPY } from "@/core/hooks/replaced-copy";
import { resolveMovieUnmark } from "@/core/hooks/resolve-unmark";
import { useOptimisticWrite, writeTarget } from "@/core/hooks/useOptimisticWrite";
import { useSetWatchlisted } from "@/core/hooks/useSetWatchlisted";
import { movieLibraryQuery } from "@/core/queries/library";
import { type MovieLibraryData, useRuntime } from "@/core/runtime/runtime";
import { showSnack, showUndoable, snackText } from "@/core/stores/snackbar-store";
import { pendingMark } from "@/core/stores/write-locks";

export function useMovieActions(header: MovieHeader) {
  const runtime = useRuntime();
  const client = useQueryClient();
  const submit = useOptimisticWrite();
  const setWatchlisted = useSetWatchlisted();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const running = useRef(0);
  const library = useQuery(movieLibraryQuery(runtime));
  const entry: MovieEntry = library.data?.entries.find(
    (item) => item.movieId === header.movieId,
  ) ?? {
    ...header,
    watched: false,
    watchedAt: null,
    inWatchlist: false,
    inCollection: false,
    addedAt: null,
  };
  const key = queryKeys.movieLibrary();
  const error = () => showSnack({ message: "Couldn't update this movie. Please try again." });
  const patch = (value: Partial<MovieEntry>) => {
    client.setQueryData<MovieLibraryData>(key, (data) => {
      const current = data?.entries.find((item) => item.movieId === header.movieId) ?? entry;
      const updated = { ...current, ...value };
      return {
        entries: [
          ...(data?.entries.filter((item) => item.movieId !== header.movieId) ?? []),
          ...(updated.watched || updated.inWatchlist || updated.inCollection ? [updated] : []),
        ],
      };
    });
  };
  const revalidate = () => {
    for (const queryKey of [key, queryKeys.movieWatchlist(), queryKeys.historyPrefix()])
      void client.invalidateQueries({ queryKey });
  };
  const run = async (action: () => Promise<void>) => {
    running.current += 1;
    setBusy(true);
    try {
      await action();
    } catch {
      error();
    } finally {
      running.current -= 1;
      setBusy(running.current > 0);
    }
  };
  const guard = (action: () => Promise<void>) => {
    if (running.current === 0) void run(action);
  };
  const undoable = (message: string, undo: () => Promise<void>): void => {
    showUndoable(message, () => run(undo));
  };
  const write = async (op: QueuedOp, next: Partial<MovieEntry>, previous: Partial<MovieEntry>) => {
    await client.cancelQueries({ queryKey: key });
    patch(next);
    const outcome = await submit(
      writeTarget("movie", header.movieId),
      [{ ops: [op], revert: () => patch(previous) }],
      revalidate,
    );
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
    const state = runtime.writeState(op.id);
    if (state === "failed" || state === "cancelled") {
      revalidate();
      return;
    }
    if (replacedPlays(runtime.writeReceipt(op.id)) > 0) {
      showSnack({
        message: `${snackText(REPLACED_COPY.mark(header.title))} ${REPLACED_COPY.undoNote}`,
      });
      revalidate();
      return;
    }
    const inverse =
      state === "unsent"
        ? buildUnmarkMovieOp({
            opId: runtime.newId(),
            ids: header.ids,
            watchedAt: op.watchedAt ?? "",
          })
        : buildUndoAddOp(runtime.newId(), op);
    await write(
      inverse,
      { watched: false, watchedAt: null },
      { watched: true, watchedAt: op.watchedAt },
    );
  };
  const mark = async (watchedAt = new Date().toISOString(), offerUndo = true) => {
    const op = buildMarkMovieOp({ opId: runtime.newId(), ids: header.ids, watchedAt });
    const outcome = await write(
      op,
      { watched: true, watchedAt },
      { watched: false, watchedAt: null },
    );
    if (outcome === "failed") return;
    if (outcome === "done" && replacedPlays(runtime.writeReceipt(op.id)) > 0) {
      showSnack({ message: REPLACED_COPY.mark(header.title) });
      return;
    }
    if (offerUndo) undoable(`${header.title} marked watched`, () => reverseMark(op));
  };
  const unmark = async () => {
    const pending = pendingMark(runtime, `movie:${header.movieId}`);
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
      undoable("Removed play", () => mark(resolution.watchedAt, false));
    }
  };
  const watchlist = async (listed: boolean, offerUndo = true) => {
    const outcome = await setWatchlisted(
      { type: "movie", traktId: header.movieId, ...header },
      listed,
    );
    if (outcome === "failed") {
      error();
      return;
    }
    if (offerUndo)
      undoable(`${header.title} ${listed ? "added to" : "removed from"} Watchlist`, () =>
        watchlist(!listed, false),
      );
  };
  return {
    entry,
    busy,
    toggleWatched: () => guard(() => (entry.watched ? unmark() : mark())),
    toggleWatchlist: () => guard(() => watchlist(!entry.inWatchlist)),
  };
}
