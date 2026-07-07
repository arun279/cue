import { showProgressKeys } from "@data/query-invalidation";
import { queryKeys } from "@data/query-keys";
import type { EpisodeDetail } from "@data/trakt/episode-detail";
import type { ShowHeader } from "@data/trakt/show-detail";
import { buildMarkEpisodeOp, buildUnmarkEpisodeOp } from "@domain/write-queue/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useOptimisticWrite } from "@ui/hooks/useOptimisticWrite";
import { useCallback, useState } from "react";
import { useResumeOnMark } from "./useResumeOnMark";

export interface ToggleEpisodeWatched {
  toggle(episode: EpisodeDetail): Promise<void>;
  clearError(): void;
  readonly error: string | null;
}

/**
 * The Episode-detail watched toggle. Marking ON enqueues a durable
 * `POST /sync/history`; marking OFF enqueues `POST /sync/history/remove
 * {episodes:[{ids}]}` — the all-plays MVP unwatch (no history-id). The toggle is
 * optimistic (the detail flips instantly, with the watched date) and rolls back
 * on a hard failure; the reconcile anchor is the show's pre-op `completed`, so a
 * lost response is retired by a progress re-read, never a duplicate play.
 */
export function useToggleEpisodeWatched(): ToggleEpisodeWatched {
  const submit = useOptimisticWrite();
  const queryClient = useQueryClient();
  const resume = useResumeOnMark();
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (episode: EpisodeDetail) => {
      const key = queryKeys.episode(episode.showId, episode.season, episode.number);
      // Cancel in-flight reads so a settling refetch can't overwrite the flip.
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<EpisodeDetail>(key);
      const next = !episode.watched;
      // Mark uses a fresh timestamp; unmark freezes the play's *original* watched
      // date onto the restore-inverse so Undo of an unwatch re-adds the exact play.
      const freshWatchedAt = new Date().toISOString();
      const watchedAt = next ? freshWatchedAt : (episode.watchedAt ?? freshWatchedAt);

      queryClient.setQueryData<EpisodeDetail>(key, (old) =>
        old === undefined
          ? old
          : { ...old, watched: next, watchedAt: next ? freshWatchedAt : null },
      );

      const header = queryClient.getQueryData<ShowHeader>(queryKeys.showHeader(episode.showId));
      const params = {
        opId: crypto.randomUUID(),
        ids: episode.ids,
        watchedAt,
        inversePatch: { showId: episode.showId, preCompleted: header?.completed ?? 0 },
      };
      const op = next ? buildMarkEpisodeOp(params) : buildUnmarkEpisodeOp(params);

      // The seam restores the pre-flip detail on a hard failure and revalidates only
      // once the write lands on Trakt; a still-queued ("deferred") op keeps the flip
      // (a refetch would read pre-write progress over the optimistic state). A watch
      // on a Stopped show un-stops it (onKept): the unhide must
      // land before revalidate so the library re-read doesn't refile it as Stopped.
      const outcome = await submit([op], {
        rollback: () => {
          if (before !== undefined) queryClient.setQueryData(key, before);
        },
        onKept:
          next && header !== undefined
            ? () => resume.resumeIfStopped(episode.showId, header.ids)
            : undefined,
        revalidate: () => {
          for (const queryKey of showProgressKeys(episode.showId, {
            season: episode.season,
            number: episode.number,
          })) {
            void queryClient.invalidateQueries({ queryKey });
          }
        },
      });
      if (outcome === "failed") setError("Couldn't update this episode. Please try again.");
    },
    [queryClient, submit, resume],
  );

  return { toggle, clearError: () => setError(null), error };
}
