import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import type { LibraryEntry } from "../data/trakt/library";
import { buildAddWatchlistOp, buildRemoveWatchlistOp } from "../domain/write-queue/ops";
import { useRuntime } from "../runtime/runtime";
import { showSnack, showUndoable } from "../stores/snackbar-store";
import { ensureLibraryEntry, patchLibraryEntry } from "./library-cache";
import { useOptimisticWrite } from "./useOptimisticWrite";
import { useResumeOnMark } from "./useResumeOnMark";

export function useMoveToWatchlist(): (entry: LibraryEntry) => Promise<void> {
  const runtime = useRuntime();
  const client = useQueryClient();
  const submit = useOptimisticWrite();
  const resume = useResumeOnMark();
  const write = async (entry: LibraryEntry, added: boolean): Promise<boolean> => {
    ensureLibraryEntry(client, entry);
    patchLibraryEntry(client, entry.showId, (old) => ({ ...old, inWatchlist: added }));
    const build = added ? buildAddWatchlistOp : buildRemoveWatchlistOp;
    const outcome = await submit(
      [build({ opId: runtime.newId(), section: "shows", ids: { trakt: entry.showId } })],
      {
        rollback: () =>
          patchLibraryEntry(client, entry.showId, (old) => ({ ...old, inWatchlist: !added })),
        onKept: added
          ? () => resume.resumeIfStopped(entry.showId, { trakt: entry.showId })
          : undefined,
        revalidate: () => {
          void client.invalidateQueries({ queryKey: queryKeys.library() });
          void client.invalidateQueries({ queryKey: queryKeys.watchlist("shows") });
        },
      },
    );
    if (outcome === "failed")
      showSnack({ message: "Couldn't update your watchlist. Please try again." });
    return outcome !== "failed";
  };
  return async (entry) => {
    if (entry.completed !== 0 || entry.inWatchlist) return;
    if (!(await write(entry, true))) return;
    showUndoable(`${entry.title} moved to Watchlist`, () => {
      void write(entry, false).then((kept) => {
        if (kept && entry.hidden) void resume.reStop(entry.showId, { trakt: entry.showId });
      });
    });
  };
}
