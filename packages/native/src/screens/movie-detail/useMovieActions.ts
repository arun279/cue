import { queryKeys } from "@cue/core/data/query-keys";
import type { MovieEntry, MovieHeader } from "@cue/core/data/trakt/movie-library";
import type { MoviePlay } from "@cue/core/domain/reversal";
import {
  buildAddWatchlistOp,
  buildMarkMovieOp,
  buildRemoveHistoryPlayOp,
  buildRemoveWatchlistOp,
  buildUnmarkMovieOp,
} from "@cue/core/domain/write-queue/ops";
import { replacedPlays } from "@cue/core/domain/write-queue/receipt";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { REPLACED_COPY } from "@cue/core/hooks/replaced-copy";
import { planLandedUndo, resolveMovieUnmark } from "@cue/core/hooks/resolve-unmark";
import { useOptimisticWrite } from "@cue/core/hooks/useOptimisticWrite";
import { movieLibraryQuery } from "@cue/core/queries/library";
import { type MovieLibraryData, useRuntime } from "@cue/core/runtime/runtime";
import { showSnack, showUndoable, snackText } from "@cue/core/stores/snackbar-store";
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
    inCollection: false,
    addedAt: null,
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
          ...(updated.watched || updated.inWatchlist || updated.inCollection ? [updated] : []),
        ],
      };
    });
  };
  const revalidate = () => {
    for (const queryKey of [key, queryKeys.watchlist("movies"), queryKeys.historyPrefix()])
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
  const reverseLanded = async (
    op: QueuedOp,
  ): Promise<{ inverse?: QueuedOp; remainingAt: string | null } | null> => {
    let plays: readonly MoviePlay[] = [];
    const plan = await planLandedUndo(
      runtime,
      [op.id],
      async () => {
        plays = await runtime.loadMoviePlays(header.movieId);
        return plays;
      },
      () => op.watchedAt,
      () => header.movieId,
    );
    if (plan === null) {
      error();
      return null;
    }
    if (plan.kind === "replaced") {
      showSnack({
        message: `${snackText(REPLACED_COPY.mark(header.title, null))} ${REPLACED_COPY.undoNote}`,
      });
      revalidate();
      return null;
    }
    const own = plan.kind === "remove" ? plan.plays[0] : undefined;
    const others = plays
      .filter((play) => play.historyId !== own?.historyId)
      .sort((a, b) => Date.parse(b.watchedAt) - Date.parse(a.watchedAt));
    return {
      ...(own === undefined ? {} : { inverse: remove(own.historyId, own.watchedAt) }),
      remainingAt: others[0]?.watchedAt ?? null,
    };
  };
  const reverseMark = async (op: QueuedOp) => {
    if (runtime.inFlightOpId() === op.id) {
      error();
      return;
    }
    const queued = runtime.pendingOps().some((pending) => pending.id === op.id);
    const plan = queued
      ? {
          inverse: buildUnmarkMovieOp({
            opId: runtime.newId(),
            ids: header.ids,
            watchedAt: op.watchedAt ?? "",
          }),
          remainingAt: null,
        }
      : await reverseLanded(op);
    if (plan === null) return;
    if (plan.inverse === undefined) {
      revalidate();
      return;
    }
    await write(
      plan.inverse,
      { watched: plan.remainingAt !== null, watchedAt: plan.remainingAt },
      { watched: true, watchedAt: op.watchedAt },
    );
  };
  const mark = async (watchedAt = new Date().toISOString(), undoable = true) => {
    const op = buildMarkMovieOp({ opId: runtime.newId(), ids: header.ids, watchedAt });
    const outcome = await write(
      op,
      { watched: true, watchedAt },
      { watched: false, watchedAt: null },
    );
    if (outcome === "failed") return;
    if (outcome === "done" && replacedPlays(runtime.writeReceipt(op.id)) > 0) {
      showSnack({ message: REPLACED_COPY.mark(header.title, null) });
      return;
    }
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
