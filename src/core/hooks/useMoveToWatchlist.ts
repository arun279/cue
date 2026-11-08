import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../data/query-keys";
import { type LibraryEntry, stoppedOf } from "../domain/model/library";
import { buildAddWatchlistOp, buildRemoveWatchlistOp } from "../domain/write-queue/ops";
import { useRuntime } from "../runtime/runtime";
import { showSnack, showUndoable } from "../stores/snackbar-store";
import { whenNoWritePending } from "../stores/write-locks";
import { ensureLibraryEntry, patchLibraryEntry } from "./library-cache";
import { useOptimisticWrite, writeTarget } from "./useOptimisticWrite";
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
    const op = build({ opId: runtime.newId(), section: "shows", ids: { trakt: entry.showId } });
    const writing = submit(
      writeTarget("show", entry.showId),
      [
        {
          ops: [op],
          revert: () =>
            patchLibraryEntry(client, entry.showId, (old) => ({ ...old, inWatchlist: !added })),
        },
      ],
      () =>
        whenNoWritePending(() => void client.invalidateQueries({ queryKey: queryKeys.library() })),
    );
    const stopped = stoppedOf(entry);
    if (stopped !== null) {
      if (added) resume.resume(entry.showId, { trakt: entry.showId });
      else resume.stopAgain(entry.showId, { trakt: entry.showId }, stopped, [op]);
    }
    const outcome = await writing;
    if (outcome === "failed")
      showSnack({ message: "Couldn't update your watchlist. Please try again." });
    return outcome !== "failed";
  };
  return async (entry) => {
    if (entry.completed !== 0 || entry.inWatchlist) return;
    if (!(await write(entry, true))) return;
    showUndoable(`${entry.title} moved to Watchlist`, async () => {
      await write(entry, false);
    });
  };
}
